import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { analyzeText, type Options } from "../src/analyze.ts";
import { detect, encoding, isEvtx } from "../src/detect.ts";
import type { Format, Result } from "../src/model.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const bytes = (name: string) =>
  new Uint8Array(readFileSync(join(FIXTURES, name)));
const text = (name: string) => {
  const b = bytes(name);
  return new TextDecoder(encoding(b)).decode(b);
};
// The fixtures were written in 2026; times as written, no zone shift.
const OPTIONS: Options = {
  now: new Date(Date.UTC(2026, 9, 15)),
  offset: () => 0,
};
const read = (name: string, format?: Format): Result => {
  const t = text(name);
  const f = format ?? detect(t.slice(0, 65536));
  if (!f) throw new Error(`${name}: no format`);
  return analyzeText(t, f, OPTIONS);
};
const group = (r: Result, source: string, id: string) =>
  r.groups.find(
    (g) => g.source.toLowerCase().endsWith(source.toLowerCase()) && g.id === id,
  );
const OCT = (day: number, h = 0, m = 0) => Date.UTC(2026, 9, day, h, m);

describe("the fixtures as Event Viewer writes them", () => {
  test.each([
    "en-system.csv",
    "it-system.csv",
    "pl-system.csv",
    "system.xml",
    "wevtutil.xml",
  ])("%s has Windows line endings (CRLF)", (name) => {
    const t = Buffer.from(bytes(name)).toString("utf8");
    expect(t).toContain("\r\n");
    // Every line break is a CRLF, apart from those inside a message.
    expect(t.split("\r\n").length).toBeGreaterThan(100);
  });

  test("the text export is UTF-16 with CRLF", () => {
    const b = bytes("en-system.txt");
    expect([b[0], b[1]]).toEqual([0xff, 0xfe]);
    expect(text("en-system.txt")).toContain("\r\n");
  });
});

describe("what a file is", () => {
  test.each([
    ["en-system.csv", "ev-csv"],
    ["it-system.csv", "ev-csv"],
    ["pl-system.csv", "ev-csv"],
    ["en-system.txt", "ev-txt"],
    ["system.xml", "ev-xml"],
    ["wevtutil.xml", "ev-xml"],
    ["syslog-3164.log", "syslog"],
    ["syslog-5424.log", "syslog"],
    ["syslog-iso.log", "syslog"],
    ["access.log", "access"],
    ["nginx-error.log", "nginx-error"],
  ] as const)("%s is %s, by its content", (name, format) => {
    expect(detect(text(name).slice(0, 65536))).toBe(format);
  });

  test("not a log", () => {
    expect(detect(text("not-a-log.txt"))).toBeNull();
    expect(detect("")).toBeNull();
  });

  test("an .evtx file, by its first bytes", () => {
    expect(isEvtx(bytes("fake.evtx"))).toBe(true);
    expect(isEvtx(bytes("en-system.csv"))).toBe(false);
  });

  test("Event Viewer's text export is UTF-16", () => {
    expect(encoding(bytes("en-system.txt"))).toBe("utf-16le");
    expect(encoding(bytes("en-system.csv"))).toBe("utf-8");
  });
});

