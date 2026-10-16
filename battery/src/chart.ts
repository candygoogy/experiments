// The capacity history as one line: full charge capacity over time, with
// the design capacity dashed above it, from 0 up, so the drop reads at its
// true size. One path per line however long the history, and hidden from
// screen readers: the page says the same in words.
import type { HistoryPoint } from "./parse";

const SVG = "http://www.w3.org/2000/svg";
// The drawing's own units; the SVG stretches to its box.
export const WIDTH = 600;
export const HEIGHT = 200;

const el = (name: string, attrs: Record<string, string>) => {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, value);
  return node;
};

/** The largest capacity drawn: the top of the chart. */
export const chartMax = (points: HistoryPoint[]) =>
  Math.max(...points.flatMap((p) => [p.full, p.design]), 1);

/** The chart's one value label: the original capacity, set at the left
 * end of the dashed line it names. `at` is how far down the drawing that
 * is (0 the top, 1 the bottom). It sits above the line, or under it where
 * the solid line starts higher (a battery over 100%), so the two never
 * cross. None when Windows recorded no original capacity. */
export function designLabel(
  points: HistoryPoint[],
): { value: number; at: number; below: boolean } | null {
  const first = points[0];
  if (!first?.design) return null;
  return {
    value: first.design,
    at: Math.round((1 - first.design / chartMax(points)) * 1000) / 1000,
    below: first.full > first.design,
  };
}

export function drawHistory(svg: SVGSVGElement, points: HistoryPoint[]): void {
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  const max = chartMax(points);
  const last = Math.max(points.length - 1, 1);
  const x = (i: number) => round((i / last) * WIDTH);
  const y = (v: number) => round(HEIGHT - (v / max) * HEIGHT);
  const line = (value: (p: HistoryPoint) => number) =>
    points.map((p, i) => `${i ? "L" : "M"}${x(i)} ${y(value(p))}`).join(" ");

  const axes = el("g", { class: "axes" });
  axes.append(
    el("line", { x1: "0", y1: `${HEIGHT}`, x2: `${WIDTH}`, y2: `${HEIGHT}` }),
  );
  svg.append(
    axes,
    el("path", { class: "design", d: line((p) => p.design) }),
    el("path", { class: "full", d: line((p) => p.full) }),
  );
}

const round = (n: number) => Math.round(n * 10) / 10;
