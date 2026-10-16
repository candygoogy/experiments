// The drawn keyboard: one SVG, a <g> per key holding its base, its cap and
// its legend. The base is the cap's shape 3 units lower, so it shows only
// as a lip under the cap; pressed, the cap drops onto it (keyboard.css).
// Built with DOM calls, so a legend from the browser's layout map is only
// ever text.
import { type Key, place, widthOf } from "./layouts";

// One key unit, the gap between keys, the cap's lift and its corner radius,
// in SVG units.
const U = 54;
const GAP = 6;
const LIFT = 3;
const RADIUS = 4;
// The function row stands half a unit above the rest.
const F_GAP = 0.5;

/** The drawing's size for a layout: 23 units wide in full (1244 × 353),
 * 18.5 without the number pad (1001 × 353); keyboard.css keeps the same
 * aspect ratios so the board's space is held before it's drawn. */
export const viewBoxOf = (layout: Key[][]) => ({
  width: widthOf(layout) * U + 2,
  height: (6 + F_GAP) * U + 2,
});

const NS = "http://www.w3.org/2000/svg";
const el = <K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

type Point = [number, number];

// A closed outline through the points, each corner rounded (a convex or a
// concave one alike).
function outline(points: Point[], dy = 0): string {
  const n = points.length;
  let d = "";
  points.forEach(([cx, cy], i) => {
    const [px, py] = points[(i - 1 + n) % n] ?? [cx, cy];
    const [nx, ny] = points[(i + 1) % n] ?? [cx, cy];
    const a = Math.hypot(cx - px, cy - py);
    const b = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(RADIUS, a / 2, b / 2);
    const x1 = cx + ((px - cx) * r) / a;
    const y1 = cy + ((py - cy) * r) / a;
    const x2 = cx + ((nx - cx) * r) / b;
    const y2 = cy + ((ny - cy) * r) / b;
    d += `${i ? "L" : "M"}${x1},${y1 + dy} Q${cx},${cy + dy} ${x2},${y2 + dy} `;
  });
  return `${d}Z`;
}

const rowTop = (row: number) => (row + (row > 0 ? F_GAP : 0)) * U;

// The cap's corners, inside the key's cell. A two-row key with a
// lowerInset (the ISO Enter) is an L.
function corners(key: Key, x: number, row: number): Point[] {
  const g = GAP / 2;
  const w = key.w ?? 1;
  const h = key.h ?? 1;
  const left = x * U + g;
  const right = (x + w) * U - g;
  const top = rowTop(row) + g;
  const bottom = rowTop(row + h - 1) + U - g - LIFT;
  if (h > 1 && key.lowerInset) {
    const step = rowTop(row + 1) - g;
    const inner = (x + key.lowerInset) * U + g;
    return [
      [left, top],
      [right, top],
      [right, bottom],
      [inner, bottom],
      [inner, step],
      [left, step],
    ];
  }
  return [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ];
}

/**
 * Draws the layout into host (replacing what was there) and returns each
 * key's <g> by code. Keys carry data-code and data-state ("idle", "down"
 * or "seen"); keys the browser only partly sees carry data-limit.
 */
export function renderBoard(
  host: HTMLElement,
  layout: Key[][],
  labels: ReadonlyMap<string, string> = new Map(),
): Map<string, SVGGElement> {
  const box = viewBoxOf(layout);
  const svg = el("svg", {
    viewBox: `-1 -1 ${box.width} ${box.height}`,
    focusable: "false",
  });
  const hatch = el("pattern", {
    id: "hatch",
    width: 6,
    height: 6,
    patternUnits: "userSpaceOnUse",
    patternTransform: "rotate(45)",
  });
  hatch.append(
    el("rect", { class: "hatch-bg", width: 6, height: 6 }),
    el("line", { class: "hatch-line", x1: 0, y1: 0, x2: 0, y2: 6 }),
  );
  const defs = el("defs");
  defs.append(hatch);
  svg.append(defs);

  const keys = new Map<string, SVGGElement>();
  for (const { key, x, row } of place(layout)) {
    const points = corners(key, x, row);
    const g = el("g", {
      class: "key",
      "data-code": key.code,
      "data-state": "idle",
    });
    if (key.partial) g.dataset["limit"] = "partial";
    g.append(
      el("path", { class: "base", d: outline(points, LIFT) }),
      el("path", { class: "cap", d: outline(points) }),
    );
    const label = labels.get(key.code) ?? key.label;
    if (label) {
      const [left, top] = points[0] ?? [0, 0];
      const text = el("text", { x: left + 8, y: top + 19 });
      text.textContent = label;
      g.append(text);
    }
    svg.append(g);
    keys.set(key.code, g);
  }
  host.replaceChildren(svg);
  return keys;
}
