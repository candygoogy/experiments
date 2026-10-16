// Draws a strip into its SVG at the size its box has (measured by the
// caller, every box before any drawing): across on wide screens, down on
// phones. The box's size comes from CSS (its lanes, or on phones its
// labels), so drawing never moves the page. Decoration only: aria-hidden,
// and every fact is in the rows, findings and strip lines as text.
import type { Range4 } from "./ip";
import type { Strip } from "./strip";

const SVG = "http://www.w3.org/2000/svg";
// A lane's depth; more than six lanes share six lanes' depth. Past twelve
// lanes, the rest are drawn as one hatched band (the rows list each
// range), so no lane is ever too thin to draw.
const LANE = 40;
const MAX_LANES = 6;
const MAX_DRAWN = 12;
const MIN_LANE = 8;
// A free stretch is drawn as its blocks only when each is this long.
const BLOCK_MIN = 12;
const PAD = 4;
// How far a name may slide from its range to make room for another,
// along the strip (a leader line then joins them): wide screens, phones.
const SLIDE_ACROSS = 80;
const SLIDE_DOWN = 40;
// On a phone strip with more names than room: one line's height.
const CROWDED_DOWN = 16;

type Attrs = Record<string, string | number>;
const make = (tag: string, attrs: Attrs, text?: string) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
};

export interface Labels {
  // Each range's name, by its index in the plan.
  names: string[];
  // The names of one range typed more than once, as one label.
  together: (names: string[]) => string;
  free: (prefix: number) => string;
  // A free stretch of several blocks, by its size.
  freeSize: (n: number) => string;
  docker: string;
  first: string;
  last: string;
}

// Rough width of a 13px label: enough to decide whether it fits.
const textWidth = (s: string) => s.length * 7 + 14;
// On phones, room kept for Docker's bracket and its label down the far
// side.
const DOCKER_SIDE = 20;

/** A label cut with "…" to fit `room`, measured as drawn. The map is
 * decoration (aria-hidden): each name is written out in full in the rows
 * under it. */
function fitText(node: SVGTextElement, room: number): void {
  const full = node.textContent ?? "";
  // Measuring makes the browser lay the page out: only a name that may be
  // too long is measured (at 13px a letter is about 7px wide on average;
  // 9 leaves room for wide ones), and only once. Its text and a "…" are
  // laid out together, then every cut is read off that one layout.
  if (full.length * 9 <= room || room <= 0) return;
  node.textContent = `${full}…`;
  const width = (n: number) => node.getSubStringLength(0, n);
  // It fits, or isn't on the page to be measured: left as it is.
  if (!(width(full.length) > room)) {
    node.textContent = full;
    return;
  }
  const dots = node.getSubStringLength(full.length, 1);
  let lo = 0;
  let hi = full.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (width(mid) + dots <= room) lo = mid;
    else hi = mid - 1;
  }
  // Never half of a character written as two code units.
  const code = full.charCodeAt(lo - 1);
  if (code >= 0xd800 && code <= 0xdbff) lo--;
  node.textContent = `${full.slice(0, lo).trimEnd()}…`;
}

/** Labels along a line, in order, each wanting to be at its centre: placed
 * so none overlap, each moved as little as it can be (labels that would
 * run into each other are spread around where they want to be, together).
 * A label that would move itself, or one already placed, further than
 * `most` (or, without it, half its own size) is left out: null. */
export function slide(
  items: { centre: number; half: number }[],
  length: number,
  most?: number,
): (number | null)[] {
  // Runs of labels side by side: a run starts at the mean of where each of
  // its labels would have it start, kept on the line.
  type Run = { ids: number[]; size: number; sum: number };
  const startOf = (r: Run) =>
    Math.max(0, Math.min(r.sum / r.ids.length, length - r.size));
  const fits = (r: Run) => {
    if (r.size > length) return false;
    let a = startOf(r);
    for (const i of r.ids) {
      const { centre, half } = items[i] ?? { centre: 0, half: 0 };
      if (Math.abs(a + half - centre) > (most ?? half) + 0.01) return false;
      a += half * 2;
    }
    return true;
  };
  const runs: Run[] = [];
  items.forEach(({ centre, half }, i) => {
    let run: Run = { ids: [i], size: half * 2, sum: centre - half };
    const merged: Run[] = [];
    for (let prev = runs.at(-1); prev; prev = runs.at(-1)) {
      if (startOf(prev) + prev.size <= startOf(run)) break;
      merged.push(runs.pop() ?? prev);
      run = {
        ids: [...prev.ids, ...run.ids],
        size: prev.size + run.size,
        sum: prev.sum + run.sum - run.ids.length * prev.size,
      };
    }
    if (fits(run)) runs.push(run);
    else runs.push(...merged.reverse());
  });
  const at: (number | null)[] = items.map(() => null);
  for (const run of runs) {
    let a = startOf(run);
    for (const i of run.ids) {
      const half = items[i]?.half ?? 0;
      at[i] = a + half;
      a += half * 2;
    }
  }
  return at;
}

