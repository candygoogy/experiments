// Files bigger than this aren't compose files anyone writes by hand, and
// a paste as big would hold the page while it's read. In bytes, as a
// file's size is counted, so a paste and a drop meet the same cap.
export const MAX_BYTES = 2_000_000;

/** Whether the text is over the cap once written out as UTF-8. Each of
 * its UTF-16 units is one to three bytes, so only text that could fall
 * either side is counted byte by byte. */
export function tooBig(text: string): boolean {
  if (text.length > MAX_BYTES) return true;
  if (text.length * 3 <= MAX_BYTES) return false;
  return new TextEncoder().encode(text).length > MAX_BYTES;
}
