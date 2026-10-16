// The map: each service a row in its network's band, its storage and what
// it waits for under it, its published ports on the right. The rows are
// the text (a screen reader reads them as a list, each band a heading);
// the wires are drawn over them in one SVG, which is decoration only.
// Rendering takes a document, so the example can be drawn when the page is
// built; the wires are drawn in the browser, where the rows have a size
// (wires.ts).
import { MAP } from "./copy.ts";
import { socketPath } from "./findings.ts";
import { layout } from "./layout.ts";
import type { ComposeFile, PortMapping, Service } from "./model.ts";
import { open } from "./ports.ts";
import { MAX_LANES, SVG } from "./wires.ts";

const proto = (p: PortMapping) =>
  p.protocol === "tcp" ? "" : `/${p.protocol}`;
const portText = (p: PortMapping) =>
  p.published === null
    ? `${MAP.random} → ${p.target}${proto(p)}`
    : `${p.published}${proto(p)}`;

export function renderMap(
  doc: Document,
  file: ComposeFile,
  id: string,
): HTMLElement {
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
  const hidden = (text: string) => el("span", "visually-hidden", text);
  const quiet = <T extends Element>(node: T) => {
    node.setAttribute("aria-hidden", "true");
    return node;
  };

  const row = (s: Service) => {
    const li = el("li", "svc");
    const line = el("div", "line");
    const who = el("span", "who");
    who.append(el("span", "name", s.name));
    const image = s.image ?? (s.build ? MAP.built : MAP.noImage);
    who.append(hidden(", "), el("span", "image", image));
    const tags = [
      ...(s.privileged ? [MAP.privileged] : []),
      ...(socketPath(s) ? [MAP.socket] : []),
      ...(s.profiles.length ? [MAP.profile(s.profiles)] : []),
    ];
    for (const tag of tags) who.append(hidden(", "), el("span", "tag", tag));
    line.append(quiet(el("span", "dot")), who);
    if (s.ports.length) {
      const ports = el("span", "ports");
      s.ports.forEach((p, i) => {
        const local = !open(p);
        const pill = el("span", local ? "port local" : "port");
        // Read as a list: "web, nginx, open to … 8080, open to … 443".
        if (i > 0) ports.append(hidden(", "));
        if (p.published === null) {
          // No host port written: Docker picks one at random.
          pill.append(
            hidden(MAP.randomPort(local, p.target, p.protocol)),
            quiet(el("span", "", portText(p))),
          );
        } else {
          pill.append(
            hidden(local ? MAP.localPrefix : MAP.openPrefix),
            portText(p),
          );
        }
        // "local" is what the screen reader's prefix already says.
        if (local) pill.append(" ", quiet(el("span", "where", MAP.local)));
        ports.append(pill);
      });
      line.append(quiet(el("span", "lead")), hidden(", "), ports);
    }
    li.append(line);

    const subs = el("ul", "subs");
    for (const m of s.mounts) {
      const sub = el("li", "mount");
      sub.append(el("span", "kind", MAP.mountKind(m)), " ", MAP.mount(m));
      subs.append(sub);
    }
    if (s.dependsOn.length) {
      subs.append(el("li", "after", MAP.after(s.dependsOn)));
    }
    if (s.networks.length > 1) {
      subs.append(el("li", "also", MAP.alsoOn(s.networks.slice(1))));
    }
    if (subs.children.length) li.append(subs);
    return li;
  };

  const plan = layout(file);
  const root = el("div", "map");
  // The wires' margin, set by CSS (the page's CSP allows no style
  // attributes in its HTML): one lane per wire, up to eight lanes' width.
  // More lanes than that are packed closer into the same width.
  root.dataset["lanes"] = String(Math.min(plan.lanes, MAX_LANES));
  // What the wires join, for drawWires: from, to and lane, per wire.
  root.dataset["wires"] = plan.wires
    .map((w) => `${w.from},${w.to},${w.lane}`)
    .join(" ");
  if (file.services.some((s) => s.ports.some(open))) {
    root.append(quiet(el("p", "edge", MAP.edge)));
  }
  const bands = el("div", "bands");
  plan.bands.forEach((b, i) => {
    const band = el("section", "band");
    const heading = el("h4", "net", MAP.band(b));
    heading.id = `${id}-net-${i}`;
    band.setAttribute("aria-labelledby", heading.id);
    const rows = el("ol", "rows");
    for (const s of b.services) rows.append(row(s));
    band.append(heading, rows);
    bands.append(band);
  });
  root.append(bands);
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("class", "wires");
  svg.setAttribute("aria-hidden", "true");
  root.append(svg);
  return root;
}
