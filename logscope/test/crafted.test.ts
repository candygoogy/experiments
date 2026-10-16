// Logs crafted to break the reader: text in a Windows code page, quotes
// that never close, dates that only settle late, more kinds of message
// than the page keeps, lines with no end, and markup that never closes.
// Every machine, name and message is made up.
import { Window } from "happy-dom";
import { describe, expect, test } from "vitest";
import {
  analyzer,
  analyzeText,
  MAX_GROUPS,
  type Options,
} from "../src/analyze.ts";
import { copy, fill } from "../src/copy.ts";
import { detect, encoding } from "../src/detect.ts";
import { levelWord } from "../src/formats/levels.ts";
import { SETTLE } from "../src/formats/windows-table.ts";
import { canonical, known } from "../src/known.ts";
import { lines, PIECE } from "../src/lines.ts";
import type { Format, Result } from "../src/model.ts";
import { CLOSE, OPEN } from "../src/normalize.ts";
import { MAX_RECORD, records } from "../src/records.ts";
import { renderAnswer, row } from "../src/render.ts";
import {
  about,
  formatRange,
  groupName,
  groupPlain,
  isNoise,
  verdict,
  zoneName,
} from "../src/summary.ts";

const OPTIONS: Options = {
  now: new Date(Date.UTC(2026, 9, 15)),
  offset: () => 0,
};
const slot = (kind: string) => `${OPEN}${kind}${CLOSE}`;

/** Text as a Windows code page writes it (the characters this file uses
 * only). */
function encode(text: string, name: string): Uint8Array {
  const decoder = new TextDecoder(name);
  const bytes = new Map<string, number>();
  for (let b = 0x80; b <= 0xff; b++) {
    bytes.set(decoder.decode(new Uint8Array([b])), b);
  }
  return Uint8Array.from([...text], (c) => {
    const code = c.charCodeAt(0);
    const b = code < 0x80 ? code : bytes.get(c);
    if (b === undefined) throw new Error(`${c} isn't in ${name}`);
    return b;
  });
}

/** A file read as the page reads it: encoding and format from its start. */
function readBytes(bytes: Uint8Array): Result {
  const text = new TextDecoder(encoding(bytes.subarray(0, 65536))).decode(
    bytes,
  );
  const format = detect(text.slice(0, 65536));
  if (!format) throw new Error("not a log");
  return analyzeText(text, format, OPTIONS);
}

/** Text fed to the analyzer as the page's worker feeds it: through
 * lines(), in chunks of this size. */
function stream(text: string, format: Format, chunk = 65536): Result {
  const run = analyzer(format, OPTIONS);
  const split = lines((line, more) => {
    run.line(line, more);
    return true;
  });
  for (let at = 0; at < text.length; at += chunk) {
    split.push(text.slice(at, at + chunk));
  }
  split.end();
  return run.end();
}

/** Letters only, so normalizing keeps each one apart. */
const word = (i: number) =>
  i.toString(26).replace(/\d/g, (d) => "qrstuvwxyz"[Number(d)] ?? "q");

// Polish Event Viewer, saved again in Windows' Polish code page.
const POLISH = [
  "Poziom,Data i godzina,Źródło,Identyfikator zdarzenia,Kategoria zadania",
  "Krytyczny,14.10.2026 08:00:00,Kernel-Power,41,(63),System został uruchomiony ponownie bez czystego zamknięcia.",
  ...Array.from(
    { length: 5 },
    (_, i) =>
      `Błąd,14.10.2026 0${i + 1}:00:00,Service Control Manager,7031,Brak,Usługa została nieoczekiwanie zakończona.`,
  ),
  ...Array.from(
    { length: 3 },
    (_, i) =>
      `Ostrzeżenie,13.10.2026 0${i + 1}:00:00,DNS Client Events,1014,(1014),Upłynął limit czasu rozpoznawania nazwy.`,
  ),
  "Informacje,13.10.2026 09:00:00,Service Control Manager,7036,Brak,Usługa weszła w stan uruchomienia.",
].join("\r\n");

// Spanish Event Viewer, in Windows' Western code page.
const SPANISH = [
  "Nivel,Fecha y hora,Origen,Id. del evento,Categoría de la tarea",
  "Crítico,14/10/2026 8:00:00,Kernel-Power,41,(63),El sistema se reinició sin apagarse correctamente.",
  "Error,14/10/2026 7:00:00,Service Control Manager,7031,Ninguno,El servicio terminó inesperadamente.",
  "Información,13/10/2026 9:00:00,Service Control Manager,7036,Ninguno,El servicio entró en estado de ejecución.",
].join("\r\n");

