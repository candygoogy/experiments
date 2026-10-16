// A domain's answer, verdict first: one line on the whole, then each check
// as a row (its name and level, the sentence that says why, the details).
// It takes a document, so the example can be drawn when the page is built.
import { VERDICT, verdictUnchecked } from "./copy.ts";
import type { Report } from "./model.ts";
import { rows } from "./rows.ts";
import { overall, unchecked } from "./verdict.ts";

export function renderReport(
  doc: Document,
  r: Report,
): { nodes: HTMLElement[]; verdict: string } {
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
  const o = overall(r);
  const verdict =
    o === "unchecked" ? verdictUnchecked(unchecked(r)) : VERDICT[o];
  const list = el("ol", "checks");
  for (const row of rows(r)) {
    const li = el("li", `check is-${row.level}`);
    const head = el("div", "head");
    head.append(el("h4", "name", row.name));
    if (row.word) head.append(el("span", "level", row.word));
    const body = el("div", "body");
    body.append(el("p", "says", row.says));
    if (row.details.length) {
      const details = el("ul", "details");
      for (const d of row.details) details.append(el("li", "", d));
      body.append(details);
    }
    li.append(head, body);
    list.append(li);
  }
  // The verdict is a heading under the pane's label, each check under it.
  return { nodes: [el("h3", "verdict", verdict), list], verdict };
}
