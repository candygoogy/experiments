// What kind of log a file is, from what's in it (never from its name).
// The first lines are tried against each format; the one most of them fit
// wins.
import { ACCESS } from "./formats/access.ts";
import { NGINX_ERROR } from "./formats/nginx-error.ts";
import { levelWord } from "./formats/levels.ts";
import { ISO_LINE, RFC3164, RFC5424 } from "./formats/syslog.ts";
import { HEADERS } from "./formats/windows-table.ts";
import type { Format } from "./model.ts";
import { records } from "./records.ts";

/** An .evtx file starts with "ElfFile\0". */
export const isEvtx = (bytes: Uint8Array) =>
  bytes.length >= 8 &&
  String.fromCharCode(...bytes.subarray(0, 7)) === "ElfFile" &&
  bytes[7] === 0;

// The code pages Windows writes "ANSI" text in, for the languages this
// page knows level words in; the first is the default.
const LEGACY = [
  "windows-1252",
  "windows-1250",
  "windows-1251",
  "shift_jis",
  "gbk",
] as const;

export type Encoding =
  "utf-8" | "utf-16le" | "utf-16be" | (typeof LEGACY)[number];

const NAMES = new Set(Object.values(HEADERS).flat());

/** How many cells of the first lines are column names or level words this
 * page knows. */
function knownWords(text: string): number {
  let score = 0;
  for (const line of text.split("\n", 200)) {
    for (const cell of line.split(/[,\t]/)) {
      const word = cell
        .replace(/^\s*"|"\s*$/g, "")
        .trim()
        .toLowerCase();
      if (word && (NAMES.has(word) || levelWord(word))) score++;
    }
  }
  return score;
}

/** How many characters past ASCII the bytes hold as well-formed UTF-8, and
 * how many bytes break it. A character cut off at the very end counts as
 * neither: the sample may stop in the middle of one. */
function utf8Counts(bytes: Uint8Array): { valid: number; invalid: number } {
  let valid = 0;
  let invalid = 0;
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i] ?? 0;
    if (b < 0x80) {
      i++;
      continue;
    }
    // The length a lead byte announces, and the range its second byte must
    // fall in (no overlong forms, no surrogates, nothing past U+10FFFF).
    const [size, low, high] =
      b >= 0xc2 && b <= 0xdf
        ? [2, 0x80, 0xbf]
        : b === 0xe0
          ? [3, 0xa0, 0xbf]
          : b === 0xed
            ? [3, 0x80, 0x9f]
            : b >= 0xe1 && b <= 0xef
              ? [3, 0x80, 0xbf]
              : b === 0xf0
                ? [4, 0x90, 0xbf]
                : b === 0xf4
                  ? [4, 0x80, 0x8f]
                  : b >= 0xf1 && b <= 0xf3
                    ? [4, 0x80, 0xbf]
                    : [0, 0, 0];
    let n = 1;
    while (n < size && i + n < bytes.length) {
      const c = bytes[i + n] ?? 0;
      if (n === 1 ? c < low || c > high : c < 0x80 || c > 0xbf) break;
      n++;
    }
    if (size && n === size) valid++;
    else if (!size || i + n < bytes.length) invalid++;
    i += n;
  }
  return { valid, invalid };
}

/**
 * The text encoding of a file, from its first bytes. Event Viewer writes
 * UTF-8; Windows PowerShell's `>` writes UTF-16 with a byte order mark.
 *
 * A file is UTF-8 when most of its characters past ASCII are well-formed
 * UTF-8: a stray bad byte in a UTF-8 file (a cut-off copy, one odd line)
 * is read as U+FFFD, and the rest stays as written. Text saved in a
 * Windows code page (by Excel, or an older tool) breaks UTF-8 at almost
 * every letter past ASCII, and only by chance makes a valid pair: then the
 * code page that makes its column names and level words ones this page
 * knows wins.
 */