describe("a CSV in a Windows code page", () => {
  test("Polish: read as windows-1250, every level counted as written", () => {
    const bytes = encode(POLISH, "windows-1250");
    expect(encoding(bytes)).toBe("windows-1250");
    const r = readBytes(bytes);
    expect(r.levels).toEqual({
      critical: 1,
      error: 5,
      warning: 3,
      information: 1,
    });
    expect(r.unknownLevels).toBe(0);
    expect(verdict(r)).toBe(fill(copy.restarted, { times: "once" }));
  });

  test("Spanish: read as windows-1252, the message column where it is", () => {
    const bytes = encode(SPANISH, "windows-1252");
    expect(encoding(bytes)).toBe("windows-1252");
    const r = readBytes(bytes);
    expect(r.levels).toEqual({
      critical: 1,
      error: 1,
      warning: 0,
      information: 1,
    });
    const scm = r.groups.find((g) => g.id === "7031");
    expect(scm?.samples[0]).toBe("El servicio terminó inesperadamente.");
  });

  test("UTF-8 stays UTF-8, even with a character cut off at the sample's end", () => {
    const bytes = new TextEncoder().encode(`\u{feff}${POLISH}`);
    expect(encoding(bytes)).toBe("utf-8");
    const cut = bytes.indexOf(0xc5); // the first byte of "Ź"
    expect(encoding(bytes.subarray(0, cut + 1))).toBe("utf-8");
  });

  test("a level word read in the wrong encoding is unknown, even next to known ones", () => {
    // What a UTF-8 reading of the Polish file gives.
    const wrong = new TextDecoder("utf-8").decode(
      encode(POLISH, "windows-1250"),
    );
    expect(wrong).toContain("\u{fffd}");
    const r = analyzeText(wrong, "ev-csv", OPTIONS);
    expect(r.unknownLevels).toBe(8);
    expect(about(r)).toContain(copy.levelsUnknown);
    expect(verdict(r)).not.toMatch(/^Only warnings/);
  });

  test("a code-page file stays one, even where two bytes happen to make UTF-8", () => {
    // "Ół" in windows-1250 is 0xD3 0xB3: a valid UTF-8 pair on its own.
    const bytes = encode(
      POLISH.replace("Brak,Usługa", "Brak,Ół Usługa"),
      "windows-1250",
    );
    expect(encoding(bytes)).toBe("windows-1250");
    expect(readBytes(bytes).levels.error).toBe(5);
  });
});

describe("UTF-8 with one bad byte stays UTF-8", () => {
  /** UTF-8 bytes with one stray byte put in before `before`. */
  const stray = (text: string, before: string, byte: number) => {
    const bytes = new TextEncoder().encode(text);
    const at = new TextEncoder().encode(
      text.slice(0, text.indexOf(before)),
    ).length;
    return Uint8Array.from([
      ...bytes.subarray(0, at),
      byte,
      ...bytes.subarray(at),
    ]);
  };
  const replaced = (text: string) => text.split("\u{fffd}").length - 1;

  test("Polish: every level counted, the bad byte one U+FFFD", () => {
    const bytes = stray(POLISH, "nieoczekiwanie", 0xff);
    expect(encoding(bytes)).toBe("utf-8");
    const r = readBytes(bytes);
    expect(r.levels).toEqual({
      critical: 1,
      error: 5,
      warning: 3,
      information: 1,
    });
    expect(r.unknownLevels).toBe(0);
    expect(verdict(r)).toBe(fill(copy.restarted, { times: "once" }));
    const scm = r.groups.find((g) => g.id === "7031");
    expect(scm?.samples.map(replaced)).toEqual([1, 0, 0, 0, 0]);
    expect(scm?.samples[1]).toBe("Usługa została nieoczekiwanie zakończona.");
  });

  test("Russian: still a log, its levels read", () => {
    const russian = [
      "Уровень,Дата и время,Источник,Код события,Категория задачи",
      ...Array.from(
        { length: 4 },
        (_, i) =>
          `Ошибка,14.10.2026 0${i + 1}:00:00,Service Control Manager,7031,Нет,Служба неожиданно завершила работу.`,
      ),
      "Предупреждение,14.10.2026 06:00:00,DNS Client Events,1014,(1014),Время ожидания разрешения имени истекло.",
      "Сведения,14.10.2026 07:00:00,Service Control Manager,7036,Нет,Служба перешла в состояние «Работает».",
    ].join("\r\n");
    const bytes = stray(russian, "неожиданно", 0xc0);
    expect(encoding(bytes)).toBe("utf-8");
    const r = readBytes(bytes);
    expect(r.levels).toEqual({
      critical: 0,
      error: 4,
      warning: 1,
      information: 1,
    });
  });

  test("syslog: the messages read as written", () => {
    const syslog = Array.from(
      { length: 20 },
      (_, i) =>
        `2026-10-14T10:${String(i).padStart(2, "0")}:00Z host app: Benutzer Jürgen → Fehler`,
    ).join("\n");
    const bytes = stray(syslog, "Fehler", 0xe9);
    expect(encoding(bytes)).toBe("utf-8");
    const r = readBytes(bytes);
    const words = r.groups.flatMap((g) => g.samples).join("\n");
    expect(words).toContain("Benutzer Jürgen → Fehler");
    expect(words).not.toContain("Ã");
  });
});

