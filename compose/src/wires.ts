// The map's wires, drawn over its rows in the browser once they have a
// size: the dependency wires down the left, the open ports' wires out to
// the network's edge on the right. It needs nothing but the drawn map, so
// the page can draw the example's wires without loading the rest.

export const SVG = "http://www.w3.org/2000/svg";
const LANE = 12;
// The wires' margin is this many lanes wide at most; more lanes are packed
// closer into the same width.
export const MAX_LANES = 8;
const R = 5;

/** Draws the wires for where the rows sit now. Call it once the map is on
 * the page, and again when its size changes. */
export function drawWires(root: HTMLElement): void {
  const svg = root.querySelector("svg.wires");
  if (!svg) return;
  const box = root.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
  svg.setAttribute("width", String(box.width));
  svg.setAttribute("height", String(box.height));
  const dots = [...root.querySelectorAll<HTMLElement>(".svc .dot")].map((d) => {
    const r = d.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 - box.left,
      y: r.top + r.height / 2 - box.top,
      r: r.width / 2,
    };
  });
  const wires = (root.dataset["wires"] ?? "")
    .split(" ")
    .map((w) => w.split(",").map(Number));
  const lanes = Math.max(0, ...wires.map(([, , lane = 0]) => lane + 1));
  const step = lanes > MAX_LANES ? (MAX_LANES * LANE) / lanes : LANE;
  const paths: string[] = [];
  for (const [from = -1, to = -1, lane = 0] of wires) {
    const a = dots[from];
    const b = dots[to];
    if (!a || !b) continue;
    const x = a.x - a.r - 8 - lane * step;
    const down = b.y > a.y ? 1 : -1;
    // Out of the dot waited for, along its lane, and in to the dot that
    // waits, stopping just short of it.
    paths.push(
      `M${a.x - a.r} ${a.y}H${x + R}Q${x} ${a.y} ${x} ${a.y + down * R}` +
        `V${b.y - down * R}Q${x} ${b.y} ${x + R} ${b.y}H${b.x - b.r - 3}`,
    );
  }
  // The open ports' wires, out to the network's edge on the right (not on
  // phones, where the edge isn't shown).
  const edge = root.querySelector<HTMLElement>(".edge");
  const edgeShown = !!edge && edge.offsetParent !== null;
  const edgeX = box.width - 0.5;
  let lowest = 0;
  if (edgeShown) {
    for (const ports of root.querySelectorAll<HTMLElement>(".svc .ports")) {
      const pills = ports.querySelectorAll<HTMLElement>(".port:not(.local)");
      const last = pills[pills.length - 1];
      if (!last) continue;
      const r = last.getBoundingClientRect();
      const y = r.top + r.height / 2 - box.top;
      if (r.right - box.left < edgeX - 4) {
        paths.push(`M${r.right - box.left} ${y}H${edgeX}`);
      }
      lowest = Math.max(lowest, y);
    }
  }
  // Down from under the edge's hollow dot to the lowest open port.
  let edgePath = "";
  if (edge && edgeShown && lowest) {
    const e = edge.getBoundingClientRect();
    edgePath = `M${edgeX} ${e.top + e.height / 2 + 7 - box.top}V${lowest}`;
  }
  const add = (d: string, cls: string) => {
    if (!d) return [];
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", d);
    p.setAttribute("class", cls);
    return [p];
  };
  svg.replaceChildren(
    ...add(paths.join(""), "wire"),
    ...add(edgePath, "edge-line"),
  );
}