export function encoding(bytes: Uint8Array): Encoding {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  // UTF-16 without a mark: every other byte of plain text is zero.
  if (bytes.length >= 8 && bytes[1] === 0 && bytes[3] === 0 && bytes[0] !== 0) {
    return "utf-16le";
  }
  const { valid, invalid } = utf8Counts(bytes);
  // UTF-8 when at most one in ten sequences past ASCII is broken.
  if (invalid * 10 <= valid + invalid) return "utf-8";
  let best: Encoding = LEGACY[0];
  let most = -1;
  for (const name of LEGACY) {
    const score = knownWords(new TextDecoder(name).decode(bytes));
    if (score > most) {
      best = name;
      most = score;
    }
  }
  return best;
}

const DATE_TIME = /\d{1,4}[./-]\d{1,2}[./-]\d{1,4}[ T,]+\d{1,2}[:.]\d{2}/;

// A level as a word, in any language: "Error", "Błąd", "Fout", "エラー".
const LEVEL_LIKE = /^\p{L}[\p{L}\p{M} ’'-]{0,30}$/u;

/** A row of Event Viewer's table: its level as a word (or nothing, as a
 * Security log's keywords or an unknown level can leave it), a date and
 * time, then a numeric ID; at least five columns (level, date, source, ID,
 * category, then the message), or just level, date, source and ID. Any
 * other CSV with a date and a number in it isn't one. */
const tableRow = (fields: string[]) => {
  const level = fields[0]?.trim() ?? "";
  if (fields.length < 4 || (level && !LEVEL_LIKE.test(level))) return false;
  if (!DATE_TIME.test(fields[1] ?? "")) return false;
  const id = fields.findIndex((f, i) => i > 1 && /^\d{1,5}$/.test(f.trim()));
  return id !== -1 && (fields.length >= 5 || id === 3);
};

/** The share of records that are table rows. A message can run over
 * several lines, so the lines are read as records first. */
function tableShare(lines: string[], delimiter: string): number {
  const rows: string[][] = [];
  const read = records(delimiter, (row) => rows.push(row));
  for (const line of lines) read.push(line);
  return rows.length ? rows.filter(tableRow).length / rows.length : 0;
}

/** PowerShell's `Get-WinEvent | Export-Csv` header (after the "#TYPE"
 * line Windows PowerShell writes), in any column order. */
const getWinEvent = (line: string) => {
  const names = line.toLowerCase().replaceAll('"', "").split(",");
  return ["timecreated", "id", "providername"].every((n) => names.includes(n));
};

const TABLE_HEADER =
  /^(level|livello|ebene|niveau|nivel|nível|poziom|уровень|レベル|级别)[,\t]/i;

/** The format of a log from its first text, or null if it's none of them. */
export function detect(head: string): Format | null {
  const text = head.replace(/^\u{feff}/u, "");
  if (/<Event[\s>]/.test(text) && /<System>/.test(text)) return "ev-xml";
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 50);
  if (!lines.length) return null;
  const [first = ""] = lines;
  if (TABLE_HEADER.test(first))
    return first.includes("\t") ? "ev-txt" : "ev-csv";
  const header = first.startsWith("#TYPE ") ? (lines[1] ?? "") : first;
  if (getWinEvent(header)) return "ev-csv";

  const share = (test: (line: string) => boolean) =>
    lines.filter(test).length / lines.length;
  const scores: [Format, number][] = [
    ["access", share((l) => ACCESS.test(l))],
    ["nginx-error", share((l) => NGINX_ERROR.test(l))],
    [
      "syslog",
      share((l) => RFC5424.test(l) || RFC3164.test(l) || ISO_LINE.test(l)),
    ],
    // A table in another language: its rows still have a date and an ID.
    ["ev-txt", text.includes("\t") ? tableShare(lines, "\t") : 0],
    ["ev-csv", tableShare(lines, ",")],
  ];
  const [best] = scores.sort((a, b) => b[1] - a[1]);
  return best && best[1] >= 0.5 ? best[0] : null;
}
