// Logs crafted to reach the corners: sources as Windows' XML really names
// them, level words in other languages, files that only look like a log,
// and lines long enough to show a slow pattern.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { analyzeText, type Options } from "../src/analyze.ts";
import { copy } from "../src/copy.ts";
import { detect } from "../src/detect.ts";
import { levelWord } from "../src/formats/levels.ts";
import { eventSource, known } from "../src/known.ts";
import { lines, PIECE } from "../src/lines.ts";
import type { Result } from "../src/model.ts";
import { CLOSE, normalize, OPEN } from "../src/normalize.ts";
import {
  about,
  groupName,
  groupPlain,
  isNoise,
  verdict,
} from "../src/summary.ts";

const OPTIONS: Options = { offset: () => 0 };
const slot = (kind: string) => `${OPEN}${kind}${CLOSE}`;

/** One XML event as Windows writes it, under a <Provider> with these
 * attributes. */
const xmlEvent = (provider: string, id: number, level: number, i = 0) =>
  `<Event xmlns="http://schemas.microsoft.com/win/2004/08/events/event"><System><Provider ${provider} /><EventID>${id}</EventID><Level>${level}</Level><TimeCreated SystemTime="2026-10-${String(8 + (i % 7)).padStart(2, "0")}T10:00:${String(i % 60).padStart(2, "0")}.1234567Z" /><Channel>System</Channel></System><EventData><Data Name="x">event ${i}</Data></EventData></Event>`;
const xml = (events: string[]) =>
  analyzeText(
    `<Events>\r\n${events.join("\r\n")}\r\n</Events>`,
    "ev-xml",
    OPTIONS,
  );

const DCOM =
  'Name="Microsoft-Windows-DistributedCOM" Guid="{1b562e86-b7aa-4131-badc-b6f3a001407e}" EventSourceName="DCOM"';
const SCM =
  'Name="Service Control Manager" Guid="{555908d1-a6d7-4695-8e1e-26931d2012f4}" EventSourceName="Service Control Manager"';

describe("sources as Windows' XML names them", () => {
  test("DCOM 10016 is noise, never the verdict", () => {
    const r = xml([
      ...Array.from({ length: 50 }, (_, i) => xmlEvent(DCOM, 10016, 2, i)),
      xmlEvent(SCM, 7031, 2),
    ]);
    expect(verdict(r)).toBe(
      "The most frequent problem is Service Control Manager 7031, once.",
    );
    const dcom = r.groups.find((g) => g.id === "10016");
    if (!dcom) throw new Error("no DCOM group");
    expect(isNoise(dcom, "windows")).toBe(true);
    // Named as Event Viewer shows it.
    expect(groupName(dcom, "windows").name).toBe("DistributedCOM 10016");
  });

  test("only DCOM: nothing but noise", () => {
    const r = xml(
      Array.from({ length: 5 }, (_, i) => xmlEvent(DCOM, 10016, 2, i)),
    );
    expect(verdict(r)).toBe(copy.nothingButNoise);
  });

  test("the fixtures write DCOM as Windows does", () => {
    const file = readFileSync(
      join(import.meta.dirname, "fixtures", "system.xml"),
      "utf8",
    );
    expect(file).toContain(
      'Name="Microsoft-Windows-DistributedCOM" Guid="{1b562e86-b7aa-4131-badc-b6f3a001407e}" EventSourceName="DCOM"',
    );
    expect(file).not.toContain('EventSourceName="DistributedCOM"');
  });

  // Each known source as a provider's Name and EventSourceName, in the
  // pairs Windows writes (checked against a real PC's event log and its
  // registered sources; no real events here).
  test.each([
    ["Microsoft-Windows-Kernel-Power", null, 41],
    ["Microsoft-Windows-Kernel-General", null, 12],
    ["Microsoft-Windows-Kernel-Boot", null, 27],
    ["EventLog", null, 6008],
    ["User32", "User32", 1074],
    ["Microsoft-Windows-WER-SystemErrorReporting", "BugCheck", 1001],
    ["Microsoft-Windows-WHEA-Logger", null, 18],
    ["disk", null, 7],
    ["Microsoft-Windows-Ntfs", null, 55],
    ["volmgr", null, 161],
    ["Service Control Manager", "Service Control Manager", 7031],
    ["Application Error", null, 1000],
    ["Application Hang", null, 1002],
    ["Microsoft-Windows-WindowsUpdateClient", null, 20],
    ["Microsoft-Windows-DistributedCOM", "DCOM", 10016],
    ["Schannel", null, 36887],
    ["Microsoft-Windows-Time-Service", null, 129],
    ["Microsoft-Windows-DNS-Client", null, 1014],
    ["Netwtw14", null, 5010],
    ["e1dexpress", null, 27],
    ["e2fnexpress", null, 27],
  ] as const)("%s (%s) %d", (name, classic, id) => {
    expect(known(eventSource(name, classic), String(id))).not.toBeNull();
  });

  test("the name a source is shown by", () => {
    expect(
      eventSource("Microsoft-Windows-WER-SystemErrorReporting", "BugCheck"),
    ).toBe("BugCheck");
    expect(eventSource("Microsoft-Windows-DistributedCOM", "DCOM")).toBe(
      "Microsoft-Windows-DistributedCOM",
    );
    expect(eventSource("Microsoft-Windows-Winlogon", "Wlclntfy")).toBe(
      "Wlclntfy",
    );
    expect(eventSource("Microsoft-Windows-Kernel-Power", null)).toBe(
      "Microsoft-Windows-Kernel-Power",
    );
  });
});

