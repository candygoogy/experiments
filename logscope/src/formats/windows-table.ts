// Event Viewer's "Save All Events As…" in CSV, or as tab-separated text,
// and PowerShell's `Get-WinEvent | Export-Csv`. The header names the
// columns in Windows' own language, so they're matched against the names
// it uses in several languages; when they're in another one, the columns
// are found by what's in them (a date and time, a whole-number ID). Dates
// follow the PC's regional format: whether the day or the month comes
// first is decided from the dates themselves.
import type { LogEvent } from "../model.ts";
import { records } from "../records.ts";
import { levelNumber, levelWord } from "./levels.ts";
import type { Context, Parser } from "./types.ts";

type Column =
  "level" | "time" | "source" | "id" | "category" | "message" | "log";

/** Column names, lower case. The last in each list are Get-WinEvent's
 * property names (never translated); the first name found wins, so its
 * numeric Level comes before LevelDisplayName. */
export const HEADERS: Record<Column, string[]> = {
  // nl, pl, ru, ja and zh-Hans: the names Event Viewer shows for an
  // event's details in those languages (the Japanese CSV header is
  // confirmed from real exports). Their date columns are found by shape.
  level: [
    "level",
    "livello",
    "ebene",
    "niveau",
    "nivel",
    "nível",
    "poziom",
    "уровень",
    "レベル",
    "级别",
    "leveldisplayname",
  ],
  time: [
    "date and time",
    "data e ora",
    "datum und uhrzeit",
    "date et heure",
    "fecha y hora",
    "data e hora",
    "日付と時刻",
    "timecreated",
  ],
  source: [
    "source",
    "origine",
    "quelle",
    "origen",
    "fonte",
    "origem",
    "bron",
    "źródło",
    "источник",
    "ソース",
    "来源",
    "providername",
  ],
  id: [
    "event id",
    "id evento",
    "ereignis-id",
    "id de l’événement",
    "id de l'événement",
    "id. del evento",
    "id do evento",
    "gebeurtenis-id",
    "identyfikator zdarzenia",
    "код события",
    "イベント id",
    "事件 id",
    "id",
  ],
  category: [
    "task category",
    "categoria attività",
    "aufgabenkategorie",
    "catégorie de la tâche",
    "categoría de la tarea",
    "categoria da tarefa",
    "taakcategorie",
    "kategoria zadania",
    "категория задачи",
    "タスクのカテゴリ",
    "任务类别",
    "taskdisplayname",
  ],
  // Event Viewer leaves the message's column unnamed.
  message: ["message"],
  log: ["logname"],
};

const DATE =
  /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})[ T,]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([AaPp])?\.?\s?[Mm]?\.?$/;

interface Parts {
  a: number;
  b: number;
  c: number;
  h: number;
  m: number;
  s: number;
  pm: boolean | null;
}

function dateParts(text: string): Parts | null {
  const d = DATE.exec(text.trim());
  if (!d) return null;
  const n = (i: number) => Number(d[i] ?? 0);
  const half = d[7]?.toLowerCase();
  return {
    a: n(1),
    b: n(2),
    c: n(3),
    h: n(4),
    m: n(5),
    s: n(6),
    pm: half ? half === "p" : null,
  };
}

/** Wall-clock milliseconds, the day first or the month first. */
function wallTime(p: Parts, dayFirst: boolean): number | null {
  let year: number;
  let month: number;
  let day: number;
  if (p.a > 999) {
    [year, month, day] = [p.a, p.b, p.c];
  } else {
    year = p.c < 100 ? 2000 + p.c : p.c;
    [day, month] = dayFirst ? [p.a, p.b] : [p.b, p.a];
  }
  let hour = p.h;
  if (p.pm !== null) hour = (hour % 12) + (p.pm ? 12 : 0);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Date.UTC(year, month - 1, day, hour, p.m, p.s);
}

/** What a date says about the order: true when only the day can come
 * first, false when only the month can, null when either can. */
const order = (p: Parts | null): boolean | null =>
  !p || p.a > 999 ? null : p.a > 12 ? true : p.b > 12 ? false : null;

const isId = (text: string) => /^\d{1,5}$/.test(text.trim());

// Rows are held back until a date settles the day/month order: at most
// this many, or this much text, before the order is guessed.
export const SETTLE = 50_000;
const SETTLE_TEXT = 32 << 20;

