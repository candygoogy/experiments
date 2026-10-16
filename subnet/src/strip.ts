// The map's geometry: one strip per block of address space, the ranges in
// address order along it. Widths follow each stretch's share of the block,
// except that no stretch is drawn smaller than a few percent (a /31 in a /8
// would be nothing), and a strip that does that says it isn't to scale; the
// text gives every exact size. A range inside another takes the lane under
// it; the same range typed twice takes another lane, and the two are
// hatched. Positions run from 0 to 1 along the strip.
//
// Strips: each private (or other special) block is one; public ranges
// share one when they fit in a /8 or less, and strips whose blocks
// overlap are one strip, so every overlap is drawn where it is.
import {
  contains,
  DOCKER,
  end,
  kindOf,
  SPACE,
  supernet,
  type Range4,
} from "./ip.ts";
import type { Entry } from "./plan.ts";

export interface Segment {
  index: number;
  lane: number;
  x0: number;
  x1: number;
}

export interface Span {
  x0: number;
  x1: number;
}

export interface Gap extends Span {
  // The largest aligned block that fits in the gap, and the gap as the
  // aligned blocks it's made of, in address order.
  free: Range4;
  blocks: Range4[];
}

// No stretch of a strip is drawn smaller than this share of it (less, when
// there are many stretches: never more than half the strip in all).
const FLOOR = 0.06;

// The map draws this many strips at most; the rows list every range.
export const MAX_STRIPS = 12;

// Public ranges share a strip only when their block is this small.
const PUBLIC_PREFIX = 8;

export interface Strip {
  block: Range4;
  lanes: number;
  segments: Segment[];
  overlaps: (Span & { lanes: [number, number] })[];
  gaps: Gap[];
  // Docker's default ranges, where they fall in this strip.
  docker: Span | null;
  // Some stretch is drawn larger than its share: not to scale.
  scaled: boolean;
  // Where an address falls along the strip, 0 to 1.
  at: (address: number) => number;
}

/** The largest block, aligned to its own size, between lo and hi. */
export function largestFree(lo: number, hi: number): Range4 | null {
  for (let prefix = 0; prefix <= 32; prefix++) {
    const size = 2 ** (32 - prefix);
    const start = Math.ceil(lo / size) * size;
    if (start + size - 1 <= hi) return { start, size, prefix };
  }
  return null;
}

/** A stretch of addresses as the aligned blocks it's made of, in order:
 * 192.168.2.0 to 192.168.255.255 is a /23, a /22, and so on to a /17. */
export function alignedBlocks(lo: number, hi: number): Range4[] {
  const out: Range4[] = [];
  for (let at = lo; at <= hi;) {
    let prefix = 0;
    let size = SPACE;
    while (at % size !== 0 || at + size - 1 > hi) size = 2 ** (32 - ++prefix);
    out.push({ start: at, size, prefix });
    at += size;
  }
  return out;
}

/** The block a strip shows for a range: its private block, or itself. */
export const homeBlock = (r: Range4): Range4 => kindOf(r).within ?? r;

type Placed = { range: Range4; index: number; parent: number | null };

