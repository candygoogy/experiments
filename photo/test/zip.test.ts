import { unzipSync } from "fflate";
import { expect, test } from "vitest";
import { crc32, uniqueNames, zip } from "../src/zip";

test("crc32 is the zip checksum, also when read in pieces", () => {
  const text = new TextEncoder().encode("123456789");
  expect(crc32(text)).toBe(0xcbf43926);
  expect(crc32(text.subarray(4), crc32(text.subarray(0, 4)))).toBe(0xcbf43926);
  expect(crc32(new Uint8Array())).toBe(0);
});

test("each name once: a second one is numbered before its extension", () => {
  expect(uniqueNames(["a.jpg", "a.jpg", "b.png", "a.jpg", "c"])).toEqual([
    "a.jpg",
    "a (2).jpg",
    "b.png",
    "a (3).jpg",
    "c",
  ]);
  expect(uniqueNames(["a.jpg", "a (2).jpg", "a.jpg"])).toEqual([
    "a.jpg",
    "a (2).jpg",
    "a (3).jpg",
  ]);
});

test("the archive opens to the same files, stored as they are", async () => {
  const big = new Uint8Array(3 * 1024 * 1024 + 5).map((_, i) => i * 7);
  const files = [
    { name: "IMG_1-clean.jpg", bytes: new Uint8Array([0xff, 0xd8, 1, 2, 3]) },
    { name: "IMG_1-clean.jpg", bytes: big },
    { name: "été-clean.png", bytes: new Uint8Array([0x89, 0x50]) },
  ];
  const blob = await zip(
    files.map((f) => ({ name: f.name, blob: new Blob([f.bytes]) })),
    new Date(2026, 9, 18, 12, 30, 10),
  );
  expect(blob.type).toBe("application/zip");
  const out = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  expect(Object.keys(out)).toEqual([
    "IMG_1-clean.jpg",
    "IMG_1-clean (2).jpg",
    "été-clean.png",
  ]);
  expect(out["IMG_1-clean.jpg"]).toEqual(files[0]?.bytes);
  expect(out["IMG_1-clean (2).jpg"]).toEqual(big);
  expect(out["été-clean.png"]).toEqual(files[2]?.bytes);
  // Stored: the archive is the files plus their records, no bigger.
  const names = files.reduce((n, f) => n + 2 * Buffer.byteLength(f.name), 0);
  const bytes = files.reduce((n, f) => n + f.bytes.length, 0);
  expect(blob.size).toBe(bytes + 3 * (30 + 46) + 22 + names + 2 * 4);
});
