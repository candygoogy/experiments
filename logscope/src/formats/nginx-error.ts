// nginx's error log:
// 2026/10/14 03:10:12 [error] 1234#1234: *5678 connect() failed (111: …)
// while connecting to upstream, client: 203.0.113.9, server: …, request: …
// The details after the message (client, server, request, upstream, host)
// are kept in the samples but left out of what groups the events.
import type { Level } from "../model.ts";
import type { Context, Emit, Parser } from "./types.ts";

export const NGINX_ERROR =
  /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2}) \[(\w+)\] \d+#\d+: (?:\*\d+ )?(.*)$/s;

function level(word: string): Level {
  if (["emerg", "alert", "crit"].includes(word)) return "critical";
  if (word === "error") return "error";
  if (word === "warn") return "warning";
  return "information";
}

export function nginxError(emit: Emit, context: Context): Parser {
  return {
    line(text) {
      if (!text.trim()) return;
      const m = NGINX_ERROR.exec(text);
      if (!m) {
        context.skip();
        return;
      }
      const n = (i: number) => Number(m[i] ?? 0);
      // The server's own clock, which the log doesn't name.
      context.zone(null);
      emit({
        time: Date.UTC(n(1), n(2) - 1, n(3), n(4), n(5), n(6)),
        level: level(m[7] ?? ""),
        source: "nginx",
        id: null,
        message: m[8] ?? "",
      });
    },
    end() {},
  };
}

/** The part of an nginx error that says what went wrong. */
export const nginxGist = (message: string) =>
  message.split(/, (?:client|server|request|upstream|host|referrer): /)[0] ??
  message;
