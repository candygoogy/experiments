// Web server access logs in the "combined" format nginx and Apache both
// write (and "common", the same without the last two fields):
// 203.0.113.9 - - [14/Oct/2026:03:10:12 +0000] "GET /a?b=1 HTTP/1.1" 502 157 "-" "agent"
// Times are kept as written: the server's own clock, whose offset from
// UTC each line gives. Apache writes a quote inside the request as \".
import type { Level } from "../model.ts";
import type { Context, Emit, Parser } from "./types.ts";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const ACCESS =
  /^(\S+) \S+ \S+ \[(\d{2})\/([A-Z][a-z]{2})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})\] "((?:[^"\\]|\\.)*)" (\d{3}) (\S+)/;

export function statusLevel(status: number): Level {
  if (status >= 500) return "error";
  if (status >= 400) return "warning";
  return "information";
}

export function access(emit: Emit, context: Context): Parser {
  return {
    line(text) {
      if (!text.trim()) return;
      const m = ACCESS.exec(text);
      if (!m) {
        context.skip();
        return;
      }
      const month = MONTHS.indexOf(m[3] ?? "");
      const n = (i: number) => Number(m[i] ?? 0);
      const zone = m[8] ?? "+0000";
      const minutes = Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3));
      context.zone(zone[0] === "-" ? -minutes : minutes);
      const request = m[9] ?? "";
      const [method = "", target = ""] = request.split(" ");
      const status = n(10);
      emit({
        time:
          month === -1 ? null : Date.UTC(n(4), month, n(2), n(5), n(6), n(7)),
        level: statusLevel(status),
        source: /^[A-Z]+$/.test(method) ? method : "",
        id: String(status),
        message: target ? `${method} ${target}` : request,
        client: m[1] ?? "",
        path: target.startsWith("/") ? target : target ? "(not a path)" : "",
      });
    },
    end() {},
  };
}