describe("a quote that never closes", () => {
  const row = (i: number) =>
    `Information,10/14/2026 ${(i % 12) + 1}:00:00 PM,Service Control Manager,7036,None,The service entered the running state.`;
  const table = (n: number, stray: number) =>
    [
      "Level,Date and Time,Source,Event ID,Task Category",
      ...Array.from({ length: n }, (_, i) =>
        i === stray ? `${row(i).replace(",The ", ',"The ')}` : row(i),
      ),
    ].join("\n");

  test("30,000 rows: only the line with the stray quote is lost", () => {
    const r = analyzeText(table(30_000, 100), "ev-csv", OPTIONS);
    expect(r.events).toBe(29_999);
    expect(r.skipped).toBe(1);
  });

  test("100 rows after it, the file ending inside the quote", () => {
    const r = analyzeText(table(101, 0), "ev-csv", OPTIONS);
    expect(r.events).toBe(100);
    expect(r.skipped).toBe(1);
  });

  test("closed by the next row's own quote: that row read, the broken one counted", () => {
    const text = [
      "Level,Date and Time,Source,Event ID,Task Category",
      'Error,10/14/2026 11:00:00 PM,Disk,7,None,"Broken quote starts here',
      ...Array.from(
        { length: 5 },
        (_, i) =>
          `Warning,10/14/2026 ${i + 1}:00:00 PM,DNS Client Events,1014,None,"Row ${i}"`,
      ),
    ].join("\n");
    const r = analyzeText(text, "ev-csv", OPTIONS);
    expect(r.events).toBe(5);
    expect(r.skipped).toBe(1);
    const dns = r.groups.find((g) => g.id === "1014");
    expect(dns?.count).toBe(5);
    expect(dns?.samples[0]).toBe("Row 0");
  });

  test("a quote closed then followed by text on the same line is read as before", () => {
    const rows: string[][] = [];
    let skipped = 0;
    const read = records(
      ",",
      (r) => rows.push(r),
      () => skipped++,
    );
    read.push('a,"b"c,d');
    read.end();
    expect(rows).toEqual([["a", "bc", "d"]]);
    expect(skipped).toBe(0);
  });

  test("a record held open gives up past MAX_RECORD, not later", () => {
    const rows: string[][] = [];
    let skipped = 0;
    const read = records(
      ",",
      (r) => rows.push(r),
      () => skipped++,
    );
    read.push('a,"open');
    const line = "x".repeat(1000);
    for (let i = 0; i * 1000 <= MAX_RECORD; i++) read.push(line);
    expect(skipped).toBe(1);
    expect(rows.length).toBeGreaterThan(60);
    read.push("b,c");
    expect(rows.at(-1)).toEqual(["b", "c"]);
  });
});

describe("the day/month order, settled late", () => {
  // en-AU: the day first, with a 12-hour clock, newest first.
  const au = (
    d: number,
    m: number,
    h: number,
    id = 7036,
    level = "Information",
  ) =>
    `${level},${d}/${m}/2026 ${h % 12 || 12}:00:00 ${h < 12 ? "am" : "pm"},${id === 41 ? "Kernel-Power" : "Service Control Manager"},${id},None,An event.`;

  test("2,500 rows of days 1 to 10 first: the later days still decide it", () => {
    const rows: string[] = [];
    for (let i = 0; i < 2500; i++) rows.push(au(10 - (i % 10), 10, i % 24));
    rows.push(au(20, 9, 14, 41, "Critical"));
    for (let d = 30; d >= 13; d--) rows.push(au(d, 9, 9));
    const r = analyzeText(
      ["Level,Date and Time,Source,Event ID,Task Category", ...rows].join("\n"),
      "ev-csv",
      OPTIONS,
    );
    expect(formatRange(r.first, r.last)).toBe("Sep 13 to Oct 10, 2026");
    expect(r.restarts).toEqual([Date.UTC(2026, 8, 20, 14)]);
    const crash = r.groups.find((g) => g.id === "41");
    expect(crash?.last).toBe(Date.UTC(2026, 8, 20, 14));
  });

  test("past SETTLE rows the order is guessed, and a later date overrules it", () => {
    const rows: string[] = [];
    for (let i = 0; i < SETTLE; i++) rows.push(au(1 + (i % 10), 10, 9));
    rows.push(au(20, 9, 14, 41, "Critical"));
    const r = analyzeText(
      ["Level,Date and Time,Source,Event ID,Task Category", ...rows].join("\n"),
      "ev-csv",
      OPTIONS,
    );
    const crash = r.groups.find((g) => g.id === "41");
    expect(crash?.last).toBe(Date.UTC(2026, 8, 20, 14));
  });
});

