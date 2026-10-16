// The words the page puts on a result: the one-line verdict (the worst
// finding first: restarts and crashes, then failing hardware, then the
// most frequent problem, never common noise), the line under it, and each
// group's name and plain sentence.
import { copy, fill } from "./copy.ts";
import { canonical, known } from "./known.ts";
import {
  LEVELS,
  type Group,
  type Kind,
  type Level,
  type Result,
} from "./model.ts";
import { CLOSE, OPEN } from "./normalize.ts";

// Times are wall-clock times kept as UTC (model.ts), so they're shown in
// UTC to read as written.
const dayMonth = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const dayMonthYear = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});
const number = new Intl.NumberFormat("en");

export const formatNumber = (n: number) => number.format(n);
export const formatDay = (t: number) => dayMonth.format(t);
export const formatTime = (t: number) => clock.format(t);
export const formatWhen = (t: number) =>
  `${dayMonth.format(t)}, ${clock.format(t)}`;

/** "Oct 8 to 15, 2026", "Oct 28 to Nov 3, 2026", "Dec 28, 2025 to Jan 3,
 * 2026", or one day. */
export function formatRange(first: number | null, last: number | null): string {
  if (first === null || last === null) return "";
  const a = new Date(first);
  const b = new Date(last);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  if (sameYear && a.getUTCMonth() === b.getUTCMonth()) {
    if (a.getUTCDate() === b.getUTCDate()) return dayMonthYear.format(first);
    return `${dayMonth.format(first)} to ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
  }
  if (sameYear) {
    return `${dayMonth.format(first)} to ${dayMonthYear.format(last)}`;
  }
  return `${dayMonthYear.format(first)} to ${dayMonthYear.format(last)}`;
}

/** An offset from UTC as "UTC", "UTC+2" or "UTC−5:30". */
export function zoneName(minutes: number): string {
  if (!minutes) return copy.utc;
  const m = Math.abs(minutes);
  const mm = m % 60 ? `:${String(m % 60).padStart(2, "0")}` : "";
  return `${copy.utc}${minutes < 0 ? "−" : "+"}${Math.floor(m / 60)}${mm}`;
}

/** A time with the log's zone after it, when the log names one. */
const zoned = (time: string, result: Result) =>
  result.zone === null ? time : `${time} ${zoneName(result.zone)}`;

/** "once", "twice", "3 times". */
export const times = (n: number) =>
  n === 1 ? "once" : n === 2 ? "twice" : `${formatNumber(n)} times`;

/** A normalized message as plain text: its placeholders as "…". */
export const plainMessage = (message: string) =>
  message.replace(new RegExp(`${OPEN}[a-z]+${CLOSE}`, "gu"), "…");

/** A source as Event Viewer shows it. */
export const sourceName = (source: string) =>
  source.replace(/^Microsoft-Windows-/i, "");

const REASONS: Record<string, string> = {
  "400": "Bad Request",
  "401": "Unauthorized",
  "403": "Forbidden",
  "404": "Not Found",
  "405": "Method Not Allowed",
  "408": "Request Timeout",
  "410": "Gone",
  "413": "Content Too Large",
  "429": "Too Many Requests",
  "499": "Client Closed Request",
  "500": "Internal Server Error",
  "502": "Bad Gateway",
  "503": "Service Unavailable",
  "504": "Gateway Timeout",
};

/** A group's label (its level, or a web status) and its name. */
export function groupName(
  group: Group,
  kind: Kind,
): { label: string; name: string } {
  if (group.other) {
    return { label: copy.levelNames[group.level], name: copy.other };
  }
  if (kind === "web") {
    const status = group.id ?? "";
    return {
      label: [status, REASONS[status]].filter(Boolean).join(" "),
      name: group.path || copy.noRequest,
    };
  }
  const label = copy.levelNames[group.level];
  if (kind === "windows") {
    return {
      label,
      name: [sourceName(group.source), group.id].filter(Boolean).join(" "),
    };
  }
  return {
    label,
    name: group.source || plainMessage(group.message).slice(0, 60),
  };
}

/** Common noise: listed apart, never the verdict. */
export const isNoise = (group: Group, kind: Kind) =>
  kind === "windows" &&
  !group.other &&
  known(group.source, group.id)?.noise === true;

const BOTS: [RegExp, keyof typeof copy.web][] = [
  [/^\/(wp-login\.php|wp-admin|xmlrpc\.php|wordpress|wp-)/i, "wordpress"],
  [/^\/(\.env|\.git|\.aws|config\.(php|json|yml)|\.ds_store)/i, "secrets"],
  [/^\/(phpmyadmin|pma|myadmin|adminer)/i, "admin"],
];

/** A group's plain sentence, when there is one. */
export function groupPlain(group: Group, result: Result): string | null {
  // Many kinds of message together: nothing to say about them as one.
  if (group.other) return null;
  if (result.kind === "windows")
    return known(group.source, group.id)?.plain ?? null;
  if (result.kind !== "web") return null;
  const status = group.id ?? "";
  if (status.startsWith("4")) {
    for (const [pattern, key] of BOTS) {
      if (pattern.test(group.path ?? "")) return copy.web[key];
    }
  }
  const base = (copy.web as Record<string, string>)[status] ?? null;
  if (status.startsWith("5")) {
    const b = burst(result, group);
    if (b) {
      const note = fill(copy.web.burst, {
        n: formatNumber(b.count),
        date: formatDay(b.from),
        from: formatTime(b.from),
        to: zoned(formatTime(b.to), result),
      });
      return base ? `${base} ${note}` : note;
    }
  }
  return base;
}

// A burst: the busiest quarter of an hour holds at least this many server
// errors, and at least half of them.
const BURST_WINDOW = 15;
const BURST_MIN = 10;

/** The busiest quarter of an hour of server errors, if it's a burst. With
 * a group, only if most of that group's errors fall in it. */
export function burst(
  result: Result,
  group?: Group,
): { count: number; from: number; to: number } | null {
  const minutes = result.failures;
  const total = minutes.reduce((n, [, c]) => n + c, 0);
  let best = { count: 0, from: 0, to: 0 };
  let start = 0;
  let sum = 0;
  for (let end = 0; end < minutes.length; end++) {
    const [m, c] = minutes[end] ?? [0, 0];
    sum += c;
    while ((minutes[start]?.[0] ?? m) <= m - BURST_WINDOW) {
      sum -= minutes[start]?.[1] ?? 0;
      start++;
    }
    if (sum > best.count) {
      best = {
        count: sum,
        from: (minutes[start]?.[0] ?? m) * 60_000,
        to: m * 60_000,
      };
    }
  }
  if (best.count < BURST_MIN || best.count * 2 < total) return null;
  if (group) {
    // The burst is this group's when the group alone could hold it.
    if (group.count * 2 < best.count) return null;
    const inside =
      group.first !== null &&
      group.last !== null &&
      group.last >= best.from &&
      group.first <= best.to + 60_000;
    if (!inside) return null;
    return { ...best, count: Math.min(best.count, group.count) };
  }
  return best;
}

const share = (part: number, whole: number) => {
  if (!whole) return "0%";
  const pct = (part / whole) * 100;
  return `${pct < 0.1 && pct > 0 ? pct.toFixed(2) : pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
};

const countOf = (result: Result, source: string, ids: string[]) =>
  result.groups
    .filter(
      (g) =>
        canonical(g.source) === source && g.id !== null && ids.includes(g.id),
    )
    .reduce((n, g) => n + g.count, 0);

/** The latest time among these events, or null when none has one. */
const lastOf = (result: Result, source: string, ids: string[]) => {
  let latest: number | null = null;
  for (const g of result.groups) {
    if (
      g.last !== null &&
      canonical(g.source) === source &&
      g.id !== null &&
      ids.includes(g.id) &&
      (latest === null || g.last > latest)
    ) {
      latest = g.last;
    }
  }
  return latest;
};

const PROBLEMS: Level[] = ["critical", "error", "warning"];

/** Problems only in the "other" group (too many kinds to list): how many,
 * or null. */
function otherProblems(result: Result): string | null {
  const n = result.groups
    .filter((g) => g.other && PROBLEMS.includes(g.level))
    .reduce((sum, g) => sum + g.count, 0);
  return n ? manyKinds(result) : null;
}

/** Every error and warning, of too many kinds to name one. */
const manyKinds = (result: Result) =>
  fill(copy.manyKinds, {
    n: formatNumber(
      result.groups
        .filter((g) => PROBLEMS.includes(g.level))
        .reduce((sum, g) => sum + g.count, 0),
    ),
  });

/**
 * Whether `top`, the first of the groups that `fits` in the result's
 * order, is surely the most frequent of them: no group of a worse level
 * went into "other", no kind in "other" at its level could have been seen
 * as often, and no group whose count may be short could have been seen
 * more often.
 */
function surelyTop(
  result: Result,
  top: Group,
  fits: (g: Group) => boolean,
): boolean {
  const rank = LEVELS.indexOf(top.level);
  return result.groups.every((g) => {
    if (g === top) return true;
    if (g.other) {
      if (!PROBLEMS.includes(g.level)) return true;
      const r = LEVELS.indexOf(g.level);
      return r > rank || (r === rank && (g.most ?? g.count) < top.count);
    }
    return (
      g.level !== top.level ||
      !fits(g) ||
      g.count + (g.missed ?? 0) <= top.count
    );
  });
}

/** A group's count as words: "at least" when some of it may be in
 * "other". */
const timesOf = (g: Group) =>
  g.missed ? fill(copy.atLeast, { times: times(g.count) }) : times(g.count);

function windowsVerdict(result: Result): string {
  const unexpected =
    countOf(result, "kernel-power", ["41"]) ||
    countOf(result, "eventlog", ["6008"]);
  const blue = countOf(result, "bugcheck", ["1001"]);
  if (unexpected) {
    return blue
      ? fill(copy.restartedBlue, {
          times: times(unexpected),
          blue: times(blue),
        })
      : fill(copy.restarted, { times: times(unexpected) });
  }
  if (blue) return fill(copy.blueScreens, { times: times(blue) });
  const fatal = countOf(result, "whea-logger", ["18"]);
  if (fatal) return fill(copy.hardware, { times: times(fatal) });
  const drive =
    countOf(result, "disk", ["7", "51", "153"]) +
    countOf(result, "ntfs", ["55"]);
  const damage =
    countOf(result, "disk", ["7"]) + countOf(result, "ntfs", ["55"]);
  if (damage || drive >= 5) return fill(copy.drive, { times: times(drive) });
  const fits = (g: Group) =>
    PROBLEMS.includes(g.level) && !g.other && !isNoise(g, "windows");
  const worst = result.groups.find(fits);
  if (worst && !surelyTop(result, worst, fits)) return manyKinds(result);
  if (worst) {
    const values = {
      name: groupName(worst, "windows").name,
      times: timesOf(worst),
    };
    // "Only warnings" can't be said when some levels couldn't be read.
    return worst.level === "warning" && !result.unknownLevels
      ? fill(copy.onlyWarnings, values)
      : fill(copy.mainProblem, values);
  }
  const many = otherProblems(result);
  if (many) return many;
  // Nor can "nothing needs a look".
  if (result.unknownLevels) return copy.levelsUnknown;
  const noise = result.groups.some(
    (g) => PROBLEMS.includes(g.level) && isNoise(g, "windows"),
  );
  return noise ? copy.nothingButNoise : copy.nothing;
}

function serverVerdict(result: Result): string {
  const fits = (g: Group) => PROBLEMS.includes(g.level) && !g.other;
  const worst = result.groups.find(fits);
  if (!worst) return otherProblems(result) ?? copy.serverQuiet;
  if (!surelyTop(result, worst, fits)) return manyKinds(result);
  let message = plainMessage(worst.message);
  if (message.length > 80) message = `${message.slice(0, 79).trimEnd()}…`;
  return fill(copy.mostFrequent, {
    level: copy.levelInSentence[worst.level],
    message,
    times: timesOf(worst),
  });
}

function webVerdict(result: Result): string {
  const failed = result.levels.error + result.levels.critical;
  const b = burst(result);
  if (b) {
    return fill(copy.burst, {
      n: formatNumber(b.count),
      date: formatDay(b.from),
      from: formatTime(b.from),
      to: zoned(formatTime(b.to), result),
    });
  }
  if (failed) {
    return fill(copy.failed, {
      n: formatNumber(failed),
      share: share(failed, result.events),
    });
  }
  const fits = (g: Group) =>
    g.id === "404" &&
    !g.other &&
    !BOTS.some(([pattern]) => pattern.test(g.path ?? ""));
  const missing = result.groups.find(fits);
  if (missing && !surelyTop(result, missing, fits)) return copy.manyMissing;
  if (missing) {
    return fill(copy.missing, {
      path: plainMessage(missing.path ?? ""),
      times: timesOf(missing),
    });
  }
  return copy.allAnswered;
}

export function verdict(result: Result): string {
  if (!result.events) return copy.empty;
  if (result.kind === "windows") return windowsVerdict(result);
  if (result.kind === "web") return webVerdict(result);
  return serverVerdict(result);
}

const EXPORT_NAME: Record<string, string> = {
  "ev-csv": "CSV",
  "ev-txt": "text",
  "ev-xml": "XML",
  evtx: ".evtx",
};

/** The line under the verdict: how much, from when to when, what it is. */
export function about(result: Result): string {
  const n = formatNumber(result.events);
  const range = formatRange(result.first, result.last);
  let line: string;
  if (result.kind === "windows") {
    const values = {
      n,
      range,
      log: result.logName ?? "",
      as: EXPORT_NAME[result.format] ?? "",
    };
    line = fill(
      result.logName ? copy.aboutWindows : copy.aboutWindowsNoName,
      values,
    );
    // Rows whose dates couldn't be read have no time to give.
    const t = lastOf(result, "kernel-power", ["41"]);
    if (t !== null) {
      line += ` ${fill(copy.lastRestart, { date: formatDay(t), time: formatTime(t) })}`;
    }
    if (result.unknownLevels && verdict(result) !== copy.levelsUnknown) {
      line += ` ${copy.levelsUnknown}`;
    }
  } else if (result.kind === "web") {
    line = fill(copy.aboutWeb, {
      n,
      range,
      share: share(result.levels.error + result.levels.critical, result.events),
    });
  } else {
    line = fill(copy.aboutServer, {
      n,
      range,
      what:
        result.format === "nginx-error" ? copy.nginxErrorName : copy.syslogName,
    });
  }
  if (result.zone !== null) {
    line += ` ${fill(copy.timesIn, { zone: zoneName(result.zone) })}`;
  }
  // An .evtx file holds events; the text formats are read a line at a time.
  const evtx = result.format === "evtx";
  if (result.skipped === 1) {
    line += ` ${evtx ? copy.skippedEventOne : copy.skippedOne}`;
  } else if (result.skipped) {
    line += ` ${fill(evtx ? copy.skippedEvents : copy.skipped, { n: formatNumber(result.skipped) })}`;
  }
  return line;
}
