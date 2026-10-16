import "@exp/shared/tokens.css";
import "@exp/shared/fonts.css";
import "@exp/shared/base.css";
import "@exp/shared/shell.css";
import "@exp/shared/theme-switch.css";
import "@exp/shared/dropzone.css";
import "@exp/shared/work.css";
import "./battery.css";
import { initDropZone } from "@exp/shared/dropzone";
import { initThemeSwitch } from "@exp/shared/theme-switch";
import { designLabel, drawHistory } from "./chart";
import { copy, fill } from "./copy";
import { parseReport, type Battery, type Estimate } from "./parse";
import { percent, verdictText } from "./verdict";

const themes = document.querySelector<HTMLElement>("[data-theme-switch]");
if (themes) initThemeSwitch(themes);

// Reports are tens or hundreds of kilobytes; anything far bigger isn't one.
const MAX_BYTES = 20 * 1024 * 1024;
const SVG = "http://www.w3.org/2000/svg";
const NBSP = " ";

const zone = document.querySelector<HTMLLabelElement>(".drop");
const input = zone?.querySelector<HTMLInputElement>("input");
const status = document.querySelector<HTMLElement>("[data-status]");
const answer = document.querySelector<HTMLElement>("[data-answer]");
const example = document.querySelector<HTMLElement>("[data-example]");
// The answer's column, labelled with the file's name once one is in.
const yours = document.querySelector<HTMLElement>("[data-yours]");
const yoursLabel = document.querySelector<HTMLElement>("#yours-label");

const number = new Intl.NumberFormat("en");
const date = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const mwh = (n: number) => `${number.format(n)}${NBSP}mWh`;

/** "3 h 15 min", never split across lines. */
const duration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const parts = [h ? `${h}${NBSP}h` : "", m || !h ? `${m}${NBSP}min` : ""];
  return parts.filter(Boolean).join(NBSP);
};

/** The first date of a period ("2026-04-27 - 2026-05-04"), as "Apr 27, 2026". */
const periodStart = (label: string) => {
  const iso = /^\d{4}-\d{2}-\d{2}/.exec(label)?.[0];
  return iso ? date.format(new Date(`${iso}T00:00:00Z`)) : label;
};

const make = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function numbers(b: Battery): HTMLDListElement {
  const list = make("dl", "numbers");
  const pct = percent(b);
  const rows: [string, string | null][] = [
    [
      copy.original,
      b.design === null ? null : b.design ? mwh(b.design) : copy.notRecorded,
    ],
    [copy.now, b.full === null ? null : mwh(b.full)],
    [copy.health, pct === null ? null : `${pct}%`],
    [copy.cycleCount, b.cycles === null ? null : number.format(b.cycles)],
  ];
  for (const [label, value] of rows) {
    if (value === null) continue;
    const row = make("div", "");
    row.append(make("dt", "", label), make("dd", "num", value));
    list.append(row);
  }
  return list;
}

function batteryBlock(b: Battery, n: number, of: number): HTMLElement {
  const block = make("section", "battery");
  // The verdict is a heading under the pane's label, or, with several
  // batteries, under each battery's name.
  if (of > 1)
    block.append(make("h3", "battery-name", fill(copy.battery, { n })));
  block.append(make(of > 1 ? "h4" : "h3", "verdict", verdictText(b)));
  if (b.cycles !== null) {
    block.append(
      make("p", "cycles", fill(copy.cycles, { n: number.format(b.cycles) })),
    );
  }
  return block;
}

/** "both batteries", "all 3 batteries": what a combined number covers. */
const which = (n: number) => (n === 2 ? copy.both : fill(copy.allOf, { n }));

function historyFigure(
  points: Parameters<typeof drawHistory>[1],
  batteries: number,
): HTMLElement {
  const figure = make("figure", "history");
  const plot = make("div", "plot");
  const svg = document.createElementNS(SVG, "svg");
  drawHistory(svg, points);
  plot.append(svg);
  // The original capacity, beside the dashed line it names (placed by
  // CSS from --at; a style property set from script is within the CSP).
  const design = designLabel(points);
  if (design) {
    const tick = make("span", design.below ? "tick below num" : "tick num");
    tick.textContent = mwh(design.value);
    tick.style.setProperty("--at", String(design.at));
    plot.append(tick);
  }
  const caption = make("figcaption", "");
  const ends = make("span", "ends num");
  ends.append(
    make("span", "", periodStart(points[0]?.label ?? "")),
    make("span", "", periodStart(points.at(-1)?.label ?? "")),
  );
  caption.append(
    ends,
    batteries > 1
      ? fill(copy.chartSeveral, { which: which(batteries) })
      : copy.chart,
  );
  figure.append(plot, caption);
  return figure;
}

