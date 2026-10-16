// Cuts decoded text into lines as it arrives. Each piece is searched only
// for its own line breaks, and a line still open is carried over. A line
// that grows past PIECE without ending (wevtutil writes thousands of
// events on one line; some files have no line breaks at all) is passed on
// in pieces, so memory stays flat whatever the file looks like.

export interface Lines {
  /** The next piece of text; false once a line was turned away. */
  push(chunk: string): boolean;
  /** The last line, if the text didn't end with a break. */
  end(): boolean;
}

/** The longest piece of a line passed on at once. */
export const PIECE = 64 * 1024;

/** Gets a line without its line break (and stray "\r"s before it), or a
 * piece of one: `more` says the line goes on in the next call. Returns
 * whether to go on. */
export type Take = (line: string, more: boolean) => boolean;

const trim = (line: string) => {
  let end = line.length;
  while (end && line[end - 1] === "\r") end--;
  return end === line.length ? line : line.slice(0, end);
};

export function lines(take: Take): Lines {
  let rest = "";
  // Pieces of the current line have gone out already.
  let piecing = false;
  return {
    push(chunk) {
      let from = 0;
      for (
        let at = chunk.indexOf("\n");
        at !== -1;
        at = chunk.indexOf("\n", from)
      ) {
        const line = chunk.slice(from, at);
        from = at + 1;
        const ok = take(trim(rest ? rest + line : line), false);
        rest = "";
        piecing = false;
        if (!ok) return false;
      }
      rest += chunk.slice(from);
      while (rest.length >= PIECE) {
        const piece = rest.slice(0, PIECE);
        rest = rest.slice(PIECE);
        piecing = true;
        if (!take(piece, true)) return false;
      }
      return true;
    },
    end() {
      if (!rest && !piecing) return true;
      const line = rest;
      rest = "";
      piecing = false;
      return take(trim(line), false);
    },
  };
}
