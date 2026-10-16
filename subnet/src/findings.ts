// What's worth a look across a plan's ranges: lines that aren't ranges,
// addresses read as their network, parts that aren't inside their range,
// ranges typed twice, ranges inside ranges (two prefixes only ever overlap
// by one holding the other), clashes with Docker's defaults, space that
// isn't for a home or office network, and names given twice. A range typed many times is one finding, not one
// per pair, so a long plan stays quick.
import { contains, DOCKER, end, kindOf, type Kind } from "./ip.ts";
import { contains6, end6, kind6, type Kind6 } from "./ip6.ts";
import type { Bad, Entry, Net } from "./plan.ts";

// Space that isn't what a home or office plan is made of.
export type OddKind = Exclude<
  Kind | Kind6,
  "private" | "cgnat" | "ula" | "global"
>;
const isOdd = (k: Kind | Kind6): k is OddKind =>
  k !== "private" && k !== "cgnat" && k !== "ula" && k !== "global";

/** How a range meets one of Docker's: it is it, includes it, or is
 * inside it. */
export type Within = "is" | "includes" | "inside";

export type Finding =
  | { rule: "notInside"; child: number; parent: number }
  // Ranges inside `outer`, in address order, each with the range it sits
  // in directly when that isn't `outer` (loopback inside p2p inside wide).
  | {
      rule: "inside";
      outer: number;
      inner: { i: number; via: number | null }[];
    }
  // a and b are the same range; `others` is how many more than a.
  | { rule: "sameRange"; a: number; b: number; others: number }
  // How a range meets Docker's bridge: it is it, holds it, or sits in it.
  | { rule: "bridge"; i: number; how: "is" | "includes" | "inside" }
  | { rule: "pool"; i: number }
  // Ranges that meet 192.168.0.0/16, Docker's last default pool, by how
  // (it is it, holds it, or sits in it): a quiet note.
  | { rule: "pool192"; list: number[]; how: Within }
  // An address with host bits set, read as its network.
  | { rule: "host"; i: number }
  | { rule: "kind"; i: number; kind: OddKind }
  | { rule: "sameName"; name: string; count: number }
  | ({ rule: "bad" } & Bad);

/** Notes that don't make a plan "worth a look" on their own. */
export const isSoft = (f: Finding) => f.rule === "pool192";

/** How many pairs of ranges a list of findings says clash: the same range
 * typed twice. (Two prefixes can't overlap in part: one holds the other,
 * which is fine for a block and its subnets.) */
export const overlapPairs = (all: Finding[]) =>
  all.reduce((n, f) => (f.rule === "sameRange" ? n + f.others : n), 0);

export const netKey = (n: Net) => `${n.v}:${n.range.start}/${n.range.prefix}`;

const within = (outer: Net, inner: Net) =>
  outer.v === 4 && inner.v === 4
    ? contains(outer.range, inner.range)
    : outer.v === 6 && inner.v === 6
      ? contains6(outer.range, inner.range)
      : false;

const touches = (n: Net, s: { first: number; last: number }) =>
  n.v === 4 && n.range.start <= s.last && end(n.range) >= s.first;

const kindOfNet = (n: Net): Kind | Kind6 =>
  n.v === 4 ? kindOf(n.range).kind : kind6(n.range);