test("a restart with no readable time: no 'most recent' date", () => {
  const r = analyzeText(
    [
      "Level,Date and Time,Source,Event ID,Task Category",
      "Critical,not a date,Kernel-Power,41,(63),The system has rebooted.",
      "Critical,not a date,Kernel-Power,41,(63),The system has rebooted.",
    ].join("\n"),
    "ev-csv",
    OPTIONS,
  );
  expect(verdict(r)).toBe(fill(copy.restarted, { times: "twice" }));
  expect(about(r)).not.toContain("most recent");
  expect(about(r)).not.toContain("Jan 1");
});

describe("more kinds of message than the page keeps", () => {
  const iso = (message: string) => `2026-10-14T10:00:00Z host app: ${message}`;
  const hit = (path: string, status: number) =>
    `203.0.113.9 - - [14/Oct/2026:03:10:12 +0000] "GET ${path} HTTP/1.1" ${status} 5 "-" "agent"`;
  const table = (rows: string[]) =>
    ["Level,Date and Time,Source,Event ID,Task Category", ...rows].join("\n");

  test("memory stays bounded: no more groups than the cap, however many kinds", () => {
    const text = Array.from({ length: 40_000 }, (_, i) =>
      iso(`error in ${word(i)}`),
    ).join("\n");
    const r = analyzeText(text, "syslog", OPTIONS);
    expect(r.groups.length).toBeLessThanOrEqual(MAX_GROUPS + 4);
    expect(r.groups.reduce((n, g) => n + g.count, 0)).toBe(40_000);
  });

  test("web: the top missing page, first seen past the cap, is the headline", () => {
    const text = [
      ...Array.from({ length: 10_500 }, (_, i) =>
        hit(`/p/${word(i)}/x${i % 7}.php`, 404),
      ),
      ...Array.from({ length: 3000 }, () => hit("/old-page.html", 404)),
    ].join("\n");
    const r = analyzeText(text, "access", OPTIONS);
    const page = r.groups.find((g) => g.path === "/old-page.html");
    expect(page?.count).toBe(3000);
    expect(verdict(r)).toBe(
      fill(copy.missing, { path: "/old-page.html", times: "3,000 times" }),
    );
  });

  test("Windows: a failing drive first seen past the cap is still found", () => {
    const text = table([
      ...Array.from(
        { length: 10_001 },
        (_, i) => `Error,10/14/2026 1:00:00 PM,Src${word(i)},0,None,An event.`,
      ),
      ...Array.from(
        { length: 500 },
        () =>
          "Error,10/14/2026 2:00:00 PM,Disk,7,None,The device has a bad block.",
      ),
    ]);
    const r = analyzeText(text, "ev-csv", OPTIONS);
    expect(r.groups.find((g) => g.id === "7")?.count).toBe(500);
    expect(verdict(r)).toBe(fill(copy.drive, { times: "500 times" }));
  });

  test("syslog: when no kind stands out, the shared group is never the headline, nor named as one event", () => {
    const text = [
      ...Array.from({ length: 10_000 }, (_, i) => iso(`started k${word(i)}k`)),
      ...Array.from({ length: 12_000 }, (_, i) => iso(`error in ${word(i)}`)),
    ].join("\n");
    const r = analyzeText(text, "syslog", OPTIONS);
    const other = r.groups.find((g) => g.other && g.level === "error");
    if (!other) throw new Error("no shared group");
    expect(other).toMatchObject({ source: "", id: null });
    expect(verdict(r)).toBe(fill(copy.manyKinds, { n: "12,000" }));
    expect(groupName(other, "server").name).toBe(copy.other);
  });

  test("syslog: a real problem kept before the cap is the headline", () => {
    const text = [
      ...Array.from({ length: 5 }, () => iso("disk failed")),
      ...Array.from({ length: 9999 }, (_, i) => iso(`started k${word(i)}k`)),
      ...Array.from({ length: 2000 }, (_, i) => iso(`error in ${word(i)}`)),
    ].join("\n");
    const r = analyzeText(text, "syslog", OPTIONS);
    expect(verdict(r)).toBe(
      "The most frequent error is “disk failed”, 5 times.",
    );
  });

  test("syslog: a kind that was moved to the shared group and came back says “at least”", () => {
    const text = [
      iso("disk failed"),
      ...Array.from({ length: 12_000 }, (_, i) => iso(`error in ${word(i)}`)),
      ...Array.from({ length: 50 }, () => iso("disk failed")),
    ].join("\n");
    const r = analyzeText(text, "syslog", OPTIONS);
    const disk = r.groups.find((g) => g.message === "disk failed");
    expect(disk?.count).toBe(50);
    expect(disk?.missed).toBe(1);
    expect(verdict(r)).toBe(
      fill(copy.mostFrequent, {
        level: "error",
        message: "disk failed",
        times: fill(copy.atLeast, { times: "50 times" }),
      }),
    );
  });

  test("Windows: a known event is never moved to the shared group", () => {
    const text = table([
      "Critical,10/14/2026 1:00:00 PM,Microsoft-Windows-Kernel-Power,41,(63),The system has rebooted.",
      ...Array.from(
        { length: 30_000 },
        (_, i) =>
          `Critical,10/14/2026 1:00:00 PM,Src${word(i)},0,None,An event.`,
      ),
    ]);
    const r = analyzeText(text, "ev-csv", OPTIONS);
    expect(verdict(r)).toBe(fill(copy.restarted, { times: "once" }));
  });

  test("Windows: DCOM past the cap gets its own group; the shared one isn't called noise, nor explained", () => {
    const row = (source: string, id: number, level: string) =>
      `${level},10/14/2026 1:00:00 PM,${source},${id},None,An event.`;
    const text = table([
      ...Array.from({ length: 10_000 }, (_, i) =>
        row(`App${word(i)}`, 1, "Information"),
      ),
      ...Array.from({ length: 500 }, () => row("DCOM", 10016, "Error")),
    ]);
    const r = analyzeText(text, "ev-csv", OPTIONS);
    const other = r.groups.find((g) => g.other);
    if (!other) throw new Error("no shared group");
    expect(isNoise(other, "windows")).toBe(false);
    expect(groupPlain(other, r)).toBeNull();
    expect(r.groups.find((g) => g.id === "10016")?.count).toBe(500);
    expect(verdict(r)).toBe(copy.nothingButNoise);
  });

  test("web: assorted 404s past the cap aren't explained as bots, nor one named", () => {
    const text = [
      ...Array.from({ length: 10_000 }, (_, i) => hit(`/p/${word(i)}`, 200)),
      hit("/wp-login.php", 404),
      ...Array.from({ length: 12_000 }, (_, i) => hit(`/m/${word(i)}`, 404)),
    ].join("\n");
    const r = analyzeText(text, "access", OPTIONS);
    const other = r.groups.find((g) => g.other && g.level === "warning");
    if (!other) throw new Error("no shared group");
    expect(groupPlain(other, r)).toBeNull();
    expect(other.path).toBeUndefined();
    expect(verdict(r)).toBe(copy.manyMissing);
  });
});