/** A CSV of Windows events in another language: header, then [level,
 * source, id] rows, day first. */
const table = (header: string, rows: [string, string, number][]) =>
  analyzeText(
    [
      header,
      ...rows.map(
        ([level, source, id], i) =>
          `${level},${String(8 + (i % 7)).padStart(2, "0")}.10.2026 14:${String(i % 60).padStart(2, "0")}:05,${source},${id},None,"x ${i}"`,
      ),
    ].join("\r\n"),
    "ev-csv",
    OPTIONS,
  );

describe("level words in other languages", () => {
  test.each([
    ["nl", ["Kritiek", "Fout", "Waarschuwing", "Informatie"]],
    ["pl", ["Krytyczny", "Błąd", "Ostrzeżenie", "Informacje"]],
    ["pl, plural", ["Krytyczne", "Błędy", "Ostrzeżenia", "Informacje"]],
    ["ru", ["Критический", "Ошибка", "Предупреждение", "Сведения"]],
    ["ja", ["重大", "エラー", "警告", "情報"]],
    ["zh-Hans", ["关键", "错误", "警告", "信息"]],
  ] as const)("%s", (_language, words) => {
    expect(words.map(levelWord)).toEqual([
      "critical",
      "error",
      "warning",
      "information",
    ]);
  });

  test("a Dutch log full of errors isn't 'nothing needs a look'", () => {
    const r = table("Niveau,Datum en tijd,Bron,Gebeurtenis-id,Taakcategorie", [
      ["Fout", "MyApp", 1],
      ["Fout", "MyApp", 1],
      ["Waarschuwing", "MyApp", 2],
    ]);
    expect(r.levels).toEqual({
      critical: 0,
      error: 2,
      warning: 1,
      information: 0,
    });
    expect(verdict(r)).toBe("The most frequent problem is MyApp 1, twice.");
  });

  const UNKNOWN =
    "Taso,Päivämäärä ja aika,Lähde,Tapahtuman tunnus,Tehtäväluokka";

  test("level words this page doesn't know: no verdict that all is well", () => {
    const r = table(UNKNOWN, [
      ["Virhe", "MyApp", 1],
      ["Virhe", "MyApp", 1],
      ["Tiedot", "Kernel-General", 12],
    ]);
    expect(r.unknownLevels).toBe(3);
    expect(verdict(r)).toBe(
      "This log’s level names aren’t in a language this page knows, so it can’t tell errors from information.",
    );
    expect(about(r)).not.toContain(copy.levelsUnknown);
    expect(verdict(r)).not.toContain("Nothing here needs a look");
  });

  test("…and with a known problem, the verdict stands and the line says it", () => {
    const r = table(UNKNOWN, [
      ["Virhe", "MyApp", 1],
      ["Virhe", "BugCheck", 1001],
    ]);
    expect(verdict(r)).toBe("Windows stopped with a blue screen once.");
    expect(about(r).endsWith(copy.levelsUnknown)).toBe(true);
  });

  test("…and 'only warnings' isn't said either", () => {
    const r = table(UNKNOWN, [["Varoitus", "DNS Client Events", 1014]]);
    expect(verdict(r)).toBe(
      "The most frequent problem is DNS Client Events 1014, once.",
    );
  });

  test("an English log has no unknown levels", () => {
    const r = analyzeText(
      "Level,Date and Time,Source,Event ID,Task Category\r\nError,10/14/2026 2:32:05 PM,MyApp,1,None,x",
      "ev-csv",
    );
    expect(r.unknownLevels).toBe(0);
  });

  // The Verbose word isn't confirmed in any of these languages. Beside a
  // word for a problem this page knows, it's one odd word: information,
  // and nothing said. Beside "information" alone it could be this log's
  // word for an error, so nothing is called fine.
  const LANGUAGES = [
    [
      "nl",
      "Niveau,Datum en tijd,Bron,Gebeurtenis-id,Taakcategorie",
      "Informatie",
      "Waarschuwing",
      "Uitgebreid",
    ],
    [
      "pl",
      "Poziom,Data i godzina,Źródło,Identyfikator zdarzenia,Kategoria zadania",
      "Informacje",
      "Ostrzeżenie",
      "Pełne",
    ],
    [
      "ru",
      "Уровень,Дата и время,Источник,Код события,Категория задачи",
      "Сведения",
      "Предупреждение",
      "Подробно",
    ],
    [
      "ja",
      "レベル,日付と時刻,ソース,イベント ID,タスクのカテゴリ",
      "情報",
      "警告",
      "詳細",
    ],
    [
      "zh-Hans",
      "级别,日期和时间,来源,事件 ID,任务类别",
      "信息",
      "警告",
      "详细",
    ],
  ] as const;
  const infos = (info: string) =>
    Array.from({ length: 19 }, (): [string, string, number] => [
      info,
      "MyApp",
      1,
    ]);

  test.each(LANGUAGES)(
    "%s: one Verbose word beside a known warning",
    (_l, header, info, warning, verbose) => {
      const r = table(header, [
        ...infos(info),
        [warning, "MyApp", 2],
        [verbose, "MyApp", 1],
      ]);
      expect(r.unknownLevels).toBe(0);
      expect(r.levels.information).toBe(20);
      expect(r.levels.warning).toBe(1);
      expect(about(r)).not.toContain(copy.levelsUnknown);
    },
  );

  test.each(LANGUAGES)(
    "%s: one Verbose word beside information alone",
    (_l, header, info, _warning, verbose) => {
      const r = table(header, [...infos(info), [verbose, "MyApp", 1]]);
      expect(r.unknownLevels).toBe(1);
      expect(verdict(r)).toBe(copy.levelsUnknown);
    },
  );

  test("Swedish: “Information” as in English, its errors unknown, nothing called fine", () => {
    const r = table("Nivå,Datum och tid,Källa,Händelse-ID,Aktivitetskategori", [
      ["Information", "MyApp", 1],
      ["Fel", "MyApp", 2],
      ["Fel", "MyApp", 2],
      ["Varning", "MyApp", 3],
    ]);
    expect(r.unknownLevels).toBe(3);
    expect(verdict(r)).toBe(copy.levelsUnknown);
    expect(verdict(r)).not.toBe(copy.nothing);
  });

  // A Security export: its first column holds keywords, not levels.
  const security =
    "Trefwoorden,Datum en tijd,Bron,Gebeurtenis-id,Taakcategorie\r\n" +
    'Controle geslaagd,14-10-2026 14:32:05,Microsoft Windows security auditing.,4624,Aanmelden,"Aanmelden gelukt."\r\n' +
    'Controle mislukt,13-10-2026 09:10:00,Microsoft Windows security auditing.,4625,Aanmelden,"Aanmelden mislukt."\r\n' +
    'Controle geslaagd,12-10-2026 08:00:00,Microsoft Windows security auditing.,4624,Aanmelden,"Aanmelden gelukt."';

  test("a Dutch Security CSV: keywords aren't levels, dates and IDs still found", () => {
    expect(detect(security)).toBe("ev-csv");
    const r = analyzeText(security, "ev-csv", OPTIONS);
    expect(r.events).toBe(3);
    expect(r.skipped).toBe(0);
    expect(r.unknownLevels).toBe(0);
    expect(r.levels.information).toBe(3);
    expect(r.first).toBe(Date.UTC(2026, 9, 12, 8));
    expect(r.groups.map((g) => g.id).sort()).toEqual(["4624", "4625"]);
    expect(verdict(r)).toBe(copy.nothing);
  });
});

