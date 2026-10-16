// Reads a log a line at a time and keeps only what the page shows: the
// groups and their counts, the events per hour, the restarts, the busiest
// clients. Each group keeps at most SAMPLES messages as written, so memory
// stays flat however long the log is.
import { access } from "./formats/access.ts";
import { nginxError, nginxGist } from "./formats/nginx-error.ts";
import { syslog } from "./formats/syslog.ts";
import type { Context, Parser } from "./formats/types.ts";
import { windowsTable } from "./formats/windows-table.ts";
import { windowsXml } from "./formats/windows-xml.ts";
import { garbled } from "./formats/levels.ts";
import { canonical, known } from "./known.ts";
import {
  KIND,
  SAMPLES,
  type Format,
  type Group,
  type Level,
  type LogEvent,
  type Result,
} from "./model.ts";
import { normalize, normalizePath } from "./normalize.ts";

const HOUR = 3_600_000;

// At most this many kinds of message keep a group of their own.
//
// A log can hold far more kinds (a public server's 404s: every scanner's
// path is a kind of its own), and keeping the first ones that come would
// hide a frequent kind that first shows up late, while the verdict named a
// one-off. So the groups are a top-k list, the space-saving way: once
// full, the rarest tenth of the kinds move into their level's "other"
// group, and the new kind gets a group of its own. A kind seen more often
// than about one in MAX_GROUPS events always keeps its group, however late
// it starts.
//
// What moved is written into a count-min sketch (4 × 65,536 counters,
// 1 MB, made only once the cap is reached). A kind that comes back looks
// itself up there: up to that many of its events may already be counted
// in "other" (its `missed`), so its own count is never more than it was
// seen, and the verdict says "at least" when it may be short. `floor`
// bounds the same for every kind: none in "other" was seen more often
// than the most frequent kind ever moved. Memory stays flat: the groups,
// plus the sketch.
//
// Known Windows events (restarts, crashes, a failing drive) never move:
// they're few, and the verdict counts them.
export const MAX_GROUPS = 10_000;
// How many of the rarest kinds move out at once, once full.
const MOVE = 1_000;
const SKETCH_ROWS = 4;
const SKETCH_BITS = 16;
const SKETCH_SIZE = 1 << SKETCH_BITS;
// Past this many clients, only those already seen are counted.
const MAX_CLIENTS = 100_000;
// A sample longer than this is cut.
const MAX_SAMPLE = 2_000;
// Restarts closer together than this are one restart.
const RESTART_GAP = 10 * 60_000;

const RANK: Record<Level, number> = {
  critical: 0,
  error: 1,
  warning: 2,
  information: 3,
};

export interface Options {
  /** Today, for syslog lines that don't say the year. */
  now?: Date;
  /** The viewer's offset from UTC (minutes, as getTimezoneOffset). */
  offset?: (utc: number) => number;
}

export interface Analyzer {
  /** A line, or a piece of a long one (`more`: it goes on). */
  line(text: string, more?: boolean): void;
  end(): Result;
}

const viewerOffset = (utc: number) => new Date(utc).getTimezoneOffset();

// cells() writes here, so a lookup makes no garbage.
const AT = new Int32Array(SKETCH_ROWS);

/** A key's counter in each row of the sketch, in AT. */
function cells(key: string): Int32Array {
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  a ^= a >>> 15;
  b = (b ^ (b >>> 13)) | 1;
  for (let row = 0; row < SKETCH_ROWS; row++) {
    AT[row] = row * SKETCH_SIZE + ((a + Math.imul(row, b)) & (SKETCH_SIZE - 1));
  }
  return AT;
}

/** A request as method and path, with its ids as placeholders. */
function requestShape(event: LogEvent): string {
  const [path = "", query] = (event.path ?? "")
    .slice(0, MAX_SAMPLE)
    .split("?", 2);
  const values = query
    ? `?${query.replace(/=([^&]*)/g, (_all, v: string) => `=${normalize(v)}`)}`
    : "";
  return `${event.source} ${normalizePath(path)}${values}`.trim();
}

