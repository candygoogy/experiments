// PNG text of any size is read, so a place in it is still reported:
// a long comment beside it, or Exif kept as a long hex "raw profile" (as
// ImageMagick writes it, a thumbnail included) can't hide it.
import { deflateSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { readPhoto } from "../src/read";
import { clean } from "../src/strip/index";
import { chunks as pngChunks } from "../src/strip/png";
import { sentences, summarize } from "../src/summary";
import { ascii, exifTiff, leaks, pngChunk, rawProfile } from "./forge";
import { png } from "./gradient";

const PLACE = "This photo carries the exact place it was taken";

/** The picture with these chunks after its header. */
async function made(...extra: number[][]) {
  const base = await png();
  const ihdr = pngChunks(base).list[0]?.end ?? 0;
  return new Uint8Array([
    ...base.subarray(0, ihdr),
    ...extra.flat(),
    ...base.subarray(ihdr),
  ]);
}

async function said(b: Uint8Array) {
  const read = await readPhoto(b, "png");
  return sentences(summarize(read?.meta, read?.groups));
}

const EXIF = [...ascii("Exif\0\0"), ...exifTiff()];

describe("long PNG text", () => {
  test("a 200 KB comment beside a place: the place is still said", async () => {
    const file = await made(
      pngChunk("zTXt", rawProfile("exif", EXIF)),
      pngChunk("tEXt", [...ascii("Comment\0"), ...ascii("x".repeat(200_000))]),
    );
    const lines = await said(file);
    expect(lines[0]).toContain(PLACE);
    expect(lines.some((l) => l.startsWith("It carries a comment"))).toBe(true);
    expect(leaks(clean(file, "png", 1))).toBe(false);
  });

  test("Exif kept as 300,000 hex digits is read in full", async () => {
    // A thumbnail's worth of bytes after the TIFF: the hex runs long.
    const big = [...EXIF, ...new Array<number>(150_000).fill(0xab)];
    const file = await made(pngChunk("zTXt", rawProfile("exif", big)));
    expect((await said(file))[0]).toContain(PLACE);
  });

  test("long iTXt and Latin-1 text are read as they're written", async () => {
    const file = await made(
      pngChunk("iTXt", [
        ...ascii("Comment\0"),
        0,
        0,
        0,
        0,
        ...Buffer.from(`${"é".repeat(150_000)}`),
      ]),
      pngChunk("tEXt", [...ascii("Author\0"), ...ascii("Zo\xeb")]),
    );
    const lines = await said(file);
    expect(lines).toContain("It names a person: Zoë.");
    expect(lines.find((l) => l.startsWith("It carries a comment"))).toContain(
      "éééé",
    );
  });

  test("compressed text that can't be read isn't passed over in silence", async () => {
    // A raw profile whose compressed bytes are broken: the page can't
    // know what it holds, so it says it couldn't read the details.
    const broken = [
      ...ascii("Raw profile type exif\0"),
      0,
      ...deflateSync(Buffer.from("\nexif\n10\n")).subarray(0, 4),
    ];
    const file = await made(pngChunk("zTXt", broken));
    await expect(readPhoto(file, "png")).rejects.toThrow();
  });
});