describe("what isn't an Event Viewer table", () => {
  test.each([
    "name,date,amount,id\nbob,2026-10-14 10:00,12,4\nann,2026-10-13 09:00,3,5",
    "id,when,total,count,note\n7,2026-10-14 10:00,12,4,ok\n8,2026-10-13 09:00,3,5,ok",
    "date,level,source,id\n2026-10-14 10:00,Error,MyApp,4\n2026-10-13 09:00,Error,MyApp,5",
  ])("%s", (text) => {
    expect(detect(text)).toBeNull();
  });

  test("a table whose levels are mostly blank still is one", () => {
    const rows = ["Уровень,Дата и время,Источник,Код события,Категория задачи"];
    for (let i = 0; i < 10; i++) {
      rows.push(
        `${i < 3 ? "Ошибка" : ""},14.10.2026 14:3${i}:05,MyApp,${i},Нет,"x"`,
      );
    }
    // Without the header line too.
    expect(detect(rows.join("\r\n"))).toBe("ev-csv");
    expect(detect(rows.slice(1).join("\r\n"))).toBe("ev-csv");
  });

  test("a table in a language this page doesn't know still is one", () => {
    const rows = [
      "Taso,Päivämäärä ja aika,Lähde,Tapahtuman tunnus,Tehtäväluokka",
    ];
    for (let i = 0; i < 5; i++)
      rows.push(`Virhe,14.10.2026 14:3${i}:05,MyApp,${i},Ei mitään,"x"`);
    expect(detect(rows.join("\r\n"))).toBe("ev-csv");
    // Level, date, source and ID alone.
    expect(
      detect(
        "Virhe,14.10.2026 14:32:05,MyApp,1\nVirhe,14.10.2026 14:33:05,MyApp,2",
      ),
    ).toBe("ev-csv");
  });
});