export function analyzer(format: Format, options: Options = {}): Analyzer {
  const kind = KIND[format];
  const groups = new Map<string, Group>();
  const hours = new Map<number, number>();
  const clients = new Map<string, number>();
  const failures = new Map<number, number>();
  const restarts: number[] = [];
  const levels: Record<Level, number> = {
    critical: 0,
    error: 0,
    warning: 0,
    information: 0,
  };
  let events = 0;
  let skipped = 0;
  let unknownLevels = 0;
  // Level words read in the wrong text encoding (levels.ts): unknown even
  // when the log's other words are known.
  let garbledLevels = 0;
  // The log's own clock: undefined until a line says, null once lines
  // disagree or one doesn't say.
  let zone: number | null | undefined;
  // Events the log itself called a problem, in words (or numbers) this
  // page knows. Without any, an unknown word may be this log's "error":
  // Swedish writes "Information" as English does, but "Fel" for an error.
  let worded = 0;
  let first: number | null = null;
  let last: number | null = null;
  let logName: string | null = null;

  // The top-k bookkeeping (see MAX_GROUPS).
  let sketch: Uint32Array | null = null;
  let floor = 0;
  const kept = new Set<Group>();

  const others: Partial<Record<Level, Group>> = {};
  const otherOf = (level: Level): Group => {
    let group = others[level];
    if (!group) {
      const key = `${level}|(other)`;
      // It belongs to no source, ID or path.
      group = {
        key,
        level,
        source: "",
        id: null,
        count: 0,
        first: null,
        last: null,
        message: "",
        samples: [],
        other: true,
      };
      others[level] = group;
      groups.set(key, group);
    }
    return group;
  };

  /** How many of this kind's events may already be in "other". */
  const missedOf = (key: string) => {
    if (!sketch) return 0;
    let n = Infinity;
    for (const c of cells(key)) n = Math.min(n, sketch[c] ?? 0);
    return Math.min(n, floor);
  };

  /** The rarest MOVE kinds go to their level's "other" group: among
   * equals, information before warnings before errors, oldest first. */
  const makeRoom = () => {
    const counters = (sketch ??= new Uint32Array(SKETCH_ROWS * SKETCH_SIZE));
    const score = (g: Group) =>
      (g.count + (g.missed ?? 0)) * 4 + 3 - RANK[g.level];
    const all = new Float64Array(groups.size);
    let m = 0;
    for (const g of groups.values()) {
      if (!g.other && !kept.has(g)) all[m++] = score(g);
    }
    const scores = all.subarray(0, m).sort();
    const n = Math.min(MOVE, m);
    const cut = scores[n - 1] ?? 0;
    let ties = n - scores.findIndex((s) => s >= cut);
    for (const g of groups.values()) {
      if (g.other || kept.has(g)) continue;
      const s = score(g);
      if (s > cut) continue;
      if (s === cut) {
        if (!ties) continue;
        ties--;
      }
      floor = Math.max(floor, g.count + (g.missed ?? 0));
      // Conservative update: each counter rises only as far as needed.
      const at = cells(g.key);
      let had = Infinity;
      for (const c of at) had = Math.min(had, counters[c] ?? 0);
      for (const c of at) {
        counters[c] = Math.max(counters[c] ?? 0, had + g.count);
      }
      const other = otherOf(g.level);
      other.count += g.count;
      if (g.first !== null && (other.first === null || g.first < other.first))
        other.first = g.first;
      if (g.last !== null && (other.last === null || g.last > other.last))
        other.last = g.last;
      for (const sample of g.samples) {
        if (other.samples.length >= SAMPLES) break;
        other.samples.push(sample);
      }
      groups.delete(g.key);
    }
  };

  const add = (event: LogEvent) => {
    events++;
    const about = kind === "windows" ? known(event.source, event.id) : null;
    if (event.level && event.level !== "information") worded++;
    const level: Level = event.level ?? about?.level ?? "information";
    levels[level]++;

    let key: string;
    let message: string;
    // A message is read only as far as a sample keeps it.
    const text = event.message.slice(0, MAX_SAMPLE);
    if (kind === "windows") {
      message = normalize(text);
      key =
        event.id !== null
          ? `${canonical(event.source)}|${event.id}`
          : `${canonical(event.source)}|${message}`;
    } else if (kind === "web") {
      message = requestShape(event);
      key = `${event.id ?? ""}|${normalizePath((event.path ?? "").slice(0, MAX_SAMPLE))}`;
    } else {
      const gist = format === "nginx-error" ? nginxGist(text) : text;
      message = normalize(gist);
      key = `${level}|${event.source}|${message}`;
    }

    let group = groups.get(key);
    if (!group) {
      if (groups.size >= MAX_GROUPS) makeRoom();
      group = {
        key,
        level,
        source: event.source,
        id: event.id,
        count: 0,
        first: null,
        last: null,
        message,
        samples: [],
      };
      if (kind === "web") {
        group.path = normalizePath((event.path ?? "").slice(0, MAX_SAMPLE));
      }
      // A known event never moves, so none of it is in "other".
      if (about) kept.add(group);
      else {
        const missed = missedOf(key);
        if (missed) group.missed = missed;
      }
      groups.set(key, group);
    }
    group.count++;
    if (RANK[level] < RANK[group.level]) group.level = level;
    if (group.samples.length < SAMPLES) {
      group.samples.push(text);
    }

    const t = event.time;
    if (t !== null) {
      if (group.first === null || t < group.first) group.first = t;
      if (group.last === null || t > group.last) group.last = t;
      if (first === null || t < first) first = t;
      if (last === null || t > last) last = t;
      const hour = Math.floor(t / HOUR);
      hours.set(hour, (hours.get(hour) ?? 0) + 1);
      if (about?.marker || about?.startWhen?.test(event.message)) {
        restarts.push(t);
      }
      if (kind === "web" && Number(event.id) >= 500) {
        const minute = Math.floor(t / 60_000);
        failures.set(minute, (failures.get(minute) ?? 0) + 1);
      }
    }
    if (event.client) {
      const n = clients.get(event.client);
      if (n !== undefined) clients.set(event.client, n + 1);
      else if (clients.size < MAX_CLIENTS) clients.set(event.client, 1);
    }
  };

  const context: Context = {
    skip: () => {
      skipped++;
    },
    unknownLevel: (word) => {
      unknownLevels++;
      if (garbled(word)) garbledLevels++;
    },
    zone: (minutes) => {
      if (zone === undefined) zone = minutes;
      else if (zone !== minutes) zone = null;
    },
    logName: (name) => {
      logName = name;
    },
    offset: options.offset ?? viewerOffset,
  };

  const parser: Parser =
    format === "ev-csv"
      ? windowsTable(",", add, context)
      : format === "ev-txt"
        ? windowsTable("\t", add, context)
        : format === "ev-xml"
          ? windowsXml(add, context)
          : format === "syslog"
            ? syslog(add, context, options.now ?? new Date())
            : format === "access"
              ? access(add, context)
              : nginxError(add, context);

  // A line passed on in pieces (lines.ts): the XML reads every piece, a
  // line-per-event format only the first.
  const pieces = format === "ev-xml";
  let continuing = false;

  return {
    line(text, more = false) {
      if (pieces) parser.line(text, more);
      else if (!continuing) parser.line(text);
      continuing = more;
    },
    end() {
      parser.end();
      for (const g of groups.values()) {
        if (g.other) g.most = Math.min(g.count, floor);
      }
      const sorted = [...groups.values()].sort(
        (a, b) =>
          RANK[a.level] - RANK[b.level] ||
          b.count - a.count ||
          (b.last ?? 0) - (a.last ?? 0),
      );
      // A start right after a stop without shutting down is the same
      // restart.
      const marks: number[] = [];
      for (const t of restarts.sort((a, b) => a - b)) {
        const prev = marks.at(-1);
        if (prev === undefined || t - prev > RESTART_GAP) marks.push(t);
      }
      return {
        format,
        kind,
        logName,
        events,
        skipped,
        unknownLevels: worded ? garbledLevels : unknownLevels,
        first,
        last,
        zone: zone ?? null,
        groups: sorted,
        hours: [...hours.entries()].sort((a, b) => a[0] - b[0]),
        restarts: marks,
        failures: [...failures.entries()].sort((a, b) => a[0] - b[0]),
        clients: [...clients.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
        levels,
      };
    },
  };
}

/** A whole log at once: for the tests and the example. */
export function analyzeText(
  text: string,
  format: Format,
  options: Options = {},
): Result {
  const run = analyzer(format, options);
  for (const line of text.replace(/^\u{feff}/u, "").split(/\r?\n/)) {
    run.line(line);
  }
  return run.end();
}
