// What a file is, from its first bytes. The name and the type the browser
// reports are never trusted: a PNG renamed to .jpg is still a PNG.

export type PhotoType = "jpeg" | "png" | "webp" | "heic";

const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, to));

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// HEIC and its relatives; plain HEIF (mif1) counts unless it says AVIF.
const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

export function detect(b: Uint8Array): PhotoType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "jpeg";
  }
  if (b.length >= 8 && PNG.every((v, i) => b[i] === v)) return "png";
  if (
    b.length >= 12 &&
    ascii(b, 0, 4) === "RIFF" &&
    ascii(b, 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  // ISO media files: a size, "ftyp", the major brand, a version, then the
  // compatible brands, up to the box's end.
  if (b.length >= 16 && ascii(b, 4, 8) === "ftyp") {
    const major = ascii(b, 8, 12);
    if (AVIF_BRANDS.has(major)) return null;
    const end = Math.min(
      b.length,
      new DataView(b.buffer, b.byteOffset).getUint32(0),
    );
    const brands = [major];
    for (let o = 16; o + 4 <= end; o += 4) brands.push(ascii(b, o, o + 4));
    if (brands.some((brand) => HEIC_BRANDS.has(brand))) return "heic";
  }
  return null;
}
