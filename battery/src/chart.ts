// The capacity history as one line: full charge capacity over time, with
// the design capacity dashed above it and a quiet guide at 80% of it, where
// the verdict turns from healthy to worn. One path per line however long
// the history, and hidden from screen readers: the page says the same in
// words.
//
// The axis doesn't start at 0. A line near the top of a chart that starts
// at 0 hides the wear and the dips, so the foot of the chart is at about
// 60% of the original capacity, lower when the line goes lower, on a round
// number. The foot is labelled with its value, so it's plain that it
// isn't 0.
import type { HistoryPoint } from "./parse";

const SVG = "http://www.w3.org/2000/svg";
// The drawing's own units; the SVG stretches to its box.
export const WIDTH = 600;
export const HEIGHT = 200;
/** Where the verdict turns from healthy to worn (verdict.ts). */
export const WORN = 0.8;
/** The foot of the chart: at most this share of the original capacity... */
const FLOOR_SHARE = 0.6;
/** ...and at least this share of it under the lowest point. */
const FLOOR_MARGIN = 0.08;
/** How much of the drawing's height a label takes, as a share of it. */
const LABEL_SHARE = 0.15;

const el = (name: string, attrs: Record<string, string>) => {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, value);
  return node;
};

/** The largest capacity drawn: the top of the chart. A reduce rather than
 * a spread, which overflows the stack on a very long history. */
export const chartMax = (points: HistoryPoint[]) =>
  points.reduce((max, p) => Math.max(max, p.full, p.design), 1);

/** A round step near `x`: 1, 2 or 5 times a power of ten. */
function niceStep(x: number): number {
  if (!(x > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(x));
  const f = x / power;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * power;
}

/** The foot of the chart, in mWh: 60% of the original capacity, or lower
 * when the history goes lower (its lowest point less 8% of the original),
 * rounded down to a step of about a quarter of the drawn range. 0 when
 * Windows recorded no original capacity. */
export function chartFloor(points: HistoryPoint[]): number {
  const design = points.reduce((max, p) => Math.max(max, p.design), 0);
  if (!design || !points.length) return 0;
  const lowest = points.reduce(
    (min, p) => Math.min(min, p.full, p.design),
    Infinity,
  );
  const want = Math.min(FLOOR_SHARE * design, lowest - FLOOR_MARGIN * design);
  if (want <= 0) return 0;
  const step = niceStep((chartMax(points) - want) / 4);
  return Math.floor(want / step) * step;
}

/** How far down the drawing a value is: 0 the top, 1 the foot. */
const depth = (value: number, floor: number, max: number) =>
  1 - (value - floor) / (max - floor || 1);

/** The same, to three places, for a label. */
const place = (value: number, floor: number, max: number) =>
  Math.round(depth(value, floor, max) * 1000) / 1000;

export interface Label {
  value: number;
  /** How far down the drawing: 0 the top, 1 the bottom. */
  at: number;
  /** Under its line rather than over it. */
  below: boolean;
}

/** The original capacity, set at the left end of the dashed line it names.
 * It sits above the line, or under it where the solid line starts higher
 * (a battery over 100%), so the two never cross. None when Windows
 * recorded no original capacity. */
export function designLabel(points: HistoryPoint[]): Label | null {
  const first = points[0];
  if (!first?.design) return null;
  return {
    value: first.design,
    at: place(first.design, chartFloor(points), chartMax(points)),
    below: first.full > first.design,
  };
}

/** The 80% guide's label, at its left end: above the guide, or under it
 * where the solid line runs just above it there. */
export function wornLabel(points: HistoryPoint[]): Label | null {
  const first = points[0];
  if (!first?.design) return null;
  const floor = chartFloor(points);
  const max = chartMax(points);
  const value = WORN * first.design;
  const band = LABEL_SHARE * (max - floor);
  // The start of the line, under where the label is drawn.
  const start = points.slice(0, Math.max(1, Math.ceil(points.length * 0.2)));
  const below = start.some((p) => p.full >= value && p.full <= value + band);
  return { value, at: place(value, floor, max), below };
}

/** The foot's label: its value, over the axis at the left. None at 0. */
export function floorLabel(points: HistoryPoint[]): Label | null {
  const floor = chartFloor(points);
  return floor ? { value: floor, at: 1, below: false } : null;
}

export function drawHistory(svg: SVGSVGElement, points: HistoryPoint[]): void {
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  const max = chartMax(points);
  const floor = chartFloor(points);
  const last = Math.max(points.length - 1, 1);
  const x = (i: number) => round((i / last) * WIDTH);
  const y = (v: number) => round(depth(v, floor, max) * HEIGHT);
  const line = (value: (p: HistoryPoint) => number) =>
    points.map((p, i) => `${i ? "L" : "M"}${x(i)} ${y(value(p))}`).join(" ");

  // The foot, and the 80% guide (none without an original capacity).
  const axes = el("g", { class: "axes" });
  axes.append(
    el("line", { x1: "0", y1: `${HEIGHT}`, x2: `${WIDTH}`, y2: `${HEIGHT}` }),
  );
  if (points.some((p) => p.design > 0))
    axes.append(el("path", { class: "worn", d: line((p) => WORN * p.design) }));
  svg.append(
    axes,
    el("path", { class: "design", d: line((p) => p.design) }),
    el("path", { class: "full", d: line((p) => p.full) }),
  );
}

const round = (n: number) => Math.round(n * 10) / 10;