export function drawStrip(
  svg: SVGSVGElement,
  box: { width: number; height: number },
  // Down the page (phones) or across it.
  down: boolean,
  s: Strip,
  labels: Labels,
  // A split being tried: dashed lines where its parts would begin.
  preview?: Range4[],
): void {
  // Not on the page (a hidden pane): nothing to draw yet.
  if (!box.width || !box.height) return;
  const across = !down;
  const length = across ? box.width : box.height;
  const track = Math.min(s.lanes, MAX_LANES) * LANE;
  const drawn = s.lanes > MAX_DRAWN ? MAX_DRAWN + 1 : s.lanes;
  const lane = Math.max(MIN_LANE, track / drawn);
  const laneOf = (l: number) => Math.min(l, MAX_DRAWN);
  svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);

  // Along the strip (a) and across it (b), whichever way it runs.
  const rect = (a0: number, a1: number, b0: number, b1: number, attrs: Attrs) =>
    make(
      "rect",
      across
        ? { x: a0, y: b0, width: a1 - a0, height: b1 - b0, ...attrs }
        : { x: b0, y: a0, width: b1 - b0, height: a1 - a0, ...attrs },
    );
  const line = (a0: number, b0: number, a1: number, b1: number, attrs: Attrs) =>
    make(
      "line",
      across
        ? { x1: a0, y1: b0, x2: a1, y2: b1, ...attrs }
        : { x1: b0, y1: a0, x2: b1, y2: a1, ...attrs },
    );
  const text = (a: number, b: number, t: string, attrs: Attrs) =>
    make(
      "text",
      across ? { x: a, y: b, ...attrs } : { x: b, y: a, ...attrs },
      t,
    );
  const L = (x: number) => x * length;
  // At least 4px, so a single address still shows.
  const wide = (x0: number, x1: number): [number, number] => {
    const a = L(x0);
    const b = L(x1);
    return b - a >= 4 ? [a, b] : [(a + b) / 2 - 2, (a + b) / 2 + 2];
  };

  const hatchId = `${svg.id}-hatch`;
  const pattern = make("pattern", {
    id: hatchId,
    width: 6,
    height: 6,
    patternUnits: "userSpaceOnUse",
    patternTransform: "rotate(45)",
  });
  pattern.append(
    make("rect", { class: "hatch-bg", width: 6, height: 6 }),
    make("line", { class: "hatch-line", x1: 0, y1: 0, x2: 0, y2: 6 }),
  );
  const defs = make("defs", {});
  defs.append(pattern);
  const shapes: Element[] = [defs];
  const words: Element[] = [];

  // Labels outside the strip (under it on wide screens, beside it on
  // phones). Every range is named there, never inside or beside its box,
  // so each name sits the same way against its range: centred on it and
  // slid apart from its neighbours as little as they need (see slide),
  // with a thin leader to the box when the name isn't right against it (a
  // box above another lane, or a name slid off its box). Free-space labels
  // that don't fit in their stretch follow where there's still room; one
  // that would run into a placed label is left out.
  const half = (t: string) => (across ? textWidth(t) / 2 : 8);
  // Where a leader meets the row of labels.
  const row = across ? track + 3 : track + 9;
  const taken: [number, number][] = [];
  // Each name and the room it has: centred on wide screens, so as far as
  // the nearer end goes both ways; on phones, from the strip to the edge;
  // less PAD for the outline drawn around each letter.
  const names: [SVGTextElement, number][] = [];
  const side = box.width - (track + 12) - (s.docker ? DOCKER_SIDE : 0);
  const put = (at: number, t: string, cls: string) => {
    taken.push([at - half(t), at + half(t)]);
    const node = across
      ? text(at, track + 14, t, { class: cls, "text-anchor": "middle" })
      : text(at, track + 12, t, {
          class: cls,
          "dominant-baseline": "middle",
        });
    words.push(node);
    if (cls === "range-name") {
      names.push([
        node as SVGTextElement,
        (across ? 2 * Math.min(at, length - at) : side) - PAD,
      ]);
    }
  };
  const fitsIn = (t: string, a0: number, a1: number) =>
    across && textWidth(t) < a1 - a0 && lane >= 28;

  // Free stretches: dashed, across every lane, so the strip reads as one
  // band. A stretch that is one aligned block is named by it ("free /16").
  // One made of several is drawn block by block when every block is wide
  // enough to tell apart, each named where its name fits; otherwise as one
  // stretch, named by its size. A name that doesn't fit inside goes under
  // the strip, under its stretch, if there's room once the ranges are
  // named.
  const freeOutside: { centre: number; t: string }[] = [];
  for (const g of s.gaps) {
    const [a0, a1] = [L(g.x0), L(g.x1)];
    if (a1 - a0 < 6) continue;
    const blocks = g.blocks.map((b) => ({
      a0: L(s.at(b.start)),
      a1: L(s.at(b.start + b.size)),
      t: labels.free(b.prefix),
    }));
    const size = g.blocks.reduce((n, b) => n + b.size, 0);
    const shown =
      blocks.length > 1 && blocks.every((b) => b.a1 - b.a0 >= BLOCK_MIN)
        ? blocks
        : [
            {
              a0,
              a1,
              t:
                blocks.length === 1
                  ? labels.free(g.free.prefix)
                  : labels.freeSize(size),
            },
          ];
    for (const b of shown) {
      if (b.a1 - b.a0 < 6) continue;
      shapes.push(rect(b.a0 + 2, b.a1 - 2, PAD, track - PAD, { class: "gap" }));
      if (fitsIn(b.t, b.a0, b.a1)) {
        words.push(text(b.a0 + 8, lane / 2 + 4, b.t, { class: "gap-label" }));
      } else if (across || b.a1 - b.a0 > 18) {
        freeOutside.push({ centre: (b.a0 + b.a1) / 2, t: b.t });
      }
    }
  }

  // The ranges, each in its lane (a range inside another in the lane
  // under it); those past the last lane drawn share one hatched band. The
  // same range typed more than once is one box, hatched across its lanes
  // and named once with all its names.
  let rest: [number, number] | null = null;
  type Box = {
    a0: number;
    a1: number;
    lanes: [number, number];
    indexes: number[];
  };
  const boxes = new Map<string, Box>();
  for (const seg of s.segments) {
    const [a0, a1] = wide(seg.x0, seg.x1);
    if (seg.lane >= MAX_DRAWN) {
      rest = rest ? [Math.min(rest[0], a0), Math.max(rest[1], a1)] : [a0, a1];
      continue;
    }
    const b0 = seg.lane * lane + PAD;
    shapes.push(rect(a0, a1, b0, b0 + lane - 2 * PAD, { class: "range" }));
    const key = `${seg.x0} ${seg.x1}`;
    const box = boxes.get(key);
    if (box) {
      box.lanes = [
        Math.min(box.lanes[0], seg.lane),
        Math.max(box.lanes[1], seg.lane),
      ];
      box.indexes.push(seg.index);
    } else {
      boxes.set(key, {
        a0,
        a1,
        lanes: [seg.lane, seg.lane],
        indexes: [seg.index],
      });
    }
  }
  // Where ranges overlap: the hatch, across the lanes they share.
  const hatch = { class: "clash", fill: `url(#${hatchId})` };
  // (Overlaps past the last lane can look the same: each is drawn once.)
  const hatched = new Set<string>();
  for (const o of s.overlaps) {
    const [a0, a1] = wide(o.x0, o.x1);
    const [l0, l1] = [laneOf(o.lanes[0]), laneOf(o.lanes[1])];
    const key = `${a0} ${a1} ${l0} ${l1}`;
    if (hatched.has(key)) continue;
    hatched.add(key);
    shapes.push(rect(a0, a1, l0 * lane + PAD, (l1 + 1) * lane - PAD, hatch));
  }
  if (rest) {
    const b0 = MAX_DRAWN * lane + PAD;
    shapes.push(rect(rest[0], rest[1], b0, b0 + lane - 2 * PAD, hatch));
  }

  // Where a box's name points along the strip: the middle of its widest
  // stretch that no box in a deeper lane covers, so its leader crosses
  // none; its edge when all of it is covered (a range with its parts typed
  // under it), where the leader runs down the parts' own edge.
  // (Prefixes nest, so a box in a deeper lane that meets this one lies
  // within it: in start order they follow it, found by a binary search.)
  const all = [...boxes.values()].sort((p, q) => p.a0 - q.a0);
  const firstFrom = (a: number) => {
    let lo = 0;
    let hi = all.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((all[mid]?.a0 ?? 0) < a) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const anchorOf = (b: Box): number => {
    const cover: [number, number][] = [];
    // A box a few pixels wide is widened around its middle (wide()), so it
    // can start a little before the box holding it.
    for (let k = firstFrom(b.a0 - 4); k < all.length; k++) {
      const o = all[k];
      if (!o || o.a0 >= b.a1) break;
      if (o.lanes[0] > b.lanes[1] && b.a0 < o.a1) cover.push([o.a0, o.a1]);
    }
    if (rest && rest[0] < b.a1 && b.a0 < rest[1]) cover.push(rest);
    cover.sort((p, q) => p[0] - q[0]);
    let best: [number, number] = [b.a0, b.a0];
    let from = b.a0;
    const consider = (to: number) => {
      if (to - from > best[1] - best[0]) best = [from, to];
    };
    for (const [c0, c1] of cover) {
      consider(Math.min(c0, b.a1));
      from = Math.max(from, c1);
    }
    consider(b.a1);
    return best[1] - best[0] > 1 ? (best[0] + best[1]) / 2 : b.a0;
  };
  const named = all
    .map((b) => ({
      b,
      centre: anchorOf(b),
      t:
        b.indexes.length > 1
          ? labels.together(
              [...b.indexes]
                .sort((p, q) => p - q)
                .map((i) => labels.names[i] ?? ""),
            )
          : (labels.names[b.indexes[0] ?? 0] ?? ""),
    }))
    .sort((p, q) => p.centre - q.centre);
  // More names than the row holds (a long plan): only some are placed
  // whatever they do, so each keeps close to its range, as before leaders
  // (its own size; one line on phones), which also keeps slide quick.
  const crowded = named.reduce((sum, n) => sum + 2 * half(n.t), 0) > length;
  const at = slide(
    named.map((n) => ({ centre: n.centre, half: half(n.t) })),
    length,
    across
      ? crowded
        ? undefined
        : SLIDE_ACROSS
      : crowded
        ? CROWDED_DOWN
        : SLIDE_DOWN,
  );
  named.forEach((n, i) => {
    const a = at[i];
    if (a === null || a === undefined) return;
    put(a, n.t, "range-name");
    // Right against the row of labels: a box in the last lane, its name
    // still over it. Anything else gets its leader.
    const edge = (n.b.lanes[1] + 1) * lane - PAD;
    const against = edge >= track - PAD - 0.5;
    if (against && Math.abs(a - n.centre) <= half(n.t)) return;
    shapes.push(line(n.centre, edge, a, row, { class: "leader" }));
  });
  freeOutside.sort((p, q) => p.centre - q.centre);
  for (const { centre: wants, t } of freeOutside) {
    // Kept on the line: a stretch at an end has its name over it.
    const centre = Math.min(Math.max(wants, half(t)), length - half(t));
    const lo = centre - half(t);
    const hi = centre + half(t);
    if (taken.some(([p, q]) => lo < q && p < hi)) continue;
    put(centre, t, "gap-label");
  }

  // A split being tried: where each part would begin.
  for (const part of (preview ?? []).slice(1)) {
    const a = L(s.at(part.start));
    shapes.push(line(a, PAD, a, track - PAD, { class: "preview" }));
  }
  // Docker's default ranges: a bracket under the strip, or down its far
  // side on phones, with the label along it.
  if (s.docker) {
    const [a0, a1] = [L(s.docker.x0), L(s.docker.x1)];
    if (across) {
      const b = track + 30;
      shapes.push(
        line(a0, b, a1, b, { class: "bracket" }),
        line(a0, b - 4, a0, b, { class: "bracket" }),
        line(a1, b - 4, a1, b, { class: "bracket" }),
      );
      words.push(text(a0, b + 14, labels.docker, { class: "note" }));
    } else {
      const x = box.width - 2;
      const mid = (a0 + a1) / 2;
      shapes.push(
        make("line", { x1: x, y1: a0, x2: x, y2: a1, class: "bracket" }),
        make("line", { x1: x - 4, y1: a0, x2: x, y2: a0, class: "bracket" }),
        make("line", { x1: x - 4, y1: a1, x2: x, y2: a1, class: "bracket" }),
      );
      words.push(
        make(
          "text",
          {
            x: x - 10,
            y: mid,
            class: "note",
            "text-anchor": "middle",
            transform: `rotate(-90 ${x - 10} ${mid})`,
          },
          labels.docker,
        ),
      );
    }
  }
  // The block's first and last address at its ends (wide screens; the
  // line over the strip names the block on phones).
  if (across) {
    const b = box.height - 4;
    words.push(
      text(0, b, labels.first, { class: "end" }),
      text(length, b, labels.last, { class: "end", "text-anchor": "end" }),
    );
  }
  svg.replaceChildren(...shapes, ...words);
  for (const [node, room] of names) fitText(node, room);
}