export function findings(entries: Entry[], bad: Bad[]): Finding[] {
  // Lines that couldn't be read come first: the plan is missing them.
  const out: Finding[] = bad.map((b) => ({ rule: "bad", ...b }));
  // Then what was read differently from how it was typed.
  entries.forEach((e, i) => {
    if (e.host) out.push({ rule: "host", i });
  });
  entries.forEach((e, i) => {
    if (e.parent === null) return;
    const parent = entries[e.parent];
    if (parent && !within(parent.net, e.net)) {
      out.push({ rule: "notInside", child: i, parent: e.parent });
    }
  });

  // A range and its own parts sit inside each other on purpose.
  const related = (i: number, j: number) =>
    entries[i]?.parent === j || entries[j]?.parent === i;

  // The same range, however many times: one group, in plan order.
  const groups = new Map<string, number[]>();
  entries.forEach((e, i) => {
    const key = netKey(e.net);
    const group = groups.get(key);
    if (group) group.push(i);
    else groups.set(key, [i]);
  });

  // Findings between ranges, each kept with the plan line it starts at, so
  // the list reads top to bottom.
  const pairs: { at: number; f: Finding }[] = [];
  for (const members of groups.values()) {
    // A part typed the same as its own range is on purpose.
    const real = members.filter((i) => {
      const p = entries[i]?.parent;
      return p === null || p === undefined || !members.includes(p);
    });
    const [a, b] = real;
    if (a !== undefined && b !== undefined) {
      pairs.push({
        at: a,
        f: { rule: "sameRange", a, b, others: real.length - 1 },
      });
    }
  }

  // Ranges inside ranges. Two prefixes either nest or don't touch, so the
  // distinct ranges form a tree: in address order (the bigger first), each
  // one's holder is the nearest open range that still holds it. A chain
  // (loopback in p2p in wide) is one finding, under its outermost range;
  // a split's parts sit inside their range on purpose, and start a chain
  // of their own.
  const distinct = [...groups.values()];
  const netOf = (g: number[]) => entries[g[0] ?? 0]?.net;
  for (const v of [4, 6] as const) {
    const list = distinct
      .filter((g) => netOf(g)?.v === v)
      .map((g) => {
        const net = netOf(g) as Net;
        const first = BigInt(net.range.start);
        const last = net.v === 4 ? BigInt(end(net.range)) : end6(net.range);
        return { g, net, first, last };
      })
      .sort(
        (p, q) =>
          (p.first < q.first ? -1 : p.first > q.first ? 1 : 0) ||
          p.net.range.prefix - q.net.range.prefix,
      );
    type Node = (typeof list)[number] & {
      holder: Node | null;
      // The outermost range of its chain, when it's in one.
      top: Node | null;
      // The line it's named by: one not a part of its holder, if any.
      i: number;
    };
    const open: Node[] = [];
    const chains = new Map<Node, Node[]>();
    for (const item of list) {
      while (open.length && (open.at(-1)?.last ?? 0n) < item.first) open.pop();
      const holder = open.at(-1) ?? null;
      const free = holder
        ? item.g.filter((i) => holder.g.some((o) => !related(o, i)))
        : [];
      const node: Node = {
        ...item,
        holder,
        top: null,
        i: free[0] ?? item.g[0] ?? 0,
      };
      if (holder && free.length) {
        node.top = holder.top ?? holder;
        const chain = chains.get(node.top);
        if (chain) chain.push(node);
        else chains.set(node.top, [node]);
      }
      open.push(node);
    }
    for (const [top, inner] of chains) {
      pairs.push({
        at: Math.min(top.i, ...inner.map((n) => n.i)),
        f: {
          rule: "inside",
          outer: top.i,
          inner: inner.map((n) => ({
            i: n.i,
            via: n.holder && n.holder !== top ? n.holder.i : null,
          })),
        },
      });
    }
  }
  pairs.sort((p, q) => p.at - q.at);
  for (const p of pairs) out.push(p.f);

  // Docker's ranges and other kinds of space: once per range, and once
  // per range with its parts (a part says nothing its range hasn't).
  const oncePer = (test: (e: Entry, i: number) => boolean) => {
    const said = new Set<string>();
    const roots = new Set<number>();
    const found: number[] = [];
    entries.forEach((e, i) => {
      const key = netKey(e.net);
      const root = e.parent ?? i;
      if (said.has(key) || roots.has(root) || !test(e, i)) return;
      found.push(i);
      said.add(key);
      roots.add(root);
    });
    return found;
  };
  const meets = (
    e: Entry,
    span: { first: number; last: number },
  ): Within | null => {
    if (e.net.v !== 4 || !touches(e.net, span)) return null;
    const r = e.net.range;
    return r.start === span.first && end(r) === span.last
      ? "is"
      : r.start <= span.first && end(r) >= span.last
        ? "includes"
        : "inside";
  };
  const bridgeOf = (e: Entry) => meets(e, DOCKER.bridge);
  for (const i of oncePer(
    (e) => bridgeOf(e) !== null || touches(e.net, DOCKER.pool),
  )) {
    const e = entries[i] as Entry;
    const how = bridgeOf(e);
    out.push(how ? { rule: "bridge", i, how } : { rule: "pool", i });
  }
  const kinds = new Map<number, OddKind>();
  for (const i of oncePer((e, i) => {
    const kind = kindOfNet(e.net);
    if (isOdd(kind)) kinds.set(i, kind);
    return isOdd(kind);
  })) {
    const kind = kinds.get(i);
    if (kind) out.push({ rule: "kind", i, kind });
  }

  // Names, whatever their case.
  const names = new Map<string, { name: string; count: number }>();
  for (const e of entries) {
    const key = e.name.toLowerCase();
    if (!key) continue;
    const seen = names.get(key);
    if (seen) seen.count++;
    else names.set(key, { name: e.name, count: 1 });
  }
  for (const { name, count } of names.values()) {
    if (count > 1) out.push({ rule: "sameName", name, count });
  }

  // Last, quietly: ranges in Docker's last pool, all in one note (one
  // more for any range that is or holds the whole pool).
  const home = oncePer((e) => touches(e.net, DOCKER.last));
  for (const how of ["inside", "is", "includes"] as const) {
    const list = home.filter((i) => {
      const e = entries[i];
      return e && meets(e, DOCKER.last) === how;
    });
    if (list.length) out.push({ rule: "pool192", list, how });
  }
  return out;
}
