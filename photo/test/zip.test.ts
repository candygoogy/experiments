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

test("names that differ only in case count as the same, each in its own case", () => {
  expect(uniqueNames(["IMG_1.JPG", "img_1.jpg", "Img_1 (2).jpg"])).toEqual([
    "IMG_1.JPG",
    "img_1 (2).jpg",
    "Img_1 (2) (2).jpg",
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

test("past 65,534 files, the count goes in a zip64 end record", async () => {
  const count = 65_536 + 3;
  const blob = await zip(
    Array.from({ length: count }, (_, i) => ({
      name: `${i}.jpg`,
      blob: new Blob(i % 1000 ? [] : [new Uint8Array([i & 0xff, 1, 2])]),
    })),
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  expect(view.getUint16(end + 8, true)).toBe(0xffff);
  expect(view.getUint32(end - 20, true)).toBe(0x07064b50);
  const end64 = Number(view.getBigUint64(end - 12, true));
  expect(view.getUint32(end64, true)).toBe(0x06064b50);
  expect(view.getBigUint64(end64 + 32, true)).toBe(BigInt(count));
  // fflate reads the count from the zip64 record, not the 16-bit field.
  const out = unzipSync(bytes);
  const names = Object.keys(out);
  expect(names.length).toBe(count);
  expect(names[0]).toBe("0.jpg");
  expect(names[count - 1]).toBe(`${count - 1}.jpg`);
  expect(out["65000.jpg"]).toEqual(new Uint8Array([65000 & 0xff, 1, 2]));
  expect(out["65001.jpg"]).toEqual(new Uint8Array());
});

test("sizes and offsets too big for 4 bytes go in zip64 fields", async () => {
  // A limit of 64 bytes stands in for 4 GiB: the first file is too big,
  // the second starts too far in, and so does the central directory.
  const first = new Uint8Array(100).map((_, i) => i);
  const second = new Uint8Array([7, 8, 9]);
  const blob = await zip(
    [
      { name: "a.jpg", blob: new Blob([first]) },
      { name: "b.jpg", blob: new Blob([second]) },
    ],
    new Date(),
    64,
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  // The first local header: version 4.5, both sizes only in its zip64 field.
  expect(view.getUint16(4, true)).toBe(45);
  expect(view.getUint32(18, true)).toBe(0xffffffff);
  expect(view.getUint32(22, true)).toBe(0xffffffff);
  expect(view.getUint16(28, true)).toBe(20);
  expect(view.getUint16(35, true)).toBe(1);
  expect(view.getUint16(37, true)).toBe(16);
  expect(view.getBigUint64(39, true)).toBe(100n);
  expect(view.getBigUint64(47, true)).toBe(100n);
  // fflate takes the sizes and offsets from the central records' zip64
  // fields, and the directory's place from the zip64 end record.
  const out = unzipSync(bytes);
  expect(out["a.jpg"]).toEqual(first);
  expect(out["b.jpg"]).toEqual(second);
  const end = bytes.length - 22;
  expect(view.getUint16(end + 8, true)).toBe(2);
  expect(view.getUint32(end + 12, true)).toBe(0xffffffff);
  expect(view.getUint32(end + 16, true)).toBe(0xffffffff);
});

test("an archive that fits has no zip64 records", async () => {
  const blob = await zip([
    { name: "a.jpg", blob: new Blob([new Uint8Array(9)]) },
  ]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  expect(view.getUint16(4, true)).toBe(20);
  expect(view.getUint16(28, true)).toBe(0);
  expect(bytes.length).toBe(30 + 5 + 9 + 46 + 5 + 22);
});
