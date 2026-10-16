// Reads the HTML report from `powercfg /batteryreport`. The report is
// written in the PC's language, labels and number formats included, so
// nothing here reads a label: tables are found by their shape and their
// order, and numbers are read whatever their thousands separator.
//
// The whole file is parsed, but only the capacity rows, the cycle count,
// the capacity history and the life estimates are taken from it. The PC's
// name, its BIOS and OS build, and each battery's name, maker and serial
// number are never picked out, shown or kept.

export interface Battery {
  /** Design capacity, mWh. */
  design: number | null;
  /** Full charge capacity, mWh. */
  full: number | null;
  /** Charge cycles, when the battery reports them. */
  cycles: number | null;
}

export interface HistoryPoint {
  /** The period as the report writes it. */
  label: string;
  full: number;
  design: number;
}

export interface Estimate {
  label: string;
  /** Seconds of active use at today's full charge. */
  atFull: number | null;
  /** Seconds of active use at the design capacity. */
  atDesign: number | null;
}

export type ParseResult =
  | {
      ok: true;
      batteries: Battery[];
      history: HistoryPoint[];
      estimates: Estimate[];
    }
  | { ok: false; reason: "xml" | "not-a-report" | "no-battery" };

// \s covers the no-break spaces some locales group digits with.
const MWH = /^\d[\d.,\s]*mwh$/i;
const DURATION = /^(\d+):([0-5]\d):([0-5]\d)$/;
// A period starts with an ISO date ("2026-06-01 - 2026-06-08").
const PERIOD = /^\d{4}-\d{2}-\d{2}/;
// A row that starts with a date or a time belongs to a usage log.
const LOGGED = /^(\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}:\d{2})/;
const COUNT = /^\d[\d.,\s]*$/;

const text = (cell: Element | undefined) =>
  (cell?.textContent ?? "").replace(/\s+/g, " ").trim();

const digits = (value: string) => value.replace(/[.,\s]/g, "");

/** "45,000 mWh", "45.000 mWh", "45 000 mWh" → 45000; "-" → null. */
export function parseMwh(value: string): number | null {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!MWH.test(compact)) return null;
  const n = digits(compact.slice(0, -3));
  return /^\d+$/.test(n) ? Number(n) : null;
}

/** "5:12:30" → 18750 seconds; "-" → null. */
export function parseDuration(value: string): number | null {
  const m = DURATION.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

const parseCount = (value: string): number | null =>
  COUNT.test(value.trim()) ? Number(digits(value)) : null;

/** The table's rows outside its head, with at least one cell. */
const bodyRows = (table: HTMLTableElement) =>
  [...table.rows].filter(
    (row) => row.parentElement?.tagName !== "THEAD" && row.cells.length > 0,
  );

const isEmptyValue = (value: string) => value === "" || value === "-";

/** The rows of the table's head (by selector: some DOMs lack tHead.rows). */
const headRows = (table: HTMLTableElement) => [
  ...table.querySelectorAll<HTMLTableRowElement>(":scope > thead > tr"),
];

/** Capacity history: a one-row head of three cells, then rows of a period
 * and two capacities (or "-" where Windows recorded none). */
function isHistory(table: HTMLTableElement): boolean {
  const head = headRows(table);
  if (head.length !== 1 || head[0]?.cells.length !== 3) return false;
  return bodyRows(table).every((row) => {
    const cells = [...row.cells].map((c) => text(c));
    return (
      cells.length === 3 &&
      PERIOD.test(cells[0] ?? "") &&
      cells.slice(1).every((v) => isEmptyValue(v) || MWH.test(v))
    );
  });
}

/** Life estimates: a two-row head, then rows of six cells (period, two at
 * full charge, an empty divider, two at design capacity). The usage
 * history before it has the same shape, so it's found by its place: the
 * first such table after the capacity history. */
function isEstimates(table: HTMLTableElement): boolean {
  if (headRows(table).length !== 2) return false;
  return bodyRows(table).every(
    (row) => row.cells.length === 6 && PERIOD.test(text(row.cells[0])),
  );
}

/** Installed batteries: before the history, the first table of label and
 * value rows (not a usage log) with at least two capacities in it. */
function isBatteries(table: HTMLTableElement): boolean {
  const rows = bodyRows(table);
  if (rows.some((row) => LOGGED.test(text(row.cells[0])))) return false;
  const capacities = rows.flatMap((row) =>
    [...row.cells].slice(1).filter((c) => MWH.test(text(c))),
  );
  return capacities.length >= 2;
}

/** One battery per value column: the first capacity row is the design
 * capacity, the next the full charge capacity, and the row after that the
 * cycle count. Rows are matched by what they hold, not by position, so a
 * spacer row or a missing cycle row changes nothing. */
function readBatteries(table: HTMLTableElement): Battery[] {
  const rows = bodyRows(table);
  const columns = Math.max(...rows.map((row) => row.cells.length)) - 1;
  const batteries: Battery[] = [];
  for (let c = 1; c <= columns; c++) {
    const capacityRows = rows.filter((row) => MWH.test(text(row.cells[c])));
    const [designRow, fullRow] = capacityRows;
    const after = fullRow ? rows[rows.indexOf(fullRow) + 1] : undefined;
    batteries.push({
      design: designRow ? parseMwh(text(designRow.cells[c])) : null,
      full: fullRow ? parseMwh(text(fullRow.cells[c])) : null,
      cycles: after ? parseCount(text(after.cells[c])) : null,
    });
  }
  return batteries;
}

/** The report without its styles and scripts. Only its tables are read,
 * and the browser holds the parsed copy to the page's own CSP, logging an
 * error for every inline style it declines there. */
const withoutStyles = (html: string) =>
  html
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");

export function parseReport(source: string): ParseResult {
  // trimStart() also drops a byte order mark.
  const start = source.trimStart();
  if (
    /<BatteryReport[\s>]/.test(source) ||
    (start.startsWith("<?xml") && !/<html[\s>]/i.test(start))
  ) {
    return { ok: false, reason: "xml" };
  }

  const doc = new DOMParser().parseFromString(
    withoutStyles(source),
    "text/html",
  );
  const tables = [...doc.querySelectorAll("table")];
  const historyAt = tables.findIndex(isHistory);
  const history = tables[historyAt];
  const estimates =
    historyAt === -1
      ? undefined
      : tables.slice(historyAt + 1).find(isEstimates);
  if (!history || !estimates) return { ok: false, reason: "not-a-report" };

  const batteriesTable = tables.slice(0, historyAt).find(isBatteries);
  if (!batteriesTable) return { ok: false, reason: "no-battery" };

  return {
    ok: true,
    batteries: readBatteries(batteriesTable),
    history: bodyRows(history).flatMap((row) => {
      const full = parseMwh(text(row.cells[1]));
      const design = parseMwh(text(row.cells[2]));
      return full === null || design === null
        ? []
        : [{ label: text(row.cells[0]), full, design }];
    }),
    estimates: bodyRows(estimates).map((row) => ({
      label: text(row.cells[0]),
      atFull: parseDuration(text(row.cells[1])),
      atDesign: parseDuration(text(row.cells[4])),
    })),
  };
}
