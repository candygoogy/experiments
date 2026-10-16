import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { analyzeText, type Options } from "../src/analyze.ts";
import { detect, encoding } from "../src/detect.ts";
import { canonical, entries, known } from "../src/known.ts";
import { SAMPLES, type Result } from "../src/model.ts";
import {
  CLOSE,
  normalize,
  normalizePath,
  OPEN,
  parts,
} from "../src/normalize.ts";
import {
  about,
  formatRange,
  groupName,
  groupPlain,
  times,
  verdict,
} from "../src/summary.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const OPTIONS: Options = {
  now: new Date(Date.UTC(2026, 9, 15)),
  offset: () => 0,
};
const read = (name: string): Result => {
  const b = new Uint8Array(readFileSync(join(FIXTURES, name)));
  const t = new TextDecoder(encoding(b)).decode(b);
  const f = detect(t.slice(0, 65536));
  if (!f) throw new Error(name);
  return analyzeText(t, f, OPTIONS);
};
const slot = (kind: string) => `${OPEN}${kind}${CLOSE}`;

/** A CSV of Windows events: [level, source, id, message] each. */
const windows = (rows: [string, string, number, string][], day = 8) =>
  analyzeText(
    [
      "Level,Date and Time,Source,Event ID,Task Category",
      ...rows.map(
        ([l, s, id, m], i) =>
          `${l},10/${day}/2026 ${(i % 12) + 1}:00:00 PM,${s},${id},None,"${m}"`,
      ),
    ].join("\n"),
    "ev-csv",
  );

describe("normalizing a message", () => {
  test.each([
    [
      "CLSID {2593F8B9-4EAF-457C-B68A-50F6B8EA6B54} here",
      `CLSID ${slot("guid")} here`,
    ],
    ["SID (S-1-5-21-1-2-3-1001)", `SID (${slot("sid")})`],
    ["saved in: C:\\WINDOWS\\MEMORY.DMP.", `saved in: ${slot("path")}.`],
    ["PDO name: \\Device\\0000004a) was", `PDO name: ${slot("path")}) was`],
    ["file /var/cache/nginx/x/1 while", `file ${slot("path")} while`],
    ["from 203.0.113.9 port 4022", `from ${slot("ip")} port ${slot("n")}`],
    ["peer fe80::1ff:fe23:4567:890a lost", `peer ${slot("ip")} lost`],
    ["at 22:46:02 on 2026-10-14", `at ${slot("time")} on ${slot("date")}`],
    ["bugcheck 0x0000009f", `bugcheck ${slot("hex")}`],
    ["the “Example” service", `the ${slot("name")} service`],
    ["see https://example.com/a?b=1 now", `see ${slot("url")} now`],
    ["it did this 3 time(s)", `it did this ${slot("n")} time(s)`],
  ])("%s", (message, expected) => {
    expect(normalize(message)).toBe(expected);
  });

  test("Event Viewer's direction marks go", () => {
    expect(normalize("time \u200e2026\u200e-\u200e10\u200e-\u200e14")).toBe(
      `time ${slot("date")}`,
    );
  });

  test("a computer and user name isn't a path", () => {
    expect(normalize("to the user EXAMPLE-PC\\user SID")).toBe(
      "to the user EXAMPLE-PC\\user SID",
    );
  });

  test("request paths keep their words, lose their ids", () => {
    expect(normalizePath("/api/orders/12?page=2")).toBe(
      `/api/orders/${slot("n")}`,
    );
    expect(normalizePath("/files/3f2a9c1e8b7d6a5f4e3d")).toBe(
      `/files/${slot("hex")}`,
    );
  });

  test("a normalized message in parts, for drawing", () => {
    expect(parts(`a ${slot("n")} b`)).toEqual([
      { text: "a " },
      { slot: "n" },
      { text: " b" },
    ]);
  });
});

