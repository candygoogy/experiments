import { stripHeic } from "./heic";
import { stripJpeg } from "./jpeg";
import { stripPng } from "./png";
import { stripWebp } from "./webp";
import type { PhotoType } from "../detect";

export { stripHeic, stripJpeg, stripPng, stripWebp };

/** A copy without the photo's metadata, the picture itself untouched. */
export function clean(
  b: Uint8Array,
  type: PhotoType,
  orientation: number,
): Uint8Array {
  if (type === "jpeg") return stripJpeg(b, orientation);
  if (type === "png") return stripPng(b, orientation);
  if (type === "heic") return stripHeic(b, orientation);
  return stripWebp(b, orientation);
}
