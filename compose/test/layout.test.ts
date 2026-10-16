import { describe, expect, test } from "vitest";
import { layout, order } from "../src/layout";
import { file, svc } from "./make";

const after = (name: string, ...deps: string[]) =>
  svc({
    name,
    dependsOn: deps.map((service) => ({
      service,
      condition: "started" as const,
    })),
  });
const names = (services: { name: string }[]) => services.map((s) => s.name);

describe("order", () => {
  test("what a service waits for comes first, otherwise the file's order", () => {
    expect(
      names(
        order([
          after("proxy", "app"),
          after("app", "db"),
          svc({ name: "db" }),
          svc({ name: "x" }),
        ]),
      ),
    ).toEqual(["db", "app", "proxy", "x"]);
  });

  test("a loop keeps the file's order, and ends", () => {
    expect(names(order([after("a", "b"), after("b", "a")]))).toEqual([
      "b",
      "a",
    ]);
  });

  test("waiting for a service that isn't there", () => {
    expect(names(order([after("a", "ghost")]))).toEqual(["a"]);
  });
});

describe("bands", () => {
  test("by first network, in order of first appearance", () => {
    const plan = layout(
      file(
        svc({ name: "web", networks: ["front", "back"] }),
        svc({ name: "db", networks: ["back"] }),
        svc({ name: "plain" }),
        svc({ name: "dns", networkMode: "host" }),
        svc({ name: "vpn" }),
        svc({ name: "torrent", networkMode: "service:vpn" }),
        svc({ name: "cut", networkMode: "none" }),
      ),
    );
    expect(plan.bands.map((b) => [b.kind, b.name, names(b.services)])).toEqual([
      ["named", "front", ["web"]],
      ["named", "back", ["db"]],
      ["named", "default", ["plain", "vpn", "torrent"]],
      ["host", null, ["dns"]],
      ["none", null, ["cut"]],
    ]);
  });

  test("a container: network mode joins nobody's band", () => {
    const plan = layout(file(svc({ name: "x", networkMode: "container:abc" })));
    expect(plan.bands.map((b) => b.kind)).toEqual(["named"]);
  });
});

describe("wires", () => {
  test("from the row waited for to the row that waits, rows counted through every band", () => {
    const plan = layout(
      file(svc({ name: "db", networks: ["back"] }), after("app", "db")),
    );
    // Bands: back [db], default [app].
    expect(plan.wires).toEqual([{ from: 0, to: 1, lane: 0, healthy: false }]);
    expect(plan.lanes).toBe(1);
  });

  test("wires that only touch at a row take different lanes", () => {
    const plan = layout(
      file(svc({ name: "a" }), after("b", "a"), after("c", "b")),
    );
    expect(plan.wires.map((w) => w.lane)).toEqual([0, 1]);
  });

  test("wires that don't meet share a lane", () => {
    const plan = layout(
      file(
        svc({ name: "a" }),
        after("b", "a"),
        svc({ name: "c" }),
        after("d", "c"),
      ),
    );
    expect(plan.wires.map((w) => w.lane)).toEqual([0, 0]);
    expect(plan.lanes).toBe(1);
  });

  test("no two services' wires share a stretch of one lane", () => {
    const services = [svc({ name: "s0" })];
    for (let i = 1; i < 40; i++) {
      services.push(after(`s${i}`, `s${(i * 7) % i}`, `s${Math.floor(i / 2)}`));
    }
    const plan = layout(file(...services));
    for (const a of plan.wires)
      for (const b of plan.wires) {
        // Wires that share a service may share its trunk, by design.
        if (a === b || a.lane !== b.lane || a.from === b.from || a.to === b.to)
          continue;
        const [a0, a1] = [Math.min(a.from, a.to), Math.max(a.from, a.to)];
        const [b0, b1] = [Math.min(b.from, b.to), Math.max(b.from, b.to)];
        expect(a1 < b0 || b1 < a0).toBe(true);
      }
  });

  test("a healthy wait is marked", () => {
    const plan = layout(
      file(
        svc({ name: "db" }),
        svc({
          name: "app",
          dependsOn: [{ service: "db", condition: "healthy" }],
        }),
      ),
    );
    expect(plan.wires[0]?.healthy).toBe(true);
  });
});