describe("drawing", () => {
  const draw = (result: Result) => {
    const window = new Window();
    const answer = renderAnswer(
      window.document as unknown as Document,
      result,
      "answer",
    );
    return { window, answer };
  };
  const xmlAt = (time: string, i: number) =>
    `<Event><System><Provider Name="Microsoft-Windows-Kernel-Power"/><EventID>41</EventID><Level>1</Level><TimeCreated SystemTime="${time}"/></System><EventData><Data Name="x">${i}</Data></EventData></Event>`;

  test("events dated 1601 and 2026: drawn, the line no longer than its cap", () => {
    const r = analyzeText(
      `<Events>${xmlAt("1601-01-01T00:00:00.0000000Z", 0)}${xmlAt("2026-10-14T08:00:00.0000000Z", 1)}${xmlAt("2026-10-13T08:00:00.0000000Z", 2)}</Events>`,
      "ev-xml",
      OPTIONS,
    );
    const { window, answer } = draw(r);
    const path = answer.nodes
      .map((n) => n.querySelector("path"))
      .find(Boolean)
      ?.getAttribute("d");
    expect(path?.split("L").length).toBeLessThanOrEqual(4000);
    void window.happyDOM.close();
  });

  test("a log of a few hours: the ends of the timeline say the time", () => {
    const line = (h: number) =>
      `203.0.113.9 - - [14/Oct/2026:${String(h).padStart(2, "0")}:10:12 +0000] "GET / HTTP/1.1" 200 5 "-" "agent"`;
    const r = analyzeText([3, 4, 5, 9].map(line).join("\n"), "access", OPTIONS);
    const { window, answer } = draw(r);
    const ends = answer.nodes
      .map((n) => n.querySelector(".ends"))
      .find(Boolean);
    expect([...(ends?.children ?? [])].map((e) => e.textContent)).toEqual([
      "Oct 14, 03:00",
      "Oct 14, 09:00",
    ]);
    void window.happyDOM.close();
  });

  test("a placeholder is a chip that says what changes there", () => {
    const r = analyzeText(
      "2026-10-14T10:00:00Z host app: error 42 at /var/log/x.log",
      "syslog",
      OPTIONS,
    );
    const window = new Window();
    const [group] = r.groups;
    if (!group) throw new Error("no group");
    const li = row(window.document as unknown as Document, group, r);
    const chips = [...li.querySelectorAll(".message .slot")];
    expect(chips.map((c) => c.textContent)).toEqual(["number", "path"]);
    expect(chips[0]?.getAttribute("title")).toBe(copy.slotTitle);
    void window.happyDOM.close();
  });
});