/** The latest period with both estimates. */
const latestEstimate = (estimates: Estimate[]) =>
  estimates.findLast((e) => e.atFull !== null && e.atDesign !== null);

function show(nodes: Node[], said: string, name: string) {
  if (yoursLabel) yoursLabel.textContent = name;
  answer?.replaceChildren(...nodes);
  if (yours) yours.hidden = false;
  zone?.classList.toggle("has-result", nodes.length > 0);
  if (status) status.textContent = said;
}

interface Answer {
  nodes: Node[];
  /** What the status line announces. */
  said: string;
}

const trouble = (text: string): Answer => ({
  nodes: [make("p", "problem", text)],
  said: text,
});

/** A report's answer. The example goes through the same code, without
 * the line about what the page reads. */
function answerFor(source: string, asExample = false): Answer {
  const result = parseReport(source);
  if (!result.ok) {
    return trouble(
      result.reason === "xml"
        ? copy.xml
        : result.reason === "no-battery"
          ? copy.noBattery
          : copy.notAReport,
    );
  }

  const { batteries, history, estimates } = result;
  const nodes: Node[] = [];
  const one = batteries.length === 1;
  batteries.forEach((b, i) => {
    const block = batteryBlock(b, i + 1, batteries.length);
    if (!one) block.append(numbers(b));
    nodes.push(block);
  });

  // One battery: its numbers beside the chart. Several: the numbers stay
  // with each battery and the chart (the system's total) follows.
  const detail = make("div", one ? "detail" : "detail detail-wide");
  const only = batteries[0];
  if (one && only) detail.append(numbers(only));
  detail.append(
    history.length
      ? historyFigure(history, batteries.length)
      : make("p", "no-history", copy.noHistory),
  );
  nodes.push(detail);

  const estimate = latestEstimate(estimates);
  if (estimate?.atFull != null && estimate.atDesign != null) {
    nodes.push(
      make(
        "p",
        "estimate",
        fill(one ? copy.estimate : copy.estimateSeveral, {
          which: which(batteries.length),
          full: duration(estimate.atFull),
          design: duration(estimate.atDesign),
        }),
      ),
    );
  }
  if (!asExample) nodes.push(make("p", "kept", copy.kept));
  return { nodes, said: batteries.map(verdictText).join(" ") };
}

/** Several files dropped at once: the answer opens by naming the one
 * it's for. */
function withOneFile(a: Answer, file: File, skipped: File[]): Answer {
  if (!skipped.length) return a;
  const line = fill(copy.oneAtATime, { name: file.name });
  return {
    nodes: [make("p", "one-file", line), ...a.nodes],
    said: `${line} ${a.said}`,
  };
}

async function read(file: File, skipped: File[]) {
  let source: string | null = null;
  if (file.size <= MAX_BYTES) {
    try {
      source = await file.text();
    } catch {
      source = null;
    }
  }
  const { nodes, said } = withOneFile(
    source === null ? trouble(copy.notAReport) : answerFor(source),
    file,
    skipped,
  );
  show(nodes, said, file.name);
}

/** The example: a made-up report, read and drawn by the same code as a
 * dropped one, but never announced. Its text arrives as a module once the
 * page has drawn (never fetched), and a dropped file takes its place for
 * good: the example leaves the page. */
async function showExample() {
  if (!example) return;
  try {
    const { report } = await import("./example");
    if (!example.isConnected) return;
    example.append(...answerFor(report, true).nodes);
  } catch {
    example.hidden = true;
  }
}

if (zone && input) {
  initDropZone(zone, input, ([file], skipped) => {
    if (!file) return;
    example?.remove();
    void read(file, skipped);
  });
  requestAnimationFrame(() => setTimeout(() => void showExample()));
}