describe("syslog without a year", () => {
  const syslog = (text: string, now: Date) =>
    analyzeText(text, "syslog", { now, offset: () => 0 });
  const NOW = new Date(2026, 9, 15, 12);

  test("a first line later this month is last year's", () => {
    const r = syslog(
      "Oct 20 10:00:00 host app[1]: error: disk full\nNov  1 10:00:00 host app[1]: ok",
      NOW,
    );
    expect(r.first).toBe(Date.UTC(2025, 9, 20, 10));
    expect(r.last).toBe(Date.UTC(2025, 10, 1, 10));
  });

  test("earlier this month, and today, are this year's", () => {
    expect(syslog("Oct  2 10:00:00 host app: a", NOW).first).toBe(
      Date.UTC(2026, 9, 2, 10),
    );
    expect(syslog("Oct 15 11:00:00 host app: a", NOW).first).toBe(
      Date.UTC(2026, 9, 15, 11),
    );
  });

  test("a server a few hours ahead of the viewer is still this year", () => {
    expect(syslog("Oct 15 23:30:00 host app: a", NOW).first).toBe(
      Date.UTC(2026, 9, 15, 23, 30),
    );
  });
});

describe("XML oddities", () => {
  const rendered = (message: string) =>
    `<Event><System><Provider Name="MyApp"/><EventID>1</EventID><Level>2</Level><TimeCreated SystemTime="2026-10-14T10:00:00.000Z"/></System><RenderingInfo Culture="en-US"><Message>${message}</Message></RenderingInfo></Event>`;
  const messages = (r: Result) => r.groups.flatMap((g) => g.samples);

  test("a character reference past Unicode spoils only itself", () => {
    const r = analyzeText(
      `<Events>${rendered("ok")}\n${rendered("x &#x110000; &#1114112; y &amp; z")}\n${rendered("ok")}</Events>`,
      "ev-xml",
      OPTIONS,
    );
    expect(r.events).toBe(3);
    expect(messages(r)).toContain("x &#x110000; &#1114112; y & z");
  });

  test("CDATA is read as text", () => {
    const r = analyzeText(
      `<Events>${rendered("<![CDATA[a < b && c]]> &amp; d")}</Events>`,
      "ev-xml",
      OPTIONS,
    );
    expect(messages(r)).toEqual(["a < b && c & d"]);
    const data = analyzeText(
      `<Events><Event><System><Provider Name="MyApp"/><EventID>1</EventID><Level>2</Level></System><EventData><Data><![CDATA[1 < 2]]></Data></EventData></Event></Events>`,
      "ev-xml",
      OPTIONS,
    );
    expect(messages(data)).toEqual(["1 < 2"]);
  });
});

