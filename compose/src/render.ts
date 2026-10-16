// A file's answer, verdict first: the verdict, how the file was read (what
// it merges, what it doesn't follow), the map, then each finding as a
// sentence that names its services. The
// same code draws the example (when the page is built) and a visitor's
// file (in the browser).
import { COPY, say, verdict } from "./copy.ts";
import { findings } from "./findings.ts";
import { renderMap } from "./map.ts";
import type { ComposeFile } from "./model.ts";

export interface Answer {
  nodes: HTMLElement[];
  verdict: string;
}

// The names Docker Compose looks for, and the override it merges into each.
const MAIN = /^((?:docker-)?compose)\.(ya?ml)$/i;

/** `source`: the name of the one file dropped, when there was one. */
export function renderAnswer(
  doc: Document,
  file: ComposeFile,
  id: string,
  source: string | null = null,
): Answer {
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
  const all = findings(file);
  const line = verdict(all);
  // The verdict is a heading under the pane's label; the map's networks
  // and the findings are headed under it.
  const nodes: HTMLElement[] = [el("h3", "verdict", line)];
  const extended = file.services.filter((s) => s.extends).map((s) => s.name);
  if (file.parts.length > 1) {
    nodes.push(el("p", "note", COPY.merged(file.parts)));
  }
  // Every service only adds to one defined elsewhere.
  const overrideOnly = file.services.every(
    (s) => s.image === null && !s.build && !s.extends,
  );
  if (overrideOnly) nodes.push(el("p", "note", COPY.overrideOnly));
  const main = source === null ? null : MAIN.exec(source);
  if (main && !overrideOnly && file.parts.length === 1) {
    nodes.push(
      el(
        "p",
        "note",
        COPY.overrideHint(`${main[1] ?? ""}.override.${main[2] ?? ""}`),
      ),
    );
  }
  if (file.include) nodes.push(el("p", "note", COPY.include));
  if (extended.length) nodes.push(el("p", "note", COPY.extends(extended)));
  nodes.push(renderMap(doc, file, id));
  if (all.length) {
    const section = el("section", "findings");
    const heading = el("h4", "visually-hidden", COPY.findings);
    heading.id = `${id}-findings`;
    section.setAttribute("aria-labelledby", heading.id);
    const list = el("ul");
    for (const f of all) {
      const li = el("li");
      for (const part of say(f)) {
        li.append(typeof part === "string" ? part : el("b", "", part.name));
      }
      list.append(li);
    }
    section.append(heading, list);
    nodes.push(section);
  }
  return { nodes, verdict: line };
}
