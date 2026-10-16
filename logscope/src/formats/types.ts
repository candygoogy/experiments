// What every format's parser has: it takes the log a line at a time and
// hands each event it reads to emit().
import type { LogEvent } from "../model.ts";

export interface Context {
  /** A line that looked like part of the log but couldn't be read. */
  skip(): void;
  /** An event whose level is a word this page doesn't know. */
  unknownLevel(word: string): void;
  /** The Windows log's name, when the file says it ("System"). */
  logName(name: string): void;
  /** The viewer's clock offset from UTC at a time, in minutes (as
   * Date.prototype.getTimezoneOffset gives it), for logs that write UTC. */
  offset(utc: number): number;
  /** For a log whose times are kept as written: the offset from UTC (in
   * minutes) of the line just read, or null when the line doesn't say. */
  zone(minutes: number | null): void;
}

export interface Parser {
  /** A line, or a piece of a long one: `more` says it goes on in the next
   * call (lines.ts). */
  line(text: string, more?: boolean): void;
  end(): void;
}

export type Emit = (event: LogEvent) => void;
