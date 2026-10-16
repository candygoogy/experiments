// syslog, as files on a server hold it: RFC 3164 ("Oct 14 22:14:15 host
// app[123]: …", with or without the <priority> in front), RFC 5424
// ("<165>1 2026-10-14T22:14:15.003Z host app 123 ID47 [data] …"), and the
// ISO-dated lines rsyslog writes by default. Times are kept as written:
// the server's own clock.
import type { Level, LogEvent } from "../model.ts";
import type { Context, Emit, Parser } from "./types.ts";

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

const DAY = 86_400_000;

// Each message runs to the line's end, whatever is in it (the "s" flag:
// a stray "\r" or U+2028 too).
export const RFC3164 =
  /^(?:<(\d{1,3})>)?([A-Z][a-z]{2}) {1,2}(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\S+) ([^:[\s]+)(?:\[\d+\])?:? ?(.*)$/s;
export const RFC5424 =
  /^<(\d{1,3})>1 (\S+) (\S+) (\S+) (\S+) (\S+) (-|(?:\[[^\]]*\])+) ?(.*)$/s;
export const ISO_LINE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?) (\S+) ([^:[\s]+)(?:\[\d+\])?: ?(.*)$/s;

/** An ISO time's offset from UTC in minutes ("Z" is 0), or null. */
export function isoZone(text: string): number | null {
  const m = /(?:(Z)|([+-])(\d{2}):?(\d{2}))$/.exec(text);
  if (!m) return null;
  if (m[1]) return 0;
  const minutes = Number(m[3]) * 60 + Number(m[4]);
  return m[2] === "-" ? -minutes : minutes;
}

/** syslog severities 0–7. */
function severity(priority: string | undefined): Level | null {
  if (priority === undefined) return null;
  const s = Number(priority) % 8;
  if (s <= 2) return "critical";
  if (s === 3) return "error";
  if (s === 4) return "warning";
  return "information";
}

/** A level from the words of a message without a priority. */
export function levelFromWords(message: string): Level {
  if (/\b(panic|fatal|emerg(ency)?|crit(ical)?)\b/i.test(message)) {
    return "critical";
  }
  if (/\b(error|err|fail(ed|ure|s)?|denied|refused|invalid)\b/i.test(message)) {
    return "error";
  }
  if (/\bwarn(ing)?\b/i.test(message)) return "warning";
  return "information";
}

/** An ISO time as written, without moving it to another zone. */
export function isoWall(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(text);
  if (!m) return null;
  const n = (i: number) => Number(m[i]);
  return Date.UTC(n(1), n(2) - 1, n(3), n(4), n(5), n(6));
}

export function syslog(emit: Emit, context: Context, now: Date): Parser {
  // RFC 3164 writes no year: the log is taken to start this year, or last
  // year when its first line would be after today, and a step back in the
  // month (December, then January) starts the next year.
  let year: number | null = null;
  let lastMonth = -1;

  const event = (
    priority: string | undefined,
    time: number | null,
    source: string,
    message: string,
  ): LogEvent => ({
    time,
    level: severity(priority) ?? levelFromWords(message),
    source,
    id: null,
    message,
  });

  return {
    line(text) {
      if (!text.trim()) return;
      let m = RFC5424.exec(text);
      if (m) {
        const app = m[4] === "-" ? "" : (m[4] ?? "");
        context.zone(isoZone(m[2] ?? ""));
        emit(event(m[1], isoWall(m[2] ?? ""), app, m[8] ?? ""));
        return;
      }
      m = ISO_LINE.exec(text);
      if (m) {
        context.zone(isoZone(m[1] ?? ""));
        emit(event(undefined, isoWall(m[1] ?? ""), m[3] ?? "", m[4] ?? ""));
        return;
      }
      m = RFC3164.exec(text);
      if (m) {
        const month = MONTHS.indexOf((m[2] ?? "").toLowerCase());
        if (month === -1) {
          context.skip();
          return;
        }
        const n = (i: number) => Number(m?.[i] ?? 0);
        const at = (y: number) => Date.UTC(y, month, n(3), n(4), n(5), n(6));
        if (year === null) {
          // Times are as written (wall clock as UTC), and so is today; a
          // day's grace for a server in a zone ahead of the viewer's.
          const today = Date.UTC(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            now.getHours(),
            now.getMinutes(),
            now.getSeconds(),
          );
          year = now.getFullYear();
          if (at(year) > today + DAY) year--;
        } else if (month < lastMonth - 6) {
          year++;
        }
        lastMonth = month;
        const time = at(year);
        context.zone(null);
        emit(event(m[1], time, m[8] ?? "", m[9] ?? ""));
        return;
      }
      context.skip();
    },
    end() {},
  };
}
