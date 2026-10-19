// Helpers for the tools that read files byte by byte.

/** Whether the bytes at `at` spell `text`, a character a byte (a file's
 * magic, a block's name). False where the bytes run out first. */
export const startsWith = (b: Uint8Array, at: number, text: string) => {
  for (let i = 0; i < text.length; i++) {
    if (b[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
};