test("a 2 MB message is kept as long as a sample", () => {
  const r = analyzeText(
    `2026-10-14T10:00:00Z host app: ${"word ".repeat(400_000)}`,
    "syslog",
    OPTIONS,
  );
  const [group] = r.groups;
  expect(group?.message.length).toBeLessThanOrEqual(2000);
  expect(group?.samples[0]?.length).toBeLessThanOrEqual(2000);
});

describe("lines with no end", () => {
  const event = (id: number, i: number) =>
    `<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='Service Control Manager' EventSourceName='Service Control Manager'/><EventID Qualifiers='16384'>${id}</EventID><Level>4</Level><TimeCreated SystemTime='2026-10-14T10:00:${String(i % 60).padStart(2, "0")}.0000000Z'/><Channel>System</Channel><Computer>EXAMPLE-PC</Computer></System><EventData><Data Name='param1'>Example Service ${i}</Data></EventData></Event>`;

  test("XML cut anywhere, even inside <Event or </Event>", () => {
    const text = `<Events>${event(7036, 1)}${event(7040, 2)}</Events>`;
    for (let cut = 0; cut <= text.length; cut++) {
      const run = analyzer("ev-xml", OPTIONS);
      run.line(text.slice(0, cut), true);
      run.line(text.slice(cut), false);
      const r = run.end();
      expect([r.events, r.skipped], `cut at ${cut}`).toEqual([2, 0]);
    }
  });

  test("wevtutil's one long line: every event, in 64 KB pieces", () => {
    const text = `<Events>\r\n${Array.from({ length: 3000 }, (_, i) => event(7036, i)).join("")}</Events>`;
    expect(text.length).toBeGreaterThan(10 * PIECE);
    const r = stream(text, "ev-xml", 50_000);
    expect(r.events).toBe(3000);
    expect(r.skipped).toBe(0);
    expect(detect(text.slice(0, PIECE))).toBe("ev-xml");
  });

  test("a syslog line past a piece: read once, the next line too", () => {
    const text = `2026-10-14T10:00:00Z host app: ${"x".repeat(3 * PIECE)}\n2026-10-14T10:00:01Z host app: error after it\n`;
    const r = stream(text, "syslog");
    expect(r.events).toBe(2);
    expect(r.skipped).toBe(0);
  });
});

