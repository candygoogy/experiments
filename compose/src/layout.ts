// Where everything goes on the map: the services in order (each after what
// it waits for), grouped by network into bands, and a lane for each trunk
// of wires (the wires that share a service), so no two trunks share a
// stretch of the left margin.
import type { ComposeFile, Service } from "./model.ts";

export interface Band {
  // A network of the file's (or the default one), the host's own network,
  // or none at all.
  kind: "named" | "host" | "none";
  name: string | null;
  services: Service[];
}

export interface Wire {
  // Row indexes, counting down through every band.
  from: number;
  to: number;
  lane: number;
  healthy: boolean;
}

export interface MapLayout {
  bands: Band[];
  wires: Wire[];
  lanes: number;
}

// Dependencies first, otherwise in the file's order. Services caught in a
// loop keep the file's order.
export function order(services: Service[]): Service[] {
  const byName = new Map(services.map((s) => [s.name, s]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const out: Service[] = [];
  const visit = (s: Service) => {
    if (done.has(s.name) || visiting.has(s.name)) return;
    visiting.add(s.name);
    for (const d of s.dependsOn) {
      const dep = byName.get(d.service);
      if (dep) visit(dep);
    }
    visiting.delete(s.name);
    done.add(s.name);
    out.push(s);
  };
  for (const s of services) visit(s);
  return out;
}

type Place = Pick<Band, "kind" | "name">;

// The band a service sits in: its first network, the host's, none, or the
// band of the service whose network it shares.
function bandOf(s: Service, byName: Map<string, Service>, seen = 0): Place {
  const mode = s.networkMode;
  if (mode === "host") return { kind: "host", name: null };
  if (mode === "none") return { kind: "none", name: null };
  if (mode?.startsWith("service:") && seen < 8) {
    const other = byName.get(mode.slice("service:".length));
    if (other) return bandOf(other, byName, seen + 1);
  }
  return { kind: "named", name: s.networks[0] ?? "default" };
}

export function layout(file: ComposeFile): MapLayout {
  const byName = new Map(file.services.map((s) => [s.name, s]));
  const bands: Band[] = [];
  for (const s of order(file.services)) {
    const place = bandOf(s, byName);
    let band = bands.find(
      (b) => b.kind === place.kind && b.name === place.name,
    );
    if (!band) {
      band = { ...place, services: [] };
      bands.push(band);
    }
    band.services.push(s);
  }
  const rows = bands.flatMap((b) => b.services);
  const index = new Map(rows.map((s, i) => [s.name, i]));

  // Wires that share a service share a trunk: one lane past every row
  // they join, with a tap into each. A wire joins the bigger bundle at
  // either end: everything that waits for db runs down db's trunk, and
  // everything a gateway waits for runs into the gateway's. So each trunk
  // has one service at its hub, and its taps can't be misread. Each trunk
  // takes the innermost lane that's free over its whole span; trunks that
  // only touch at a row still take different lanes, so a chain never reads
  // as one long wire.
  const spans = rows.flatMap((s, to) =>
    s.dependsOn.flatMap((d) => {
      const from = index.get(d.service);
      return from === undefined || from === to
        ? []
        : [{ from, to, healthy: d.condition === "healthy" }];
    }),
  );
  const out = new Map<number, number>();
  const into = new Map<number, number>();
  for (const w of spans) {
    out.set(w.from, (out.get(w.from) ?? 0) + 1);
    into.set(w.to, (into.get(w.to) ?? 0) + 1);
  }
  // A trunk's key: its hub's row, negative when the hub is the one waiting.
  const hub = (w: { from: number; to: number }) =>
    (out.get(w.from) ?? 0) >= (into.get(w.to) ?? 0) ? w.from : -1 - w.to;
  const trunks = new Map<number, { top: number; bottom: number }>();
  for (const w of spans) {
    const key = hub(w);
    const t = trunks.get(key) ?? { top: w.from, bottom: w.from };
    t.top = Math.min(t.top, w.from, w.to);
    t.bottom = Math.max(t.bottom, w.from, w.to);
    trunks.set(key, t);
  }
  const laneOf = new Map<number, number>();
  const laneEnds: number[] = [];
  for (const [key, t] of [...trunks].sort(
    (a, b) => a[1].top - b[1].top || a[1].bottom - b[1].bottom,
  )) {
    let lane = laneEnds.findIndex((end) => end < t.top);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = t.bottom;
    laneOf.set(key, lane);
  }
  const wires = spans.map((w) => ({ ...w, lane: laneOf.get(hub(w)) ?? 0 }));
  return { bands, wires, lanes: laneEnds.length };
}