describe("Windows events, read accurately", () => {
  test("Intel Wi-Fi: its resets are known, its routine events aren't", () => {
    for (const id of ["5002", "5005", "5010"]) {
      expect(known("Netwtw14", id)).not.toBeNull();
    }
    for (const id of ["6062", "7021", "7025", "5007"]) {
      expect(known("Netwtw14", id), id).toBeNull();
    }
    expect(known("Netwtw14", "5010")?.plain).toBe(
      "The Wi-Fi adapter hit an error, which drops the connection for a moment. Many in a row point to the Wi-Fi driver; an updated one often helps.",
    );
  });

  test("Kernel-Power 41 leads with a crash or lost power", () => {
    expect(known("Kernel-Power", "41")?.plain).toMatch(
      /^The PC restarted without shutting down first: it crashed or lost power/,
    );
  });

  test("a Fast Startup boot (Kernel-Boot 27, type 0x1) counts as a start", () => {
    const row = (time: string, id: number, message: string) =>
      `Information,10/${time},Microsoft-Windows-Kernel-Boot,${id},None,"${message}"`;
    const r = analyzeText(
      [
        "Level,Date and Time,Source,Event ID,Task Category",
        row("14/2026 8:00:00 AM", 27, "The boot type was 0x1."),
        row("13/2026 8:00:00 AM", 27, "The boot type was 0x0."),
      ].join("\r\n"),
      "ev-csv",
    );
    expect(r.restarts).toEqual([Date.UTC(2026, 9, 14, 8)]);
    // Without rendered text, as wevtutil's /f:xml writes it.
    const raw = xml([
      xmlEvent('Name="Microsoft-Windows-Kernel-Boot"', 27, 4).replace(
        '<Data Name="x">event 0</Data>',
        "<Data Name='BootType'>1</Data><Data Name='LoadOptions'> NOEXECUTE=OPTIN</Data>",
      ),
      xmlEvent('Name="Microsoft-Windows-Kernel-Boot"', 27, 4, 3).replace(
        '<Data Name="x">event 3</Data>',
        "<Data Name='BootType'>0</Data>",
      ),
    ]);
    expect(raw.restarts).toHaveLength(1);
  });

  test("a group's sentence is the known event's", () => {
    const r = xml([xmlEvent(DCOM, 10016, 2)]);
    const [group] = r.groups;
    if (!group) throw new Error("no group");
    expect(groupPlain(group, r)).toMatch(
      /denied a permission it asked for, by design\.$/,
    );
  });
});

