// Draws a result: the verdict, the line under it, the timeline, and the
// groups as rows. It takes the document to draw in, so the same code
// draws the example when the page is built (in happy-dom) and a dropped
// log in the browser. The filters are drawn here and wired in main.ts.
import { copy, fill } from "./copy.ts";
import { canonical } from "./known.ts";
import { LEVELS, type Group, type Level, type Result } from "./model.ts";
import { parts } from "./normalize.ts";
import {
  about,
  formatDay,
  formatNumber,
  formatWhen,
  groupName,
  groupPlain,
  isNoise,
  sourceName,
  verdict,
} from "./summary.ts";

const SVG = "http://www.w3.org/2000/svg";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Up to this span the timeline counts per hour; past it, per day.
const HOURLY_UP_TO = 14 * DAY;
// Under this span, its ends are labelled with times, not just days.
const TIMES_UNDER = 36 * HOUR;
// The most points the line has: a log with dates decades apart (a clock
// reset to 1601) shows its latest stretch.
const MAX_BUCKETS = 4000;
/** Rows drawn at first, and then per "Show all". */
export const PAGE = 200;

type Make = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
) => HTMLElementTagNameMap[K];

const maker =
  (doc: Document): Make =>
  (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

/** A placeholder as a chip: what kind of part changes there. */
function chip(doc: Document, kind: string) {
  const words: Record<string, string> = copy.slots;
  const span = maker(doc)(
    "span",
    "slot",
    (Object.hasOwn(words, kind) ? words[kind] : null) ?? kind,
  );
  span.title = copy.slotTitle;
  return span;
}

/** A normalized text in an element, its placeholders as chips. */
function withChips(doc: Document, into: HTMLElement, text: string) {
  for (const part of parts(text)) {
    if ("text" in part) into.append(part.text);
    else into.append(chip(doc, part.slot));
  }
}

/** A normalized message, its placeholders as chips. */
function message(doc: Document, text: string, className: string) {
  const p = maker(doc)("p", className);
  withChips(doc, p, text);
  return p;
}

/** The counts per hour, or per day for a long log. */
function buckets(result: Result): {
  step: number;
  counts: number[];
  from: number;
} {
  const [firstHour] = result.hours[0] ?? [0];
  const [lastHour] = result.hours.at(-1) ?? [0];
  const span = (lastHour - firstHour) * HOUR;
  const step = span > HOURLY_UP_TO ? DAY : HOUR;
  const last = Math.floor((lastHour * HOUR) / step) * step;
  const from = Math.max(
    Math.floor((firstHour * HOUR) / step) * step,
    last - (MAX_BUCKETS - 1) * step,
  );
  const length = Math.floor((last - from) / step) + 1;
  const counts = new Array<number>(Math.max(1, length)).fill(0);
  for (const [hour, n] of result.hours) {
    const i = Math.floor((hour * HOUR - from) / step);
    if (i >= 0) counts[i] = (counts[i] ?? 0) + n;
  }
  return { step, counts, from };
}

function timeline(doc: Document, result: Result): HTMLElement | null {
  if (result.hours.length < 2) return null;
  const make = maker(doc);
  const { step, counts, from } = buckets(result);
  const W = 1000;
  const H = 100;
  let max = 1;
  for (const n of counts) if (n > max) max = n;
  const x = (i: number) =>
    counts.length > 1 ? (i / (counts.length - 1)) * W : 0;
  // A quiet hour rests on the axis: the line's centre sits just above it,
  // so its stroke never hangs below the baseline.
  const FLOOR = 1.6;
  const y = (n: number) => H - FLOOR - (n / max) * (H - FLOOR);

  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  const axis = doc.createElementNS(SVG, "line");
  axis.setAttribute("class", "axis");
  for (const [k, v] of [
    ["x1", 0],
    ["x2", W],
    ["y1", H],
    ["y2", H],
  ] as const) {
    axis.setAttribute(k, String(v));
  }
  svg.append(axis);
  const span = (counts.length - 1) * step || 1;
  for (const t of result.restarts) {
    if (t < from) continue;
    const at = ((t - from) / span) * W;
    const line = doc.createElementNS(SVG, "line");
    line.setAttribute("class", "restart");
    for (const [k, v] of [
      ["x1", at],
      ["x2", at],
      ["y1", 0],
      ["y2", H],
    ] as const) {
      line.setAttribute(k, v.toFixed(1));
    }
    svg.append(line);
  }
  const path = doc.createElementNS(SVG, "path");
  path.setAttribute(
    "d",
    counts
      .map((n, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(n).toFixed(1)}`)
      .join(" "),
  );
  svg.append(path);

  const hourly = step === HOUR;
  const strip = make("div", "strip");
  strip.append(
    make(
      "span",
      "peak num",
      fill(hourly ? copy.perHour : copy.perDay, { n: formatNumber(max) }),
    ),
    svg,
  );
  const figure = make("figure", "timeline");
  const caption = make("figcaption");
  const ends = make("span", "ends num");
  const end = from + (counts.length - 1) * step;
  const label = end - from < TIMES_UNDER ? formatWhen : formatDay;
  ends.append(make("span", "", label(from)), make("span", "", label(end)));
  const web = result.kind === "web";
  const words: string[] = [
    web
      ? hourly
        ? copy.requestsHours
        : copy.requestsDays
      : hourly
        ? copy.timelineHours
        : copy.timelineDays,
  ];
  if (result.restarts.length) words.push(copy.restartsLine);
  caption.append(ends, words.join(" "));
  figure.append(strip, caption);
  return figure;
}

/** One group's row. In the example the row is shorter: no message, no
 * dates. */
export function row(
  doc: Document,
  group: Group,
  result: Result,
  short = false,
): HTMLLIElement {
  const make = maker(doc);
  const li = make("li", "group");
  li.dataset["level"] = group.level;
  const { label, name } = groupName(group, result.kind);
  li.append(make("p", "count num", formatNumber(group.count)));
  const what = make("div", "what");
  // Under the verdict, in the example and in an answer alike.
  const title = make("h4", "name");
  // The space keeps the label and the name apart when read aloud.
  title.append(make("span", "level", label), " ");
  // A web path can hold placeholders: drawn as chips, like a message's.
  withChips(doc, title, name);
  what.append(title);
  const plain = groupPlain(group, result);
  if (plain) what.append(make("p", "plain", plain));
  if (!short && group.message)
    what.append(message(doc, group.message, "message"));
  li.append(what);
  if (!short && group.first !== null && group.last !== null) {
    const seen = make("p", "seen num");
    seen.append(
      make("span", "", fill(copy.first, { when: formatWhen(group.first) })),
      make("span", "", fill(copy.last, { when: formatWhen(group.last) })),
    );
    li.append(seen);
  }
  return li;
}

/** The levels a list starts with: everything but information. */
export const START_LEVELS: Level[] = ["critical", "error", "warning"];

/** The filters: level toggles, the source (or path), a search field. */
function filters(doc: Document, result: Result): HTMLFormElement {
  const make = maker(doc);
  const form = make("form", "filters");
  form.setAttribute("role", "search");
  const levels = make("fieldset", "levels");
  levels.append(make("legend", "", copy.levels));
  const names = result.kind === "web" ? copy.webLevelNames : copy.levelNames;
  for (const level of LEVELS) {
    const n = result.levels[level];
    // Web logs have no critical; a level with nothing in it has no toggle.
    if (!n) continue;
    const button = make("button", "level-toggle");
    button.type = "button";
    button.dataset["level"] = level;
    button.setAttribute("aria-pressed", String(START_LEVELS.includes(level)));
    button.append(`${names[level]} `, make("span", "num", formatNumber(n)));
    levels.append(button);
  }

  const sources = new Map<string, number>();
  for (const g of result.groups) {
    // The "other" group has no source or path of its own.
    if (g.other) continue;
    const key = result.kind === "web" ? (g.path ?? "") : canonical(g.source);
    sources.set(key, (sources.get(key) ?? 0) + g.count);
  }
  const label = make("label", "field");
  label.append(
    make("span", "", result.kind === "web" ? copy.path : copy.source),
  );
  const select = make("select");
  select.name = "source";
  const option = (text: string, value: string) => {
    const o = make("option", "", text);
    o.value = value;
    return o;
  };
  select.append(
    option(
      fill(result.kind === "web" ? copy.allPaths : copy.allSources, {
        n: formatNumber(sources.size),
      }),
      "",
    ),
  );
  const shown = new Map<string, string>();
  for (const g of result.groups) {
    if (g.other) continue;
    const key = result.kind === "web" ? (g.path ?? "") : canonical(g.source);
    if (!shown.has(key))
      shown.set(key, result.kind === "web" ? key : sourceName(g.source));
  }
  for (const [key] of [...sources].sort((a, b) => b[1] - a[1]).slice(0, 500)) {
    select.append(option(shown.get(key) ?? key, key));
  }
  label.append(select);

  const search = make("label", "field");
  search.append(make("span", "", copy.search));
  const input = make("input");
  input.type = "search";
  input.name = "q";
  input.placeholder = copy.searchPlaceholder;
  input.autocomplete = "off";
  search.append(input);

  const count = make("p", "shown num");
  count.setAttribute("aria-live", "polite");
  form.append(levels, label, search, count);
  return form;
}

/** The widest count of the groups the lists can show, as text: the lists
 * hold it, unseen, in their count column (logscope.css), so the main list
 * and the noise list line their counts and names up with each other. */
function widest(groups: Group[]): string {
  let max = 0;
  for (const g of groups) if (g.count > max) max = g.count;
  return formatNumber(max);
}

export interface Answer {
  nodes: HTMLElement[];
  /** What the status line says when a dropped log is read. */
  said: string;
}

/** The whole answer. The example has no filters, no information rows, no
 * list of clients and no line about the log staying here. In both, the
 * verdict is a heading under the pane's label. */
export function renderAnswer(
  doc: Document,
  result: Result,
  mode: "answer" | "example",
): Answer {
  const make = maker(doc);
  const example = mode === "example";
  const said = verdict(result);
  const nodes: HTMLElement[] = [
    // The verdict heads the answer, under the pane's label.
    make("h3", "verdict", said),
    make("p", "about", about(result)),
  ];
  const strip = timeline(doc, result);
  if (strip) nodes.push(strip);

  if (example) {
    const problems = result.groups.filter(
      (g) => g.level !== "information" && !isNoise(g, result.kind),
    );
    const noise = result.groups.filter((g) => isNoise(g, result.kind));
    const list = make("ol", "groups");
    list.dataset["widest"] = widest([...problems, ...noise]);
    list.append(...problems.map((g) => row(doc, g, result, true)));
    nodes.push(list);
    if (noise.length) {
      const noiseList = make("ol", "groups");
      noiseList.dataset["widest"] = list.dataset["widest"];
      noiseList.append(...noise.map((g) => row(doc, g, result, true)));
      nodes.push(make("p", "noise-head", copy.noise), noiseList);
    }
    return { nodes, said };
  }

  nodes.push(filters(doc, result));
  // Filled by main.ts as the filters change.
  const list = make("ol", "groups");
  list.dataset["list"] = "main";
  // Whatever the filters show, both lists keep one count column.
  list.dataset["widest"] = widest(result.groups);
  const none = make("p", "no-match", copy.noMatch);
  none.hidden = true;
  const more = make("button", "more");
  more.type = "button";
  more.hidden = true;
  const noiseHead = make("p", "noise-head", copy.noise);
  const noiseList = make("ol", "groups");
  noiseList.dataset["list"] = "noise";
  noiseList.dataset["widest"] = list.dataset["widest"];
  nodes.push(list, none, more, noiseHead, noiseList);

  if (result.kind === "web" && result.clients.length) {
    const section = make("section", "clients");
    section.setAttribute("aria-labelledby", "clients");
    const h4 = make("h4", "", copy.topClients);
    h4.id = "clients";
    const ol = make("ol", "leaders");
    for (const [address, n] of result.clients) {
      const li = make("li");
      li.append(
        make("span", "num", address),
        make("span", "num", fill(copy.requests, { n: formatNumber(n) })),
      );
      ol.append(li);
    }
    section.append(h4, ol, make("p", "", copy.clientsKept));
    nodes.push(section);
  }
  nodes.push(make("p", "kept", copy.kept));
  return { nodes, said };
}