describe("Windows logs, in every export", () => {
  const en = read("en-system.csv");

  test("the English CSV: every event, grouped by source and ID", () => {
    expect(en.events).toBe(436);
    expect(en.skipped).toBe(0);
    expect(group(en, "Kernel-Power", "41")?.count).toBe(3);
    expect(group(en, "DistributedCOM", "10016")?.count).toBe(201);
    expect(en.levels).toEqual({
      critical: 3,
      error: 207,
      warning: 33,
      information: 193,
    });
    // Month first, with AM/PM: 10/14/2026 10:51:00 PM.
    expect(group(en, "Kernel-Power", "41")?.last).toBe(OCT(14, 22, 51));
  });

  test("a message over several lines stays one event", () => {
    const service = group(en, "Service Control Manager", "7031");
    expect(service?.count).toBe(2);
    expect(service?.samples[0]).toContain(
      "Details are in the service's own log.",
    );
  });

  test.each([
    "it-system.csv",
    "pl-system.csv",
    "en-system.txt",
    "system.xml",
    "wevtutil.xml",
  ])("%s reads the same as the English CSV", (name) => {
    const r = read(name);
    expect(r.events).toBe(en.events);
    expect(r.skipped).toBe(0);
    const shape = (x: Result) =>
      x.groups.map((g) => [g.id, g.count, g.first, g.last]).sort();
    expect(shape(r)).toEqual(shape(en));
    expect(r.restarts).toEqual(en.restarts);
  });

  test("Italian levels and day-first dates", () => {
    const it = read("it-system.csv");
    expect(it.levels).toEqual(en.levels);
    expect(group(it, "Kernel-Power", "41")?.first).toBe(OCT(9, 23, 4));
  });

  test("Polish: columns by their shape, its level words read", () => {
    const pl = read("pl-system.csv");
    expect(pl.levels).toEqual(en.levels);
    expect(pl.unknownLevels).toBe(0);
    expect(group(pl, "Kernel-Power", "41")?.level).toBe("critical");
    expect(group(pl, "BugCheck", "1001")?.level).toBe("error");
    expect(group(pl, "Service Control Manager", "7031")?.level).toBe("error");
  });

  test("the XML names DCOM as Windows does, and it's still DistributedCOM", () => {
    const xml = read("system.xml");
    expect(group(xml, "DistributedCOM", "10016")?.count).toBe(201);
  });

  test("the XML says the log's name; BugCheck by its event source name", () => {
    const xml = read("system.xml");
    expect(xml.logName).toBe("System");
    expect(group(xml, "BugCheck", "1001")?.count).toBe(1);
    expect(read("wevtutil.xml").logName).toBe("System");
  });

  test("XML times in UTC become the viewer's clock", () => {
    const t = text("system.xml");
    const twoHoursAhead = analyzeText(t, "ev-xml", { offset: () => -120 });
    expect(group(twoHoursAhead, "Kernel-Power", "41")?.last).toBe(
      OCT(15, 0, 51),
    );
  });

  test("restarts: a start right after a crash is one restart", () => {
    expect(en.restarts).toEqual([
      OCT(9, 23, 4),
      OCT(12, 7, 30),
      OCT(14, 22, 51),
    ]);
  });

  test("the day comes first when a date says so, even after many rows", () => {
    const head = "Level,Date and Time,Source,Event ID,Task Category";
    const rows = [
      "Information,01/02/2026 10:00:00,Example,1,None,a",
      "Information,25/02/2026 10:00:00,Example,1,None,b",
    ];
    const r = analyzeText([head, ...rows].join("\n"), "ev-csv");
    expect(r.first).toBe(Date.UTC(2026, 1, 1, 10));
  });
});

describe("server logs", () => {
  test.each(["syslog-3164.log", "syslog-5424.log", "syslog-iso.log"])(
    "%s",
    (name) => {
      const r = read(name);
      expect(r.events).toBe(288);
      expect(r.skipped).toBe(0);
      expect(r.first).toBeGreaterThanOrEqual(OCT(13));
      expect(r.last).toBeLessThan(OCT(15));
      const sources = new Set(r.groups.map((g) => g.source));
      expect([...sources].sort()).toEqual([
        "CRON",
        "kernel",
        "sshd",
        "systemd",
      ]);
    },
  );

  test("a priority gives the level; without one, the words do", () => {
    const withPriority = read("syslog-5424.log");
    expect(withPriority.groups.find((g) => g.source === "kernel")?.level).toBe(
      "error",
    );
    expect(withPriority.groups.find((g) => g.source === "systemd")?.level).toBe(
      "warning",
    );
    const words = read("syslog-3164.log");
    expect(words.groups.find((g) => g.source === "sshd")?.level).toBe("error");
  });

  test("syslog without a year: a log that runs into January", () => {
    const r = analyzeText(
      "Dec 31 23:59:00 h app: a\nJan  1 00:01:00 h app: b",
      "syslog",
      {
        now: new Date(Date.UTC(2027, 0, 2)),
      },
    );
    expect(r.first).toBe(Date.UTC(2026, 11, 31, 23, 59));
    expect(r.last).toBe(Date.UTC(2027, 0, 1, 0, 1));
  });

  test("nginx errors group by what went wrong, not by client or request", () => {
    const r = read("nginx-error.log");
    expect(r.groups[0]?.count).toBe(31);
    expect(r.groups[0]?.level).toBe("error");
    expect(r.groups[0]?.samples[0]).toContain("client: ");
  });
});

describe("web access logs", () => {
  const web = read("access.log");

  test("requests grouped by status and path, ids as placeholders", () => {
    expect(web.events).toBe(3396);
    const bad = web.groups[0];
    expect(bad?.id).toBe("502");
    expect(bad?.count).toBe(35);
    expect(web.groups.find((g) => g.path === "/wp-login.php")?.count).toBe(167);
  });

  test("the busiest clients, at most five", () => {
    expect(web.clients).toHaveLength(5);
    expect(web.clients[0]?.[0]).toBe("203.0.113.9");
  });

  test("server errors by the minute, for finding a burst", () => {
    const total = web.failures.reduce((n, [, c]) => n + c, 0);
    expect(total).toBe(35);
  });

  test("a request line that isn't one is still counted", () => {
    expect(web.groups.find((g) => g.id === "400")?.count).toBe(1);
  });
});
