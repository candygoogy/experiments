import { describe, expect, test } from "vitest";
import {
  block,
  cidr,
  contains,
  end,
  hosts,
  kindOf,
  mask,
  overlap,
  parseV4,
  supernet,
  v4,
  wildcard,
} from "../src/ip";
import { largestFree } from "../src/strip";

const R = (text: string) => {
  const [a = "", p = "32"] = text.split("/");
  const n = parseV4(a);
  if (n === null) throw new Error(text);
  return block(n, Number(p));
};

describe("addresses", () => {
  test.each([
    ["0.0.0.0", 0],
    ["255.255.255.255", 2 ** 32 - 1],
    ["192.168.1.10", 3232235786],
    ["10.0.0.1", 167772161],
  ])("%s", (text, n) => {
    expect(parseV4(text)).toBe(n);
    expect(v4(n)).toBe(text);
  });

  test.each([
    "256.0.0.1",
    "1.2.3",
    "1.2.3.4.5",
    "01.2.3.4",
    "a.b.c.d",
    "1.2.3.",
    "",
    " 1.2.3.4",
  ])("rejects %j", (text) => {
    expect(parseV4(text)).toBeNull();
  });
});

describe("every prefix length, 0 to 32", () => {
  test.each(Array.from({ length: 33 }, (_, p) => p))("/%i", (p) => {
    const r = R(`192.168.1.77/${p}`);
    expect(r.size).toBe(2 ** (32 - p));
    expect(r.start % r.size).toBe(0);
    expect(r.start).toBeLessThanOrEqual(parseV4("192.168.1.77") ?? 0);
    expect(end(r)).toBeGreaterThanOrEqual(parseV4("192.168.1.77") ?? 0);
    // Mask and wildcard add up to all ones, and agree with the prefix.
    const m = parseV4(mask(p)) ?? -1;
    const w = parseV4(wildcard(p)) ?? -1;
    expect(m + w).toBe(2 ** 32 - 1);
    expect(w).toBe(r.size - 1);
    const h = hosts(r);
    if (p <= 30) {
      expect(h).toEqual({
        first: r.start + 1,
        last: end(r) - 1,
        count: r.size - 2,
      });
    }
  });

  test("the familiar ones", () => {
    expect([mask(24), wildcard(24)]).toEqual(["255.255.255.0", "0.0.0.255"]);
    expect([mask(0), wildcard(0)]).toEqual(["0.0.0.0", "255.255.255.255"]);
    expect([mask(32), wildcard(32)]).toEqual(["255.255.255.255", "0.0.0.0"]);
    expect(cidr(R("192.168.1.5/24"))).toBe("192.168.1.0/24");
  });

  test("/31 is a point-to-point pair, /32 one address", () => {
    expect(hosts(R("10.0.0.4/31"))).toEqual({
      first: parseV4("10.0.0.4"),
      last: parseV4("10.0.0.5"),
      count: 2,
    });
    expect(hosts(R("10.0.0.9/32"))).toEqual({
      first: parseV4("10.0.0.9"),
      last: parseV4("10.0.0.9"),
      count: 1,
    });
  });
});

describe("kinds of address space, at their edges", () => {
  test.each([
    ["10.0.0.0/8", "private"],
    ["10.255.255.255/32", "private"],
    ["11.0.0.0/32", "public"],
    ["172.16.0.0/12", "private"],
    ["172.15.255.255/32", "public"],
    ["172.32.0.0/32", "public"],
    ["192.168.0.0/16", "private"],
    ["192.169.0.0/32", "public"],
    ["100.64.0.0/10", "cgnat"],
    ["100.63.255.255/32", "public"],
    ["100.128.0.0/32", "public"],
    ["169.254.0.0/16", "linkLocal"],
    ["127.0.0.1/32", "loopback"],
    ["224.0.0.0/4", "multicast"],
    ["239.255.255.255/32", "multicast"],
    ["240.0.0.0/4", "reserved"],
    ["192.0.2.0/24", "documentation"],
    ["198.51.100.0/24", "documentation"],
    ["203.0.113.0/24", "documentation"],
    ["0.0.0.0/8", "thisNetwork"],
    ["8.8.8.0/24", "public"],
    ["192.168.0.0/15", "mixed"],
    ["0.0.0.0/0", "mixed"],
  ])("%s is %s", (range, kind) => {
    expect(kindOf(R(range)).kind).toBe(kind);
  });
});

describe("overlap and containment", () => {
  test("partial, inside, touching, apart", () => {
    expect(overlap(R("192.168.1.0/24"), R("192.168.1.128/25"))).toEqual([
      parseV4("192.168.1.128"),
      parseV4("192.168.1.255"),
    ]);
    expect(contains(R("192.168.1.0/24"), R("192.168.1.128/25"))).toBe(true);
    expect(contains(R("192.168.1.128/25"), R("192.168.1.0/24"))).toBe(false);
    expect(overlap(R("192.168.1.0/25"), R("192.168.1.128/25"))).toBeNull();
    expect(overlap(R("10.0.0.0/8"), R("192.168.0.0/16"))).toBeNull();
  });
});

describe("blocks", () => {
  test("the smallest block holding them all", () => {
    expect(cidr(supernet([R("192.168.1.0/24"), R("192.168.20.0/24")]))).toBe(
      "192.168.0.0/19",
    );
    expect(cidr(supernet([R("192.168.1.0/24")]))).toBe("192.168.1.0/24");
    expect(cidr(supernet([R("10.0.0.0/8"), R("192.168.0.0/16")]))).toBe(
      "0.0.0.0/0",
    );
  });

  test("the largest aligned free block in a stretch", () => {
    const n = (t: string) => parseV4(t) ?? -1;
    expect(
      cidr(
        largestFree(n("192.168.2.0"), n("192.168.19.255")) ?? R("0.0.0.0/32"),
      ),
    ).toBe("192.168.8.0/21");
    expect(
      cidr(
        largestFree(n("192.168.41.0"), n("192.168.255.255")) ?? R("0.0.0.0/32"),
      ),
    ).toBe("192.168.128.0/17");
    expect(
      cidr(largestFree(n("10.0.0.1"), n("10.0.0.1")) ?? R("0.0.0.0/32")),
    ).toBe("10.0.0.1/32");
    expect(largestFree(5, 4)).toBeNull();
  });
});
