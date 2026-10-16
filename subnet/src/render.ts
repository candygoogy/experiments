// A plan's answer, verdict first: the verdict, the map (one strip per
// IPv4 block, drawn in the browser into boxes sized here), what's worth a
// look, then each range as a row. Takes a document, so the example can be
// built into the page.
import {
  BLOCK,
  COPY,
  FINDING,
  KIND,
  KIND6,
  MAP,
  ODD,
  ROW,
  VERDICT,
} from "./copy.ts";
import { findings, isSoft, overlapPairs, type Finding } from "./findings.ts";
import { cidr, end, hosts, kindOf, mask, v4, wildcard } from "./ip.ts";
import { cidr6, kind6, sizeIn64s } from "./ip6.ts";
import type { Bad, Entry, Net } from "./plan.ts";
import { MAX_STRIPS, strips, type Strip } from "./strip.ts";

// The findings list shows this many; a line says how many more there are.
export const MAX_FINDINGS = 50;
// A phone's strip is as tall as its labels need, up to this many.
const MAX_ITEMS = 14;

export const netText = (n: Net) => (n.v === 4 ? cidr(n.range) : cidr6(n.range));
export const label = (e: Entry) => e.name || netText(e.net);

const nameIn = (entries: Entry[]) => (i: number) => {
  const e = entries[i];
  return e ? label(e) : "";
};

/** The verdict: ranges typed twice first, then ranges inside ranges (by
 * chain: "Two ranges sit inside wide."), then how many things are worth
 * a look. Quiet notes don't count. */
export function verdictOf(all: Finding[], entries: Entry[]): string {
  const pairs = overlapPairs(all);
  if (pairs) return VERDICT.overlap(pairs);
  const chains = all.flatMap((f) => (f.rule === "inside" ? [f] : []));
  const [only] = chains;
  if (only) {
    const n = chains.reduce((sum, f) => sum + f.inner.length, 0);
    return chains.length === 1
      ? VERDICT.inside(n, nameIn(entries)(only.outer))
      : VERDICT.insideMany(n);
  }
  const loud = all.filter((f) => !isSoft(f)).length;
  return loud ? VERDICT.worth(loud) : VERDICT.works;
}

const BAD = {
  octet: FINDING.octet,
  zero: FINDING.zero,
  parts: FINDING.parts,
  prefix: (line: number, part: string) => FINDING.prefix(line, part, 32),
  prefix6: (line: number, part: string) => FINDING.prefix(line, part, 128),
} as const;

export function sentence(f: Finding, entries: Entry[]): string {
  const name = nameIn(entries);
  switch (f.rule) {
    case "notInside": {
      const child = entries[f.child];
      return FINDING.notInside(
        child
          ? `${child.name ? `${child.name} ` : ""}${netText(child.net)}`
          : "",
        name(f.parent),
      );
    }
    case "inside":
      return FINDING.inside(
        name(f.outer),
        f.inner.map(({ i, via }) =>
          via === null ? name(i) : FINDING.via(name(i), name(via)),
        ),
      );
    case "sameRange": {
      const a = entries[f.a];
      return FINDING.sameRange(
        name(f.a),
        name(f.b),
        a ? netText(a.net) : "",
        f.others,
      );
    }
    case "bridge":
      return FINDING.bridge(name(f.i), f.how);
    case "pool":
      return FINDING.pool(name(f.i));
    case "pool192":
      return FINDING.pool192(f.list.map(name), f.how);
    case "host": {
      const e = entries[f.i];
      return e ? FINDING.host(e.typed ?? "", netText(e.net)) : "";
    }
    case "kind":
      return ODD[f.kind](name(f.i));
    case "sameName":
      return FINDING.sameName(f.name, f.count);
    case "bad":
      return f.why === "name"
        ? FINDING.badName(f.line, f.text)
        : f.why === "range"
          ? FINDING.badRange(f.line, f.text)
          : f.why === "mask"
            ? FINDING.badMask(f.line, f.text, f.part ?? "")
            : f.why
              ? BAD[f.why](f.line, f.part ?? "")
              : FINDING.bad(f.line, f.text);
  }
}