describe("known Windows events", () => {
  test.each([
    ["Kernel-Power", "41"],
    ["EventLog", "6008"],
    ["BugCheck", "1001"],
    ["WHEA-Logger", "17"],
    ["WHEA-Logger", "18"],
    ["WHEA-Logger", "19"],
    ["WHEA-Logger", "47"],
    ["Disk", "7"],
    ["Disk", "51"],
    ["Disk", "153"],
    ["Ntfs", "55"],
    ["Ntfs", "98"],
    ["volmgr", "161"],
    ["Service Control Manager", "7000"],
    ["Service Control Manager", "7001"],
    ["Service Control Manager", "7009"],
    ["Service Control Manager", "7023"],
    ["Service Control Manager", "7031"],
    ["Service Control Manager", "7034"],
    ["Application Error", "1000"],
    ["Application Hang", "1002"],
    ["Microsoft-Windows-WindowsUpdateClient", "20"],
    ["DistributedCOM", "10016"],
    ["Schannel", "36887"],
    ["Schannel", "36874"],
    ["Microsoft-Windows-Time-Service", "129"],
    ["Microsoft-Windows-Time-Service", "134"],
    ["DNS Client Events", "1014"],
    ["Microsoft-Windows-DNS-Client", "1014"],
    ["Netwtw14", "5010"],
    ["e1dexpress", "27"],
    ["e2fnexpress", "27"],
    ["DCOM", "10016"],
    ["Microsoft-Windows-Kernel-General", "12"],
    ["Microsoft-Windows-Kernel-Boot", "27"],
  ])("%s %s", (source, id) => {
    expect(known(source, id)?.plain).toBeTruthy();
  });

  test("the sources as Event Viewer and the XML name them are the same", () => {
    expect(canonical("Microsoft-Windows-Kernel-Power")).toBe(
      canonical("Kernel-Power"),
    );
    expect(canonical("DNS Client Events")).toBe(
      canonical("Microsoft-Windows-DNS-Client"),
    );
    expect(canonical("Netwtw10")).toBe(canonical("Netwtw14"));
  });

  test("DCOM 10016 is noise; Kernel-Power 41 marks a restart", () => {
    expect(known("DistributedCOM", "10016")?.noise).toBe(true);
    expect(known("Microsoft-Windows-DistributedCOM", "10016")?.plain).toMatch(
      /^Common noise, usually safe to ignore/,
    );
    expect(known("Kernel-Power", "41")?.marker).toBe("unexpected");
  });

  test("each sentence is plain: a capital, a full stop, no shouting", () => {
    for (const [, , entry] of entries()) {
      expect(entry.plain).toMatch(/^[A-Z].*\.$/);
      expect(entry.plain).not.toMatch(/\b[A-Z]{4,}\b(?<!\b(PCIe|TLS)\b)/);
      expect(entry.plain).not.toMatch(/\bNow and then\b/);
    }
  });
});

