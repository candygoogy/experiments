// What a log becomes: its events, grouped and counted. Everything here is
// plain data, so it can cross from the worker to the page, and the
// example can be written into the page as it is.

export type Level = "critical" | "error" | "warning" | "information";

export const LEVELS: readonly Level[] = [
  "critical",
  "error",
  "warning",
  "information",
];

/** The formats this page reads. */
export type Format =
  "ev-csv" | "ev-txt" | "ev-xml" | "evtx" | "syslog" | "access" | "nginx-error";

/** What kind of log it is, which decides the words and the filters. */
export type Kind = "windows" | "server" | "web";

export const KIND: Record<Format, Kind> = {
  "ev-csv": "windows",
  "ev-txt": "windows",
  "ev-xml": "windows",
  evtx: "windows",
  syslog: "server",
  "nginx-error": "server",
  access: "web",
};

/**
 * One event as a parser reads it. Times are wall-clock times: the clock on
 * the machine that wrote the log, kept as milliseconds since 1970 as if it
 * were UTC (so formatting in UTC shows it as written).
 */
export interface LogEvent {
  time: number | null;
  /** Null when the log's word for it is unknown (known.ts may know). */
  level: Level | null;
  /** Windows: the provider ("Kernel-Power"); syslog: the app; web: the
   * method. */
  source: string;
  /** Windows: the event ID; web: the status code. */
  id: string | null;
  message: string;
  /** Web logs: the client's address. */
  client?: string;
  /** Web logs: the request's path, without its query. */
  path?: string;
}

export interface Group {
  key: string;
  level: Level;
  source: string;
  id: string | null;
  count: number;
  first: number | null;
  last: number | null;
  /** The message with its variable parts as placeholders (normalize.ts). */
  message: string;
  /** Up to SAMPLES of the messages as written. */
  samples: string[];
  /** Web logs: the normalized path. */
  path?: string;
  /** The group of the rare kinds moved out to keep MAX_GROUPS kinds
   * (analyze.ts): never named or explained as one event. */
  other?: true;
  /** The "other" group: no one kind in it was seen more than this many
   * times. */
  most?: number;
  /** A kind moved to the "other" group that came back: up to this many
   * more of its events are counted there, so it was seen at least `count`
   * times and at most `count + missed`. */
  missed?: number;
}

/** The most samples a group keeps. */
export const SAMPLES = 200;

export interface Result {
  format: Format;
  kind: Kind;
  /** The Windows log's name when the file says it ("System"). */
  logName: string | null;
  events: number;
  /** Lines that looked like part of the log but couldn't be read. */
  skipped: number;
  /** Events whose level is a word this page doesn't know, when it knew
   * none of the log's words for a problem (a Windows export in another
   * language, even one that writes "Information" as English does): errors
   * can't be told from information. Zero when it knew one; an odd word
   * among those counts as information. */
  unknownLevels: number;
  first: number | null;
  last: number | null;
  /** The log's own clock as an offset from UTC in minutes, when every
   * line says the same one (web logs, ISO-dated syslog). Null for logs
   * shown in the viewer's time, or that don't say. */
  zone: number | null;
  groups: Group[];
  /** Events per hour: [hour since 1970, count], in order. */
  hours: [number, number][];
  /** When the machine started, or stopped without shutting down. */
  restarts: number[];
  /** Web logs: server errors (5xx) per minute: [minute since 1970,
   * count], in order. */
  failures: [number, number][];
  /** Web logs: the busiest clients, [address, requests]. */
  clients: [string, number][];
  /** Count per level. */
  levels: Record<Level, number>;
}