export function strip(ranges: Placed[]): Strip {
  const blockRange = supernet(ranges.map((r) => homeBlock(r.range)));
  const first = blockRange.start;
  const last = end(blockRange);
  const clamp = (a: number) => Math.min(Math.max(a, first), last + 1);

  const dockerHere = first <= DOCKER.pool.last && last >= DOCKER.bridge.first;
  // The strip in pieces: each stretch the ranges cover (overlaps and
  // splits merged) and each free stretch between them, also cut where
  // Docker's ranges begin and end.
  const covered: [number, number][] = [];
  for (const { range } of [...ranges].sort(
    (p, q) => p.range.start - q.range.start,
  )) {
    const lo = Math.max(range.start, first);
    const hi = Math.min(end(range), last);
    const prev = covered.at(-1);
    if (prev && lo <= prev[1] + 1) prev[1] = Math.max(prev[1], hi);
    else covered.push([lo, hi]);
  }
  const free: { lo: number; hi: number }[] = [];
  const freeCuts = dockerHere
    ? [DOCKER.bridge.first, DOCKER.pool.last + 1].filter(
        (c) => c > first && c <= last,
      )
    : [];
  const addFree = (lo: number, hi: number) => {
    let from = lo;
    for (const c of freeCuts) {
      if (c > from && c <= hi) {
        free.push({ lo: from, hi: c - 1 });
        from = c;
      }
    }
    if (from <= hi) free.push({ lo: from, hi });
  };
  let at = first;
  for (const [lo, hi] of covered) {
    if (lo > at) addFree(at, lo - 1);
    at = hi + 1;
  }
  if (at <= last) addFree(at, last);

  // Drawn in stretches cut wherever a range or a free piece begins or
  // ends; each is as wide as its share, or the floor when that's more.
  const cutSet = new Set<number>([first, last + 1]);
  for (const { range } of ranges) {
    cutSet.add(clamp(range.start)).add(clamp(end(range) + 1));
  }
  for (const f of free) cutSet.add(f.lo).add(f.hi + 1);
  const cuts = [...cutSet].sort((p, q) => p - q);
  const sizes = cuts.slice(1).map((c, i) => c - (cuts[i] ?? 0));
  const floor = Math.min(FLOOR, 0.5 / sizes.length);
  const widths = sizes.map(() => 0);
  // The smallest first: each one under the floor gets it, and the rest
  // share what's left by size.
  let rest = sizes.reduce((sum, n) => sum + n, 0);
  let share = 1;
  let scaled = false;
  const bySize = sizes
    .map((_, i) => i)
    .sort((p, q) => (sizes[p] ?? 0) - (sizes[q] ?? 0));
  for (const i of bySize) {
    const n = sizes[i] ?? 0;
    if ((n / rest) * share >= floor) break;
    widths[i] = floor;
    rest -= n;
    share -= floor;
    scaled = true;
  }
  sizes.forEach((n, i) => {
    if (!widths[i]) widths[i] = (n / rest) * share;
  });
  const starts: number[] = [];
  widths.reduce((sum, w) => (starts.push(sum), sum + w), 0);
  const x = (address: number) => {
    const a = clamp(address);
    if (a > last) return 1;
    // The stretch holding a: the last cut at or before it.
    let lo = 0;
    let hi = sizes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((cuts[mid] ?? 0) <= a) lo = mid;
      else hi = mid - 1;
    }
    const from = cuts[lo] ?? first;
    return (
      (starts[lo] ?? 0) + ((a - from) / (sizes[lo] ?? 1)) * (widths[lo] ?? 0)
    );
  };

  // Lanes: each range on the first lane free over its whole span.
  const sorted = [...ranges].sort(
    (a, b) => a.range.start - b.range.start || b.range.size - a.range.size,
  );
  const laneEnds: number[] = [];
  const segments = sorted.map(({ range, index }) => {
    let lane = laneEnds.findIndex((e) => e < range.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = end(range);
    return { index, lane, x0: x(range.start), x1: x(end(range) + 1) };
  });

  // Clashes: the same range typed more than once (a range inside another
  // has its own lane, and may be its subnet). In address order, the same
  // ranges sit side by side. Each copy is hatched once, across every lane
  // from its first copy's to its own.
  const lane = (i: number) => segments[i]?.lane ?? 0;
  const shared = new Map<number, [number, number]>();
  sorted.forEach((a, i) => {
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (!b || b.range.start !== a.range.start) break;
      if (b.range.size !== a.range.size) break;
      // A split's parts sit inside their range on purpose.
      if (a.parent === b.index || b.parent === a.index) continue;
      const [lo, hi] = shared.get(j) ?? [lane(j), lane(j)];
      shared.set(j, [Math.min(lo, lane(i)), Math.max(hi, lane(i))]);
    }
  });
  const overlaps: Strip["overlaps"] = [];
  for (const [j, lanes] of shared) {
    const b = sorted[j];
    if (b) {
      overlaps.push({ x0: x(b.range.start), x1: x(end(b.range) + 1), lanes });
    }
  }

  // Gaps: the free pieces, each with its blocks and the largest of them.
  const gaps: Gap[] = free.flatMap((p) => {
    const blocks = alignedBlocks(p.lo, p.hi);
    let largest = blocks[0];
    for (const b of blocks) if (largest && b.size > largest.size) largest = b;
    return largest
      ? [{ x0: x(p.lo), x1: x(p.hi + 1), free: largest, blocks }]
      : [];
  });

  return {
    block: blockRange,
    lanes: Math.max(1, laneEnds.length),
    segments,
    overlaps,
    gaps,
    docker: dockerHere
      ? { x0: x(DOCKER.bridge.first), x1: x(DOCKER.pool.last + 1) }
      : null,
    scaled,
    at: x,
  };
}

/** The IPv4 ranges grouped into strips, in address order (IPv6 ranges
 * have no strip: their text says it all). */
export function strips(entries: Entry[]): Strip[] {
  const special = new Map<string, Placed[]>();
  const loose: Placed[] = [];
  entries.forEach(({ net, parent }, index) => {
    if (net.v !== 4) return;
    const placed = { range: net.range, index, parent };
    const within = kindOf(net.range).within;
    if (!within) {
      loose.push(placed);
      return;
    }
    const key = `${within.start}/${within.prefix}`;
    const group = special.get(key);
    if (group) group.push(placed);
    else special.set(key, [placed]);
  });
  const groups: { block: Range4; ranges: Placed[] }[] = [
    ...special.values(),
  ].map((ranges) => ({
    block: supernet(ranges.map((r) => homeBlock(r.range))),
    ranges,
  }));
  // Public (and mixed) ranges in address order, side by side while their
  // block stays a /8 or smaller.
  loose.sort((a, b) => a.range.start - b.range.start);
  const clusters: typeof groups = [];
  for (const r of loose) {
    const last = clusters.at(-1);
    const block = last && supernet([last.block, r.range]);
    if (last && block && block.prefix >= PUBLIC_PREFIX) {
      last.block = block;
      last.ranges.push(r);
    } else {
      clusters.push({ block: r.range, ranges: [r] });
    }
  }
  groups.push(...clusters);
  // Strips whose blocks overlap are one: one holds the other, so the
  // bigger first in address order takes in the ones inside it.
  groups.sort(
    (a, b) => a.block.start - b.block.start || a.block.prefix - b.block.prefix,
  );
  const merged: { block: Range4; ranges: Placed[] }[] = [];
  for (const g of groups) {
    const last = merged.at(-1);
    if (last && contains(last.block, g.block)) last.ranges.push(...g.ranges);
    else merged.push({ block: g.block, ranges: [...g.ranges] });
  }
  return merged.map((g) => strip(g.ranges));
}