export function renderPlan(
  doc: Document,
  entries: Entry[],
  bad: Bad[],
  id: string,
  // The example shows no Split: it isn't the visitor's plan to change.
  { split = true }: { split?: boolean } = {},
): { nodes: HTMLElement[]; verdict: string; strips: Strip[] } {
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls?: string,
    text?: string,
  ) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const all = findings(entries, bad);
  const verdict = verdictOf(all, entries);
  // The verdict is a heading under the pane's label; the findings and the
  // ranges are headed under it.
  const nodes: HTMLElement[] = [el("h3", "verdict", verdict)];

  // The map: a line per strip (its block, its kind, its largest free
  // block), read out like any text, over a box the strip is drawn into,
  // sized by its lanes (or on phones, its labels).
  const list = strips(entries);
  const drawn = list.slice(0, MAX_STRIPS);
  if (list.length) {
    const map = el("div", "map");
    drawn.forEach((s, i) => {
      const head = el("p", "strip-head");
      const kind = kindOf(s.block).kind;
      head.append(el("span", "block", cidr(s.block)));
      const word = BLOCK[kind];
      if (word) head.append(" ", el("span", "kind", word));
      let largest = s.gaps[0];
      for (const g of s.gaps) {
        if (largest && g.free.size > largest.free.size) largest = g;
      }
      if (largest) {
        head.append(
          " ",
          el("span", "largest", MAP.freeLargest(cidr(largest.free))),
        );
      }
      const box = el("div", "track");
      box.setAttribute("aria-hidden", "true");
      box.dataset["lanes"] = String(Math.min(s.lanes, 6));
      box.dataset["items"] = String(
        Math.min(s.segments.length + s.gaps.length, MAX_ITEMS),
      );
      if (s.docker) box.dataset["docker"] = "";
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("id", `${id}-strip-${i}`);
      box.append(svg);
      map.append(head, box);
      // Said in words whenever a piece is drawn larger than its share.
      if (s.scaled) map.append(el("p", "strip-scale", MAP.notToScale));
    });
    const rest = list
      .slice(MAX_STRIPS)
      .reduce((n, s) => n + s.segments.length, 0);
    if (rest) map.append(el("p", "strip-more", MAP.notDrawn(rest)));
    nodes.push(map);
  }

  // What the verdict counts, then the quiet notes under their own
  // heading, so the count and the list above it agree.
  const loud = all.filter((f) => !isSoft(f));
  const soft = all.filter(isSoft);
  if (all.length) {
    const section = el("section", "findings");
    const heading = el("h4", "visually-hidden", COPY.findings);
    heading.id = `${id}-findings`;
    section.setAttribute("aria-labelledby", heading.id);
    section.append(heading);
    if (loud.length) {
      const items = el("ul");
      for (const f of loud.slice(0, MAX_FINDINGS)) {
        items.append(el("li", "", sentence(f, entries)));
      }
      if (loud.length > MAX_FINDINGS) {
        items.append(
          el("li", "more", COPY.moreFindings(loud.length - MAX_FINDINGS)),
        );
      }
      section.append(items);
    }
    if (soft.length) {
      const notes = el("ul", "notes");
      for (const f of soft) {
        notes.append(el("li", "quiet", sentence(f, entries)));
      }
      section.append(el("h4", "notes-head", COPY.notes), notes);
    }
    nodes.push(section);
  }

  const rows = el("ol", "ranges");
  entries.forEach((e, i) => {
    const li = el("li", e.parent === null ? "" : "part");
    li.dataset["index"] = String(i);
    const head = el("div", "head");
    head.append(el("h4", "name", label(e)));
    if (e.name) head.append(el("span", "cidr", netText(e.net)));
    const body = el("div", "body");
    // The plain line, then the details: what was typed, the numbers (folded
    // away on phones), and the kind of space when it isn't private.
    const details = el("div", "details");
    if (e.typed) {
      details.append(
        el(
          "p",
          "",
          (e.host ? FINDING.host : ROW.typed)(e.typed, netText(e.net)),
        ),
      );
    }
    const name = label(e);
    if (e.net.v === 4) {
      const r = e.net.range;
      const h = hosts(r);
      body.append(
        el(
          "p",
          "says",
          r.prefix === 32
            ? ROW.single(name, v4(r.start))
            : r.prefix === 31
              ? ROW.pair(name, v4(h.first), v4(h.last))
              : ROW.holds(name, h.count, v4(h.first), v4(h.last)),
        ),
      );
      const more = el("details", "more disclosure");
      const numbers = el("ul");
      // A /31 or /32 has no network or broadcast address: the plain line
      // already names its addresses.
      if (r.prefix < 31) {
        numbers.append(el("li", "", ROW.ends(v4(r.start), v4(end(r)))));
      }
      numbers.append(
        el("li", "", ROW.mask(mask(r.prefix), wildcard(r.prefix))),
        el("li", "", ROW.addresses(r.size)),
      );
      more.append(el("summary", "", COPY.more), numbers);
      details.append(more);
      // Private ranges are what a home uses: only other kinds are named.
      const kind = kindOf(r).kind;
      if (kind !== "private") details.append(el("p", "kind", KIND[kind]));
    } else {
      const r = e.net.range;
      body.append(el("p", "says", ROW.v6(name, r.prefix, sizeIn64s(r))));
      details.append(el("p", "kind", KIND6[kind6(r)]));
    }
    body.append(details);
    if (
      split &&
      e.parent === null &&
      e.net.v === 4 &&
      e.net.range.prefix < 31
    ) {
      const split = el("button", "split", COPY.split);
      split.setAttribute("type", "button");
      split.setAttribute("aria-expanded", "false");
      body.append(split);
    }
    li.append(head, body);
    rows.append(li);
  });
  nodes.push(rows);
  return { nodes, verdict, strips: drawn };
}