describe("the verdict, worst first", () => {
  test("restarts without shutting down, with the blue screens among them", () => {
    expect(verdict(read("en-system.csv"))).toBe(
      "This PC restarted without shutting down 3 times, once after a blue screen.",
    );
  });

  test("a blue screen alone", () => {
    const r = windows([
      ["Error", "BugCheck", 1001, "x"],
      ["Error", "BugCheck", 1001, "y"],
    ]);
    expect(verdict(r)).toBe("Windows stopped with a blue screen twice.");
  });

  test("hardware errors that couldn't be fixed", () => {
    const r = windows([["Error", "Microsoft-Windows-WHEA-Logger", 18, "x"]]);
    expect(verdict(r)).toBe("The hardware hit an error it couldn’t fix once.");
  });

  test("a failing drive", () => {
    const r = windows([["Error", "disk", 7, "bad block"]]);
    expect(verdict(r)).toBe(
      "A drive reported problems once. It may be failing: back up your files.",
    );
  });

  test("otherwise the most frequent problem, never the noise", () => {
    const r = windows([
      ...Array.from({ length: 9 }, (): [string, string, number, string] => [
        "Error",
        "DistributedCOM",
        10016,
        "noise",
      ]),
      ["Error", "Service Control Manager", 7031, "a"],
      ["Error", "Service Control Manager", 7031, "b"],
    ]);
    expect(verdict(r)).toBe(
      "The most frequent problem is Service Control Manager 7031, twice.",
    );
  });

  test("only warnings", () => {
    const r = windows([["Warning", "DNS Client Events", 1014, "a"]]);
    expect(verdict(r)).toBe(
      "Only warnings here. The most frequent is DNS Client Events 1014, once.",
    );
  });

  test("only noise, or nothing at all", () => {
    expect(verdict(windows([["Error", "DistributedCOM", 10016, "x"]]))).toBe(
      "Nothing here needs a look. The only errors are common noise.",
    );
    expect(verdict(windows([["Information", "Kernel-General", 12, "x"]]))).toBe(
      "Nothing here needs a look.",
    );
  });

  test("a web server: a burst of failures", () => {
    expect(verdict(read("access.log"))).toBe(
      "Your server failed 31 requests in one burst on Oct 14, between 03:10 and 03:24 UTC.",
    );
  });

  test("a web server: no failures, a missing page that isn't a bot's", () => {
    const line = (path: string, status: number) =>
      `192.0.2.1 - - [08/Oct/2026:10:00:00 +0000] "GET ${path} HTTP/1.1" ${status} 10 "-" "-"`;
    const r = analyzeText(
      [
        line("/", 200),
        line("/old", 404),
        line("/old", 404),
        line("/.env", 404),
      ].join("\n"),
      "access",
    );
    expect(verdict(r)).toBe(
      "Nothing failed on the server’s side. The most requested missing page is /old, twice.",
    );
    expect(verdict(analyzeText(line("/", 200), "access"))).toBe(
      "Nothing failed: every request was answered.",
    );
  });

  test("server logs: the most frequent error, in its own words", () => {
    expect(verdict(read("nginx-error.log"))).toBe(
      "The most frequent error is “connect() failed (…: Connection refused) while connecting to upstream”, 31 times.",
    );
  });

  test("the line under it", () => {
    expect(about(read("system.xml"))).toBe(
      "436 events in the System log, Oct 8 to 14, 2026, exported as XML. The most recent was on Oct 14 at 22:51.",
    );
    expect(about(read("access.log"))).toBe(
      "3,396 requests in a web server access log, Oct 8 to 15, 2026. 1.0% of them failed on the server’s side (5xx). Times are in UTC, as the log writes them.",
    );
  });
});

describe("rows", () => {
  test("a web group: its status as the label, its path as the name, a plain line", () => {
    const r = read("access.log");
    const bots = r.groups.find((g) => g.path === "/wp-login.php");
    if (!bots) throw new Error("no group");
    expect(groupName(bots, "web")).toEqual({
      label: "404 Not Found",
      name: "/wp-login.php",
    });
    expect(groupPlain(bots, r)).toMatch(/^Bots looking for a WordPress login/);
    const burst = r.groups[0];
    if (!burst) throw new Error("no group");
    expect(groupPlain(burst, r)).toBe(
      "The server couldn’t reach the app behind it. 31 of these came in one burst, Oct 14 from 03:10 to 03:24 UTC.",
    );
  });
});

describe("memory stays flat", () => {
  test("a group keeps at most SAMPLES messages", () => {
    const rows = Array.from(
      { length: SAMPLES + 50 },
      (_, i): [string, string, number, string] => [
        "Error",
        "Example",
        1,
        `message ${i}`,
      ],
    );
    const r = windows(rows);
    expect(r.groups[0]?.count).toBe(SAMPLES + 50);
    expect(r.groups[0]?.samples).toHaveLength(SAMPLES);
  });
});

describe("dates", () => {
  test.each([
    [Date.UTC(2026, 9, 8), Date.UTC(2026, 9, 15), "Oct 8 to 15, 2026"],
    [Date.UTC(2026, 9, 28), Date.UTC(2026, 10, 3), "Oct 28 to Nov 3, 2026"],
    [
      Date.UTC(2025, 11, 28),
      Date.UTC(2026, 0, 3),
      "Dec 28, 2025 to Jan 3, 2026",
    ],
    [Date.UTC(2026, 9, 8, 1), Date.UTC(2026, 9, 8, 9), "Oct 8, 2026"],
  ])("%s to %s", (a, b, expected) => {
    expect(formatRange(a, b)).toBe(expected);
  });

  test("once, twice, n times", () => {
    expect([times(1), times(2), times(1200)]).toEqual([
      "once",
      "twice",
      "1,200 times",
    ]);
  });
});