describe("long lines cost one pass", () => {
  test("lines cut across pieces, CRLF or LF, the last without a break", () => {
    const got: string[] = [];
    const split = lines((line) => {
      got.push(line);
      return true;
    });
    for (const piece of ["a\r", "\nb", "c\n\nd\r\n", "e"]) split.push(piece);
    split.end();
    expect(got).toEqual(["a", "bc", "", "d", "e"]);
  });

  test("a line turned away stops the rest", () => {
    const got: string[] = [];
    const split = lines((line) => {
      got.push(line);
      return line !== "stop";
    });
    expect(split.push("a\nstop\nb\n")).toBe(false);
    expect(got).toEqual(["a", "stop"]);
  });

  test("32 MB without a line break goes on in pieces, never held whole", () => {
    const chunk = "x".repeat(50_000);
    let length = 0;
    let longest = 0;
    let ends = 0;
    const split = lines((line, more) => {
      length += line.length;
      longest = Math.max(longest, line.length);
      if (!more) ends++;
      return true;
    });
    const start = performance.now();
    for (let i = 0; i < 671; i++) split.push(chunk);
    split.end();
    expect(length).toBe(671 * 50_000);
    expect(longest).toBeLessThanOrEqual(PIECE);
    expect(ends).toBe(1);
    expect(performance.now() - start).toBeLessThan(500);
  });

  test("IPv6 in a long run of hex and colons", () => {
    const start = performance.now();
    normalize("ab:".repeat((160 * 1024) / 3));
    expect(performance.now() - start).toBeLessThan(100);
  });

  test("1 MB of the same, and of the same ending in a colon", () => {
    const start = performance.now();
    normalize("ab:".repeat((1 << 20) / 3));
    normalize(`${"ab:".repeat((1 << 20) / 3)} x`);
    expect(performance.now() - start).toBeLessThan(300);
  });

  test.each([
    ["peer fe80::1ff:fe23:4567:890a lost", `peer ${slot("ip")} lost`],
    ["from ::1 port", `from ${slot("ip")} port`],
    ["link fe80::1%eth0 up", `link ${slot("ip")}%eth0 up`],
    ["mac 00:1a:2b:3c:4d:5e", `mac ${slot("ip")}`],
    ["[2001:db8::1]:443", `[${slot("ip")}]:${slot("n")}`],
    ["at 22:46:02", `at ${slot("time")}`],
    [
      "connect to 2001:db8::1: Connection refused",
      `connect to ${slot("ip")}: Connection refused`,
    ],
    ["client=unknown[IPv6:2001:db8::1]", `client=unknown[IPv6:${slot("ip")}]`],
    ["from addr:fe80::1ff:fe23:4567:890a", `from addr:${slot("ip")}`],
    ["to :2001:db8::1 now", `to :${slot("ip")} now`],
    ["mapped ::ffff:192.168.1.1 here", `mapped ${slot("ip")} here`],
    ["nat64 64:ff9b::192.0.2.1 here", `nat64 ${slot("ip")} here`],
    ["full 0:0:0:0:0:ffff:10.0.0.1 here", `full ${slot("ip")} here`],
    ["at [::ffff:10.0.0.1]:443", `at [${slot("ip")}]:${slot("n")}`],
    ["the cafe:babe", "the cafe:babe"],
  ])("%s", (message, expected) => {
    expect(normalize(message)).toBe(expected);
  });
});