export function windowsTable(
  delimiter: string,
  emit: (e: LogEvent) => void,
  context: Context,
): Parser {
  let columns: Partial<Record<Column, number>> | null = null;
  let message = -1;
  let byShape = false;
  let english = true;
  let named = false;
  let dayFirst: boolean | null = null;
  // The order was guessed, not read from a date: a later date can still
  // overrule it.
  let guessed = false;
  let clock12 = false;
  let seen = 0;
  // Rows held back until the date order is known.
  let held: { parts: Parts | null; event: LogEvent }[] = [];
  let heldText = 0;

  // Undecided after many rows (every day so far was 12 or less): English
  // Windows with a 12-hour clock writes the month first, as in the US;
  // other regions write the day first.
  const settle = () => {
    if (dayFirst === null) {
      dayFirst = !(english && clock12);
      guessed = true;
    }
    for (const { parts, event } of held) {
      event.time = parts ? wallTime(parts, dayFirst) : null;
      emit(event);
    }
    held = [];
    heldText = 0;
  };

  /** Columns from a header row, or null when it isn't one. */
  const fromHeader = (row: string[]) => {
    const found: Partial<Record<Column, number>> = {};
    row.forEach((name, i) => {
      const key = name.trim().toLowerCase();
      for (const [column, names] of Object.entries(HEADERS)) {
        const c = column as Column;
        if (found[c] === undefined && names.includes(key)) found[c] = i;
      }
    });
    return Object.keys(found).length >= 3 ? found : null;
  };

  /** Columns from what a data row holds. */
  const fromShape = (row: string[]) => {
    const time = row.findIndex((f) => dateParts(f) !== null);
    if (time === -1) return null;
    const id = row.findIndex((f, i) => i > time && isId(f));
    if (id === -1) return null;
    const found: Partial<Record<Column, number>> = { time, id };
    if (time > 0) found.level = 0;
    if (id - time > 1) found.source = time + 1;
    if (row.length > id + 1) found.category = id + 1;
    return found;
  };

  /** The column after the last named one, where Event Viewer puts the
   * message. */
  const after = (found: Partial<Record<Column, number>>) =>
    Math.max(...Object.values(found)) + 1;

  const row = (fields: string[]) => {
    if (!columns) {
      const header = fromHeader(fields);
      if (header) {
        columns = header;
        english = fields.some(
          (f) => HEADERS.level[0] === f.trim().toLowerCase(),
        );
        message = after(header);
        // A header with no date or ID column this page knows by name has
        // them found in the first row.
        byShape = header.time === undefined || header.id === undefined;
        return;
      }
      columns = fromShape(fields);
      if (!columns) {
        // The first row of a table in a language this page doesn't know
        // is its header, not a broken line (and PowerShell 5.1 writes a
        // "#TYPE" line before its header).
        if (seen++) context.skip();
        return;
      }
      message = after(columns);
    }
    if (byShape) {
      byShape = false;
      const found = fromShape(fields);
      if (columns.time === undefined && found?.time !== undefined) {
        columns.time = found.time;
      }
      if (columns.id === undefined && found?.id !== undefined) {
        columns.id = found.id;
      }
      if (columns.message === undefined) message = after(columns);
    }
    const at = (c: Column) => {
      const i = columns?.[c];
      return i === undefined ? "" : (fields[i] ?? "").trim();
    };
    const id = at("id");
    const parts = dateParts(at("time"));
    if (!parts && !isId(id)) {
      context.skip();
      return;
    }
    const word = at("level");
    // Get-WinEvent's Level is a number, as in the XML.
    const level = /^\d{1,2}$/.test(word)
      ? levelNumber(Number(word))
      : levelWord(word);
    if (word && !level) context.unknownLevel(word);
    const log = at("log");
    if (log && !named) {
      context.logName(log);
      named = true;
    }
    const event: LogEvent = {
      time: null,
      level,
      source: at("source"),
      id: isId(id) ? String(Number(id)) : null,
      message:
        columns.message !== undefined
          ? at("message")
          : fields.slice(message).join(delimiter).trim(),
    };
    if (parts?.pm != null) clock12 = true;
    const says = order(parts);
    if (says !== null && says !== dayFirst) {
      if (dayFirst === null) {
        dayFirst = says;
      } else if (guessed) {
        // The guess was wrong: the rows from here on are read the other
        // way.
        dayFirst = says;
        guessed = false;
      }
    }
    if (dayFirst !== null && !held.length) {
      event.time = parts ? wallTime(parts, dayFirst) : null;
      emit(event);
      return;
    }
    held.push({ parts, event });
    heldText += event.message.length;
    if (dayFirst !== null || held.length >= SETTLE || heldText > SETTLE_TEXT) {
      settle();
    }
  };

  const read = records(
    delimiter,
    (fields) => {
      if (fields.some((f) => f.trim())) row(fields);
    },
    context.skip,
  );

  return {
    line(text) {
      read.push(text);
    },
    end() {
      read.end();
      settle();
    },
  };
}