describe("stray line ends inside a line", () => {
  test("syslog with \\r\\r\\n endings", () => {
    const text = Array.from(
      { length: 10 },
      (_, i) => `Oct 14 10:00:0${i} host sshd[1]: Accepted key`,
    ).join("\r\r\n");
    const r = stream(text, "syslog");
    expect([r.events, r.skipped]).toEqual([10, 0]);
  });

  test("a U+2028 inside a message (syslog and nginx)", () => {
    const sys = analyzeText(
      "<14>1 2026-10-14T10:00:00Z host app 1 - - one\u{2028}two",
      "syslog",
      OPTIONS,
    );
    expect([sys.events, sys.skipped]).toEqual([1, 0]);
    const nginx = analyzeText(
      "2026/10/14 03:10:12 [error] 1#1: *5 open() failed\u{2028}here",
      "nginx-error",
      OPTIONS,
    );
    expect([nginx.events, nginx.skipped]).toEqual([1, 0]);
  });

  test("RFC 5424 structured data then a U+2028: one pass", () => {
    const line = `<14>1 2026-10-14T10:00:00Z host app 1 - ${"[]".repeat(25_000)}\u{2028}`;
    const start = performance.now();
    analyzeText(line, "syslog", OPTIONS);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

test("Apache's \\\" inside a request line", () => {
  const r = analyzeText(
    '203.0.113.9 - - [14/Oct/2026:03:10:12 +0000] "GET /search?q=\\"x\\" HTTP/1.1" 404 5 "-" "agent"',
    "access",
    OPTIONS,
  );
  expect([r.events, r.skipped]).toEqual([1, 0]);
  expect(r.groups[0]?.id).toBe("404");
});

describe("XML that never closes", () => {
  const wrap = (data: string) =>
    `<Event><System><Provider Name="App"/><EventID>1</EventID><Level>2</Level><TimeCreated SystemTime="2026-10-14T10:00:00Z"/></System><EventData>${data}</EventData></Event>`;

  test.each([
    ["40,000 unclosed <Data> tags", "<Data>x".repeat(40_000)],
    ["40,000 unclosed CDATA sections", "<![CDATA[x".repeat(40_000)],
    ["40,000 <s with no >", "<".repeat(40_000)],
    ["40,000 <Provider with no >", "<Provider ".repeat(40_000)],
  ])("%s: one pass", (_name, data) => {
    const start = performance.now();
    const r = analyzeText(wrap(data), "ev-xml", OPTIONS);
    expect(performance.now() - start).toBeLessThan(150);
    expect(r.events).toBe(1);
  });
});

test("Schannel 36887: the other end, which isn't always a server", () => {
  const plain = known("Schannel", "36887")?.plain ?? "";
  expect(plain).not.toMatch(/server/i);
  expect(plain).toContain("other end");
});

describe("words that are names of a JavaScript object's own parts", () => {
  test("level words and sources", () => {
    expect(levelWord("constructor")).toBeNull();
    expect(levelWord("__proto__")).toBeNull();
    expect(canonical("__proto__")).toBe("__proto__");
    expect(canonical("constructor")).toBe("constructor");
    const r = analyzeText(
      [
        "Level,Date and Time,Source,Event ID,Task Category",
        "constructor,10/14/2026 1:00:00 PM,__proto__,2,None,One.",
        "toString,10/14/2026 1:00:00 PM,constructor,2,None,Two.",
      ].join("\n"),
      "ev-csv",
      OPTIONS,
    );
    const counted = Object.values(r.levels).reduce((a, b) => a + b, 0);
    expect(counted).toBe(2);
    expect(r.unknownLevels).toBe(2);
    expect(r.groups.map((g) => g.key).sort()).toEqual([
      "__proto__|2",
      "constructor|2",
    ]);
  });

  test("an XML reference named like one stays as written", () => {
    const r = analyzeText(
      `<Event><System><Provider Name="App"/><EventID>1</EventID><Level>4</Level></System><RenderingInfo><Message>&constructor; &amp; &__proto__;</Message></RenderingInfo></Event>`,
      "ev-xml",
      OPTIONS,
    );
    expect(r.groups[0]?.samples[0]).toBe("&constructor; & &__proto__;");
  });
});

describe("wevtutil's XML", () => {
  const raw = (provider: string, id: number, data: string) =>
    `<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='${provider}'/><EventID>${id}</EventID><Level>4</Level><TimeCreated SystemTime='2026-10-14T10:00:00.0000000Z'/><Channel>System</Channel><Computer>EXAMPLE-PC</Computer></System>${data}</Event>`;

  test("/f:xml: named values in words, binary data left out", () => {
    const r = analyzeText(
      `<Events>${[
        raw(
          "BTHUSB",
          5,
          "<EventData><Data></Data><Binary>00000E000100000000000000050005C0</Binary></EventData>",
        ),
        raw(
          "Microsoft-Windows-Kernel-Boot",
          18,
          "<EventData><Data Name='EntryCount'>1</Data></EventData>",
        ),
        raw(
          "Service Control Manager",
          7036,
          "<EventData><Data Name='param1'>Example Service</Data><Data Name='param2'>running</Data></EventData>",
        ),
      ].join("")}</Events>`,
      "ev-xml",
      OPTIONS,
    );
    const message = (id: string) => r.groups.find((g) => g.id === id)?.message;
    expect(message("5")).toBe("");
    expect(message("18")).toBe(`EntryCount: ${slot("n")}`);
    expect(message("7036")).toBe("Example Service running");
  });

  test("/f:RenderedXml /e:Events: the message as Event Viewer shows it", () => {
    const rendered = raw(
      "BTHUSB",
      5,
      "<EventData><Data></Data><Binary>00</Binary></EventData><RenderingInfo Culture='en-GB'><Message>The Bluetooth driver expected an HCI event with a certain size but did not receive it.</Message><Level>Information</Level><Provider>BTHUSB</Provider></RenderingInfo>",
    );
    const text = `<Events>\r\n${rendered}</Events>`;
    expect(detect(text)).toBe("ev-xml");
    const r = analyzeText(text, "ev-xml", OPTIONS);
    expect(r.groups[0]?.samples[0]).toBe(
      "The Bluetooth driver expected an HCI event with a certain size but did not receive it.",
    );
    expect(about(r)).toContain("exported as XML");
  });

  test("the page recommends the command that keeps the message", () => {
    expect(copy.evtxHow).toContain(
      "wevtutil qe System /f:RenderedXml /e:Events > system.xml",
    );
  });
});

describe("the log's own clock", () => {
  test.each([
    [0, "UTC"],
    [120, "UTC+2"],
    [-330, "UTC\u{2212}5:30"],
    [345, "UTC+5:45"],
  ])("%i minutes: %s", (minutes, name) => {
    expect(zoneName(minutes)).toBe(name);
  });

  const access = (zone: string) =>
    `203.0.113.9 - - [14/Oct/2026:03:10:12 ${zone}] "GET / HTTP/1.1" 200 5 "-" "agent"`;

  test("web: the offset every line gives, or none when they differ", () => {
    expect(analyzeText(access("+0200"), "access", OPTIONS).zone).toBe(120);
    expect(
      analyzeText(
        [access("+0100"), access("+0200")].join("\n"),
        "access",
        OPTIONS,
      ).zone,
    ).toBeNull();
  });

  test("ISO syslog names it in the line under the verdict; others don't", () => {
    const r = analyzeText(
      "2026-10-14T10:00:00+02:00 host app: started",
      "syslog",
      OPTIONS,
    );
    expect(about(r)).toContain(fill(copy.timesIn, { zone: "UTC+2" }));
    const plain = analyzeText(
      "Oct 14 10:00:00 host app: started",
      "syslog",
      OPTIONS,
    );
    expect(plain.zone).toBeNull();
    const nginx = analyzeText(
      "2026/10/14 03:10:12 [error] 1#1: *5 open() failed",
      "nginx-error",
      OPTIONS,
    );
    expect(nginx.zone).toBeNull();
  });
});

describe("Get-WinEvent | Export-Csv", () => {
  const HEADER =
    '"Message","Id","Version","Qualifiers","Level","Task","Opcode","Keywords","RecordId","ProviderName","ProviderId","LogName","ProcessId","ThreadId","MachineName","UserId","TimeCreated","ActivityId","RelatedActivityId","ContainerLog","MatchedQueryIds","Bookmark","LevelDisplayName","OpcodeDisplayName","TaskDisplayName","KeywordsDisplayNames","Properties"';
  const row = (
    message: string,
    id: number,
    level: number,
    provider: string,
    time: string,
    levelName: string,
  ) =>
    `"${message}","${id}","0",,"${level}","63","0","-9223372036854775808","1","${provider}","00000000-0000-0000-0000-000000000000","System","4","8","EXAMPLE-PC","S-1-5-18","${time}",,,"System","System.UInt32[]","System.Diagnostics.Eventing.Reader.EventBookmark","${levelName}","Info",,"System.Collections.ObjectModel.ReadOnlyCollection\`1[System.String]","System.Collections.Generic.List\`1[System.Diagnostics.Eventing.Reader.EventProperty]"`;
  const rows = [
    row(
      "The system has rebooted without cleanly shutting down first.\nCheck the power supply.",
      41,
      1,
      "Microsoft-Windows-Kernel-Power",
      "14/10/2026 08:00:00",
      "Critical",
    ),
    row(
      "The Example service terminated unexpectedly.",
      7031,
      2,
      "Service Control Manager",
      "13/10/2026 21:00:00",
      "Error",
    ),
    row(
      "The Example service entered the running state.",
      7036,
      4,
      "Service Control Manager",
      "13/10/2026 20:00:00",
      "Information",
    ),
  ];

  test.each([
    ["PowerShell 7", [HEADER, ...rows].join("\r\n")],
    [
      "Windows PowerShell 5.1",
      [
        "#TYPE System.Diagnostics.Eventing.Reader.EventLogRecord",
        HEADER,
        ...rows,
      ].join("\r\n"),
    ],
  ])("%s: read like Event Viewer's own CSV", (_name, text) => {
    expect(detect(text)).toBe("ev-csv");
    const r = analyzeText(text, "ev-csv", OPTIONS);
    expect([r.events, r.skipped]).toEqual([3, 0]);
    expect(r.levels).toEqual({
      critical: 1,
      error: 1,
      warning: 0,
      information: 1,
    });
    expect(r.logName).toBe("System");
    expect(r.restarts).toEqual([Date.UTC(2026, 9, 14, 8)]);
    const crash = r.groups.find((g) => g.id === "41");
    expect(crash?.samples[0]).toBe(
      "The system has rebooted without cleanly shutting down first.\nCheck the power supply.",
    );
    expect(verdict(r)).toBe(fill(copy.restarted, { times: "once" }));
    expect(about(r)).toContain("exported as CSV");
  });
});
