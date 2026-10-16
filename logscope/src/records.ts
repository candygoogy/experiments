// Reads delimited records (CSV, or tab-separated text) one line at a
// time. A quoted field can hold the delimiter, doubled quotes and line
// breaks, so one record can take several lines: each record goes to row()
// once it's complete.

export interface Records {
  push(line: string): void;
  /** The end of the file: a record still open is given up on. */
  end(): void;
}

// A record left open this long is a stray quote, not a long message.
export const MAX_RECORD = 64 * 1024;

/** row() gets each record's fields; skip() is called once for each line
 * whose quote never closed, or closed only inside a later row (the lines
 * after it are read again, as rows of their own). */
export function records(
  delimiter: string,
  row: (fields: string[]) => void,
  skip: () => void = () => {},
): Records {
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  // The lines of the record still open, as written.
  let raw: string[] = [];
  let size = 0;
  // Lines waiting to be read: the one pushed, or those given back.
  let queue: string[] = [];
  let next = 0;

  const reset = () => {
    fields = [];
    field = "";
    quoted = false;
    raw = [];
    size = 0;
  };

  // The quote never closed: the line that opened it can't be read, and
  // the lines after it are read again from the start.
  const giveUp = () => {
    const again = raw.slice(1);
    reset();
    skip();
    queue = again.concat(queue.slice(next));
    next = 0;
  };

  const read = (line: string) => {
    // Most lines have no quotes at all.
    if (!raw.length && !line.includes('"')) {
      row(line.split(delimiter));
      return;
    }
    // Still inside a quoted field: the line break belongs to it.
    if (raw.length) field += "\n";
    raw.push(line);
    size += line.length;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"') {
          if (line[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            quoted = false;
            // A quote that ran over a line break and closes before more
            // text (`…,"Row 0"`) is the next row's opening quote: the line
            // that opened it had a stray one. That line can't be read; the
            // rest are read again as rows of their own.
            if (
              raw.length > 1 &&
              line[i + 1] !== delimiter &&
              line.slice(i + 1).trim()
            ) {
              giveUp();
              return;
            }
          }
        } else {
          field += c;
        }
      } else if (c === '"' && field === "") {
        quoted = true;
      } else if (c === delimiter) {
        fields.push(field);
        field = "";
      } else {
        field += c;
      }
    }
    if (quoted) {
      if (size > MAX_RECORD) giveUp();
      return;
    }
    fields.push(field);
    const out = fields;
    reset();
    row(out);
  };

  const drain = () => {
    while (next < queue.length) read(queue[next++] ?? "");
    queue = [];
    next = 0;
  };

  return {
    push(line) {
      queue.push(line);
      drain();
    },
    end() {
      while (raw.length) {
        giveUp();
        drain();
      }
    },
  };
}
