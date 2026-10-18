// One photo's row, drawn the same way for a dropped photo (main.ts) and
// for the example, which is drawn when the page is built (example-html.ts):
// what it gives away first, then the picture with its name and size.
import { copy, fill, plural } from "./copy.ts";
import type { Detail } from "./summary.ts";

export const make = <K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text?: string,
) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** "22 bytes", "6.3 KB", "4.1 MB", never split across lines. */
export function sizeText(bytes: number): string {
  const n = (value: number) => value.toFixed(1);
  const text =
    bytes < 1024
      ? plural(copy.bytes, { n: bytes })
      : bytes < 1024 * 1024
        ? fill(copy.kb, { n: n(bytes / 1024) })
        : fill(copy.mb, { n: n(bytes / 1024 / 1024) });
  return text.replace(" ", "\u00a0");
}

/** "Show everything" (the tools' one disclosure, shared/disclosure.css):
 * each block's fields under its name. The label changes to "Hide" when
 * it's open, in CSS, so it works before any script has run. */
export function everything(doc: Document, all: Detail[]): HTMLDetailsElement {
  const box = make(doc, "details", "all disclosure");
  const label = make(doc, "summary", "");
  label.append(
    make(doc, "span", "when-closed", copy.showAll),
    make(doc, "span", "when-open", copy.hide),
  );
  box.append(label);
  for (const { block, rows } of all) {
    const list = make(doc, "dl", "leaders");
    for (const [key, value] of rows) {
      const row = make(doc, "div", "");
      row.append(make(doc, "dt", "", key), make(doc, "dd", "", value));
      list.append(row);
    }
    box.append(make(doc, "p", "block", copy.blocks[block]), list);
  }
  return box;
}

export interface RowParts {
  name: string;
  size: number;
  /** The picture, or the reason there's none; null for a non-photo. */
  picture: Element | null;
  lines: string[];
  /** The first line is the photo's verdict, a heading: under the pane's
   * label (h3), or, among several photos, under what they say together
   * (h4). */
  lead: "h3" | "h4";
  details: Detail[];
}

export function photoRow(doc: Document, parts: RowParts): HTMLLIElement {
  const row = make(doc, "li", "photo");
  const what = make(doc, "div", "what");
  parts.lines.forEach((line, i) =>
    what.append(make(doc, i ? "p" : parts.lead, i ? "line" : "lead", line)),
  );
  if (parts.details.length) what.append(everything(doc, parts.details));
  const who = make(doc, "div", "who");
  if (parts.picture) who.append(parts.picture);
  const name = make(doc, "p", "file", parts.name);
  name.append(make(doc, "span", "num", sizeText(parts.size)));
  who.append(name);
  // What it gives away first, then the picture it's about: the order it
  // reads in, and the order it's seen in at every width (photo.css).
  row.append(what, who);
  return row;
}

/** In place of a picture the browser can't draw: an empty frame the size
 * of a thumbnail, and the reason under it. */
export function noPreview(doc: Document): HTMLElement {
  const box = make(doc, "div", "no-preview");
  const frame = make(doc, "span", "thumb thumb-none");
  frame.setAttribute("aria-hidden", "true");
  box.append(frame, make(doc, "p", "heic", copy.heic));
  return box;
}
