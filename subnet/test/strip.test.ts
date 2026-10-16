import { describe, expect, test } from "vitest";
import { cidr, parseV4 } from "../src/ip";
import { parsePlan } from "../src/plan";
import { alignedBlocks, strips } from "../src/strip";

const plan = (text: string) => strips(parsePlan(text).entries);

describe("strips", () => {
  test("one per block, in address order; IPv6 gets none", () => {
    const s = plan(
      "home 192.168.1.0/24\nlab 172.17.0.0/16\nvpn 100.64.0.0/24\nwork 10.1.0.0/16\npub 8.8.8.0/24\nv6 2001:db8::/48",
    );
    expect(s.map((x) => cidr(x.block))).toEqual([
      "8.8.8.0/24",
      "10.0.0.0/8",
      "100.64.0.0/10",
      "172.16.0.0/12",
      "192.168.0.0/16",
    ]);
  });

  test("positions run from 0 to 1, in order; small ranges get the floor", () => {
    const [s] = plan("a 192.168.1.0/24\nb 192.168.40.0/27");
    if (!s) throw new Error("no strip");
    const [a, b] = s.segments;
    expect(a && b).toBeTruthy();
    if (!a || !b) return;
    expect(0).toBeLessThan(a.x0);
    expect(a.x0).toBeLessThan(a.x1);
    expect(a.x1).toBeLessThan(b.x0);
    expect(b.x1).toBeLessThan(1);
    // A /24 and a /27 in a /16 are both far under the floor: drawn alike,
    // and the strip says it isn't to scale.
    expect(a.x1 - a.x0).toBeCloseTo(0.06, 10);
    expect(b.x1 - b.x0).toBeCloseTo(0.06, 10);
    expect(s.scaled).toBe(true);
    expect(s.lanes).toBe(1);
  });

  test("widths follow each range's share: lab and docker-custom are 1/16 each", () => {
    const [s] = plan("lab 172.17.0.0/16\ndocker-custom 172.18.0.0/16");
    const [lab, custom] = s?.segments ?? [];
    if (!s || !lab || !custom) throw new Error("segments");
    expect(lab.x1 - lab.x0).toBeCloseTo(1 / 16, 10);
    expect(custom.x1 - custom.x0).toBeCloseTo(1 / 16, 10);
    // The free /16 before them is as wide as either, not twice.
    expect(lab.x0).toBeCloseTo(1 / 16, 10);
    expect(s.scaled).toBe(false);
  });

  test("inside a covered stretch, addresses are spread evenly", () => {
    const [s] = plan(
      "home 192.168.1.0/24\n  a 192.168.1.0/25\n  b 192.168.1.128/25",
    );
    const [home, a, b] = s?.segments ?? [];
    if (!home || !a || !b) throw new Error("segments");
    expect(a.x1).toBeCloseTo((home.x0 + home.x1) / 2, 10);
    expect(b.x0).toBeCloseTo(a.x1, 10);
    expect([home.lane, a.lane, b.lane]).toEqual([0, 1, 1]);
    // A range's own parts aren't a clash.
    expect(s?.overlaps).toEqual([]);
  });

  test("a range inside another takes the lane under it, drawn, not hatched", () => {
    const [s] = plan("wide 10.0.0.0/8\np2p 10.0.0.0/31\nloopback 10.0.0.1/32");
    const [wide, p2p, loopback] = s?.segments ?? [];
    if (!s || !wide || !p2p || !loopback) throw new Error("segments");
    expect([wide.lane, p2p.lane, loopback.lane]).toEqual([0, 1, 2]);
    expect(s.overlaps).toEqual([]);
    expect(s.scaled).toBe(true);
    // Each address of the /31 gets the floor: loopback is p2p's second
    // half, wide enough to see.
    expect(p2p.x1 - p2p.x0).toBeCloseTo(0.12, 10);
    expect(loopback.x0).toBeCloseTo(0.06, 10);
    expect(loopback.x1).toBeCloseTo(p2p.x1, 10);
    expect(wide.x0).toBe(0);
    expect(wide.x1).toBe(1);
  });

  test("many stretches: the floors share at most half the strip", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `n${i} 10.${i}.0.0/24`);
    const [s] = plan(lines.join("\n"));
    const segs = s?.segments ?? [];
    expect(segs).toHaveLength(200);
    segs.forEach((g, i) => {
      expect(g.x1).toBeGreaterThan(g.x0);
      expect(g.x0).toBeGreaterThanOrEqual(segs[i - 1]?.x1 ?? 0);
    });
    expect(segs.at(-1)?.x1).toBeLessThan(1);
    const drawn = segs.reduce((sum, g) => sum + g.x1 - g.x0, 0);
    expect(drawn).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  test("the same range twice is hatched across the lanes it takes", () => {
    const [s] = plan("home 192.168.1.0/24\ncopy 192.168.1.0/24");
    expect(s?.lanes).toBe(2);
    expect(s?.overlaps).toHaveLength(1);
    expect(s?.overlaps[0]?.lanes).toEqual([0, 1]);
    const [inside] = plan("home 192.168.1.0/24\ncameras 192.168.1.128/25");
    expect(inside?.lanes).toBe(2);
    expect(inside?.overlaps).toEqual([]);
  });

  test("free stretches, each with the largest block that fits", () => {
    const [s] = plan("home 192.168.1.0/24\nguest 192.168.40.0/27");
    expect(s?.gaps.map((g) => cidr(g.free))).toEqual([
      "192.168.0.0/24",
      "192.168.16.0/20",
      "192.168.128.0/17",
    ]);
  });

  test("a free stretch is the aligned blocks it's made of", () => {
    const blocks = (text: string) =>
      plan(text)[0]?.gaps.map((g) => g.blocks.map(cidr));
    // After docker-custom: 172.19.0.0 to 172.31.255.255 isn't a /13.
    expect(blocks("lab 172.17.0.0/16\ndocker-custom 172.18.0.0/16")).toEqual([
      ["172.16.0.0/16"],
      ["172.19.0.0/16", "172.20.0.0/14", "172.24.0.0/13"],
    ]);
    // After home: 192.168.2.0 onward isn't a /17.
    expect(blocks("home 192.168.1.0/24")).toEqual([
      ["192.168.0.0/24"],
      [
        "192.168.2.0/23",
        "192.168.4.0/22",
        "192.168.8.0/21",
        "192.168.16.0/20",
        "192.168.32.0/19",
        "192.168.64.0/18",
        "192.168.128.0/17",
      ],
    ]);
    // Before a misaligned range: 192.168.2.0 to 192.168.4.255 is a /23
    // and a /24, not a /23.
    expect(blocks("home 192.168.1.0/24\nshop 192.168.5.10/24")?.[1]).toEqual([
      "192.168.2.0/23",
      "192.168.4.0/24",
    ]);
  });

  test("aligned blocks: every one aligned, together exactly the stretch", () => {
    const n = (a: string) => parseV4(a) ?? -1;
    expect(alignedBlocks(n("10.0.0.1"), n("10.0.0.1")).map(cidr)).toEqual([
      "10.0.0.1/32",
    ]);
    expect(alignedBlocks(0, 2 ** 32 - 1).map(cidr)).toEqual(["0.0.0.0/0"]);
    for (const [lo, hi] of [
      [n("10.0.0.3"), n("10.0.1.200")],
      [n("192.168.2.0"), n("192.168.255.255")],
      [1, 2 ** 32 - 2],
    ] as const) {
      const bs = alignedBlocks(lo, hi);
      let at = lo;
      for (const b of bs) {
        expect(b.start).toBe(at);
        expect(b.start % b.size).toBe(0);
        at += b.size;
      }
      expect(at - 1).toBe(hi);
    }
  });

  test("Docker's ranges are marked in the 172.16/12 strip only", () => {
    const s = plan("lab 172.20.0.0/16\nhome 192.168.1.0/24");
    expect(s.map((x) => x.docker !== null)).toEqual([true, false]);
    const docker = s[0]?.docker;
    expect(docker && docker.x0 < docker.x1).toBe(true);
  });

  test("a public range alone is its own strip", () => {
    const [s] = plan("pub 8.8.8.0/24");
    expect(s && cidr(s.block)).toBe("8.8.8.0/24");
    expect(s?.gaps).toEqual([]);
    expect(s?.scaled).toBe(false);
  });
});
