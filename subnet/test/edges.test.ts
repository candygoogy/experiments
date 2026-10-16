// Plans that once went wrong, each one kept as a test.
import { Window } from "happy-dom";
import { afterAll, describe, expect, test } from "vitest";
import { slide } from "../src/draw";
import { findings } from "../src/findings";
import { block, cidr, kindOf, maskPrefix, parseV4 } from "../src/ip";
import { block6, cidr6, kind6, parseV6 } from "../src/ip6";
import { parsePlan, type Entry } from "../src/plan";
import { MAX_FINDINGS, renderPlan, sentence, verdictOf } from "../src/render";
import { addSplit, splitEqual } from "../src/split";
import { strips } from "../src/strip";

const show = (e: Entry) =>
  `${e.name}|${e.net.v === 4 ? cidr(e.net.range) : cidr6(e.net.range)}|${e.typed ?? ""}`;

// The quiet 192.168.0.0/16 note is left out (findings.test has its own).
const run = (text: string) => {
  const { entries, bad } = parsePlan(text);
  const all = findings(entries, bad);
  const shown = all.filter((f) => f.rule !== "pool192");
  return {
    entries,
    rules: shown.map((f) => f.rule),
    text: shown.map((f) => sentence(f, entries)),
    verdict: verdictOf(all, entries),
  };
};

const window = new Window();
const doc = window.document as unknown as Document;
afterAll(() => window.happyDOM.close());
const render = (text: string, split = true) => {
  const { entries, bad } = parsePlan(text);
  const box = doc.createElement("div");
  const { nodes } = renderPlan(doc, entries, bad, "t", { split });
  box.append(...nodes);
  return box;
};

describe("a name can't be, or end in, an address", () => {
  test("an address and a dotted mask is a range, and says what it means", () => {
    const { entries, rules, verdict } = run("lan 192.168.12.0 255.255.255.0");
    expect(entries.map(show)).toEqual([
      "lan|192.168.12.0/24|192.168.12.0 255.255.255.0",
    ]);
    expect(rules).toEqual([]);
    expect(verdict).toBe("This plan works.");
    expect(render("lan 192.168.12.0 255.255.255.0").textContent).toContain(
      "192.168.12.0 255.255.255.0 means the range 192.168.12.0/24.",
    );
  });

  test("with no name, after a colon, or after a slash", () => {
    expect(
      parsePlan(
        "192.168.12.0 255.255.255.0\niot: 10.0.0.0 255.0.0.0\nx 10.1.0.0/255.255.0.0",
      ).entries.map(show),
    ).toEqual([
      "|192.168.12.0/24|192.168.12.0 255.255.255.0",
      "iot|10.0.0.0/8|10.0.0.0 255.0.0.0",
      "x|10.1.0.0/16|10.1.0.0/255.255.0.0",
    ]);
  });

  test("a mask with gaps is a bad line that says so", () => {
    const { entries, rules, text } = run("lan 192.168.12.0 255.0.255.0");
    expect(entries).toEqual([]);
    expect(rules).toEqual(["bad"]);
    expect(text).toEqual([
      "Line 1 isn’t a range: “lan 192.168.12.0 255.0.255.0”. 255.0.255.0 isn’t a mask: a mask is all its ones and then all its zeros, like 255.255.255.0.",
    ]);
  });

  test("masks: every prefix, and none with gaps", () => {
    for (let p = 0; p <= 32; p++) {
      const m = 2 ** 32 - 2 ** (32 - p);
      const text = [24, 16, 8, 0]
        .map((s) => Math.floor(m / 2 ** s) % 256)
        .join(".");
      expect(maskPrefix(text), text).toBe(p);
    }
    expect(maskPrefix("255.255.255.1")).toBeNull();
    expect(maskPrefix("0.0.0.255")).toBeNull();
  });

  test.each([
    "192.168.1.0 - 192.168.1.255",
    "192.168.1.0-192.168.1.255",
    "dhcp 192.168.1.100 - 192.168.1.200",
    "v6 fd00::1 - fd00::ff",
  ])("a first-to-last range is a bad line naming the problem: %s", (line) => {
    const { entries, rules, text } = run(line);
    expect(entries).toEqual([]);
    expect(rules).toEqual(["bad"]);
    expect(text[0]).toBe(
      `Line 1 is a range from one address to another: “${line}”. Write it as an address and a size instead, like 192.168.1.0/24.`,
    );
  });

  test.each([
    "lan 192.168.12.0 10.0.0.0/8",
    "192.168.1.5 10.0.0.0/8",
    "a 10.0.0.0/8 10.1.0.0/16",
    "fd00::1 fd00::/8",
  ])("a name that ends in an address is a bad line: %s", (line) => {
    expect(run(line).rules).toEqual(["bad"]);
  });

  test("names with dashes, digits and colons still read", () => {
    expect(
      parsePlan(
        "lab-1 10.0.0.0/24\nvlan 10: 10.0.10.0/24\ncafe-2 fd00::/48",
      ).entries.map(show),
    ).toEqual([
      "lab-1|10.0.0.0/24|",
      "vlan 10|10.0.10.0/24|",
      "cafe-2|fd00::/48|",
    ]);
  });

  test("lone CR line ends are line ends", () => {
    const { entries, bad } = parsePlan("a 10.0.0.0/24\rb 10.0.1.0/24\r\nc x");
    expect(entries.map((e) => `${e.name}@${e.line}`)).toEqual(["a@1", "b@2"]);
    expect(bad.map((b) => b.line)).toEqual([3]);
  });
});

describe("IPv6: what was typed, compared as numbers", () => {
  test.each([
    ["2001:0db8:0000::/32", ""],
    ["::1.2.3.4", ""],
    ["FD00::/8", ""],
    ["fd00::5/64", "fd00::5/64"],
  ])("%s", (typed, said) => {
    expect(parsePlan(`x ${typed}`).entries[0]?.typed ?? "").toBe(said);
  });
});

describe("kinds of space a plan isn't made of", () => {
  test.each([
    ["mc 224.0.0.0/24", "mc is multicast space"],
    ["lo 127.0.0.0/8", "lo is loopback space"],
    ["pub 8.8.8.0/24", "pub is a public range on the internet"],
    ["bench 198.18.0.0/15", "bench is kept for benchmarking (198.18.0.0/15)"],
    ["p 192.0.0.0/24", "p is in 192.0.0.0/24"],
    ["u ::/128", "u is ::"],
    ["m ::ffff:0:0/96", "m is IPv4-mapped space"],
    ["n 64:ff9b::/96", "n is the NAT64 prefix"],
  ])("%s: a finding, so the plan is worth a look", (line, start) => {
    const r = run(line);
    expect(r.rules).toEqual(["kind"]);
    expect(r.text[0]?.startsWith(start)).toBe(true);
    expect(r.verdict).toBe("This plan works, but one thing is worth a look.");
  });

  test("private, CGNAT, unique local and global IPv6 say nothing", () => {
    expect(
      run(
        "a 10.0.0.0/8\nb 100.64.0.0/10\nc fd00::/8\nd 192.168.1.0/24\nisp 2a02:1234:5600::/56",
      ).rules,
    ).toEqual([]);
    expect(run("isp 2a02:1234:5600::/56").verdict).toBe("This plan works.");
  });

  test("a range's parts don't repeat its kind", () => {
    expect(
      run("pub 8.8.8.0/24\n  pub-1 8.8.8.0/25\n  pub-2 8.8.8.128/25").rules,
    ).toEqual(["kind"]);
  });

  test("the new kinds, at their edges", () => {
    const k4 = (t: string) => {
      const [a = "", p = "32"] = t.split("/");
      return kindOf(block(parseV4(a) ?? 0, Number(p))).kind;
    };
    expect(k4("198.18.0.0/15")).toBe("benchmarking");
    expect(k4("198.19.255.255")).toBe("benchmarking");
    expect(k4("198.17.255.255")).toBe("public");
    expect(k4("198.20.0.0")).toBe("public");
    expect(k4("192.0.0.0/24")).toBe("protocol");
    expect(k4("192.0.0.255")).toBe("protocol");
    expect(k4("192.0.1.0")).toBe("public");
    expect(k4("192.0.2.0/24")).toBe("documentation");
    const k6 = (a: string, p: number) => kind6(block6(parseV6(a) ?? 0n, p));
    expect(k6("::", 128)).toBe("unspecified6");
    expect(k6("::1", 128)).toBe("loopback6");
    expect(k6("::2", 128)).toBe("compat6");
    expect(k6("::1:0:0", 128)).toBe("global");
    expect(k6("::ffff:0:0", 96)).toBe("mapped6");
    expect(k6("::ffff:10.0.0.1", 128)).toBe("mapped6");
    expect(k6("::fffe:0:0", 96)).toBe("global");
    expect(k6("64:ff9b::", 96)).toBe("nat64");
    expect(k6("64:ff9b::1:0:0", 96)).toBe("global");
  });
});

describe("Docker's bridge, said the right way, once", () => {
  test("a range that holds the bridge includes it", () => {
    expect(run("all 0.0.0.0/0").text).toContain(
      "all includes Docker’s default bridge (172.17.0.0/16). A Docker host routes that range to its own bridge, so the host and its containers can’t reach devices in that part of all.",
    );
  });

  test("a range in the bridge is inside it", () => {
    expect(run("c 172.17.5.0/24").text).toEqual([
      "c is inside Docker’s default bridge (172.17.0.0/16). A Docker host routes that range to its own bridge, so the host and its containers can’t reach devices in c.",
    ]);
  });

  test("the bridge split in four is one finding", () => {
    const plan = addSplit(
      "lab 172.17.0.0/16",
      1,
      "lab",
      (
        splitEqual(block(parseV4("172.17.0.0") ?? 0, 16), 4) as {
          parts: ReturnType<typeof block>[];
        }
      ).parts,
    );
    expect(run(plan).rules).toEqual(["bridge"]);
  });
});

describe("findings, grouped and capped", () => {
  test("500 identical lines: one finding, quickly", () => {
    const plan = Array.from({ length: 500 }, (_, i) => `n${i} 10.0.0.0/24`);
    const { entries, bad } = parsePlan(plan.join("\n"));
    const t0 = performance.now();
    const all = findings(entries, bad);
    const took = performance.now() - t0;
    expect(all.map((f) => sentence(f, entries))).toEqual([
      "n0 and 499 others are the same range, 10.0.0.0/24.",
    ]);
    expect(took).toBeLessThan(50);
  });

  test("500 nested lines stay quick", () => {
    const plan = Array.from(
      { length: 500 },
      (_, i) => `n${i} 10.0.0.0/${8 + (i % 25)}`,
    );
    const { entries, bad } = parsePlan(plan.join("\n"));
    const t0 = performance.now();
    const all = findings(entries, bad);
    expect(performance.now() - t0).toBeLessThan(50);
    // 25 ranges, each typed 20 times, nested in one chain: one finding.
    expect(all.filter((f) => f.rule === "sameRange")).toHaveLength(25);
    const inside = all.filter((f) => f.rule === "inside");
    expect(inside).toHaveLength(1);
    expect(inside.map((f) => sentence(f, entries))[0]).toBe(
      "24 ranges sit inside n0: n1, n2 inside n1, n3 inside n2, n4 inside n3, and 20 more. Fine if n0 is their parent block; a conflict if they’re separate networks.",
    );
  });

  test("names in any case: one finding, with the count", () => {
    expect(
      run("lab 10.0.0.0/24\nLab 10.0.1.0/24\nLAB 10.0.2.0/24").text,
    ).toEqual(["Three ranges are called lab."]);
  });

  test("the list shows 50, then says how many more", () => {
    const plan = Array.from(
      { length: 60 },
      (_, i) => `p${i} ${20 + i}.0.0.0/24`,
    );
    const items = render(plan.join("\n")).querySelectorAll(".findings li");
    expect(items).toHaveLength(MAX_FINDINGS + 1);
    expect(items[MAX_FINDINGS]?.textContent).toBe("And 10 more.");
  });
});

describe("the map", () => {
  test("strips whose blocks overlap are one, the inner range in its own lane", () => {
    for (const [plan, block] of [
      ["a 8.8.0.0/16\nb 8.8.8.0/24", "8.8.0.0/16"],
      ["a 10.0.0.0/7\nb 10.1.0.0/16", "10.0.0.0/7"],
      ["a 172.0.0.0/8\nb 172.16.0.0/12", "172.0.0.0/8"],
    ] as const) {
      const s = strips(parsePlan(plan).entries);
      expect(
        s.map((x) => cidr(x.block)),
        plan,
      ).toEqual([block]);
      expect(s[0]?.overlaps, plan).toEqual([]);
      expect(s[0]?.lanes, plan).toBe(2);
    }
  });

  test("public ranges share a strip within a /8, and only then", () => {
    const close = strips(parsePlan("a 8.8.8.0/24\nb 8.8.4.0/24").entries);
    expect(close.map((x) => cidr(x.block))).toEqual(["8.8.0.0/20"]);
    const far = strips(parsePlan("a 8.8.8.0/24\nb 9.9.9.0/24").entries);
    expect(far.map((x) => cidr(x.block))).toEqual(["8.8.8.0/24", "9.9.9.0/24"]);
    const many = Array.from(
      { length: 500 },
      (_, i) => `p${i} ${20 + (i >> 8)}.${i & 255}.0.0/24`,
    );
    expect(
      strips(parsePlan(many.join("\n")).entries).map((x) => cidr(x.block)),
    ).toEqual(["20.0.0.0/8", "21.0.0.0/8"]);
  });

  test("500 identical lines: one hatch per copy", () => {
    const plan = Array.from({ length: 500 }, (_, i) => `n${i} 10.0.0.0/24`);
    const [s] = strips(parsePlan(plan.join("\n")).entries);
    expect(s?.lanes).toBe(500);
    expect(s?.overlaps).toHaveLength(499);
  });

  test("at most 12 strips, then a line saying the rest are listed", () => {
    const plan = Array.from(
      { length: 20 },
      (_, i) => `p${i} ${20 + i}.0.0.0/24`,
    );
    const box = render(plan.join("\n"));
    expect(box.querySelectorAll(".track")).toHaveLength(12);
    expect(box.querySelector(".strip-more")?.textContent).toBe(
      "8 more ranges aren’t drawn; they’re all listed below.",
    );
  });

  test("the strip lines can be read out; only the drawing is hidden", () => {
    const box = render("home 192.168.1.0/24");
    expect(box.querySelector(".map")?.getAttribute("aria-hidden")).toBeNull();
    expect(box.querySelector(".strip-head")?.textContent).toBe(
      "192.168.0.0/16 Private Free: 192.168.128.0/17",
    );
    expect(box.querySelector(".track")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  test("a phone's strip is sized by its labels, at most 14", () => {
    const box = render("home 192.168.1.0/24\niot 192.168.20.0/24");
    // Two ranges, three free stretches around them.
    expect(box.querySelector<HTMLElement>(".track")?.dataset["items"]).toBe(
      "5",
    );
    const many = Array.from({ length: 30 }, (_, i) => `n${i} 10.${i}.0.0/24`);
    expect(
      render(many.join("\n")).querySelector<HTMLElement>(".track")?.dataset[
        "items"
      ],
    ).toBe("14");
  });
});

describe("names beside the map", () => {
  // Each label as [from, to] along the line, for the ones placed.
  const spans = (at: (number | null)[], half: number) =>
    at.flatMap((a) => (a === null ? [] : [[a - half, a + half] as const]));

  test("names that would run into each other slide apart, not off", () => {
    // A range and its four parts, as close as a phone draws them.
    const centres = [100, 103, 106, 110, 115];
    const at = slide(
      centres.map((centre) => ({ centre, half: 8 })),
      416,
      16,
    );
    const placed = spans(at, 8);
    expect(placed.length).toBeGreaterThanOrEqual(3);
    placed.forEach(([lo], i) => {
      const prev = placed[i - 1];
      if (prev) expect(lo).toBeGreaterThanOrEqual(prev[1] - 0.01);
    });
    at.forEach((a, i) => {
      if (a !== null)
        expect(Math.abs(a - (centres[i] ?? 0))).toBeLessThanOrEqual(16.01);
    });
  });

  test("names far apart stay where they are; the line's ends hold them", () => {
    expect(
      slide(
        [0, 50, 100].map((centre) => ({ centre, half: 8 })),
        100,
        16,
      ),
    ).toEqual([8, 50, 92]);
  });

  test("a crowded strip keeps as many as fit, quickly", () => {
    const items = Array.from({ length: 2000 }, (_, i) => ({
      centre: (i + 0.5) * (416 / 2000),
      half: 8,
    }));
    const t0 = performance.now();
    const placed = spans(slide(items, 416, 16), 8);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(placed.length).toBeGreaterThanOrEqual(26);
    for (const [lo, hi] of placed) {
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(416);
    }
  });
});

describe("rows", () => {
  test("a /31 and a /32 say no network or broadcast", () => {
    const box = render("p2p 10.0.0.0/31\nhost 10.0.0.9/32");
    expect(box.textContent).not.toContain("Network");
    expect(box.textContent).not.toContain("broadcast");
    expect(box.textContent).toContain(
      "p2p is a point-to-point link: two addresses, 10.0.0.0 and 10.0.0.1.",
    );
  });

  test("the numbers sit in a closed details, the plain line outside", () => {
    const row = render("home 192.168.1.0/24").querySelector(".ranges > li");
    const more = row?.querySelector("details.more");
    expect(more?.hasAttribute("open")).toBe(false);
    expect(more?.querySelector("summary")?.textContent).toBe("Mask and counts");
    expect(more?.textContent).toContain("Mask 255.255.255.0");
    expect(row?.querySelector(".says")?.closest("details")).toBeNull();
  });
});

describe("split keeps what the visitor wrote", () => {
  test("a blank line doesn't end the range's parts; comments stay", () => {
    const r = block(parseV4("10.0.0.0") ?? 0, 24);
    const { parts } = splitEqual(r, 2) as { parts: ReturnType<typeof block>[] };
    const plan =
      "home 10.0.0.0/24\n  # keep me\n  mine 10.0.0.0/25\n\n  late 10.0.0.128/25\nz 10.1.0.0/24";
    const next = addSplit(plan, 1, "home", parts);
    expect(next).toBe(
      "home 10.0.0.0/24\n  home-1 10.0.0.0/25\n  home-2 10.0.0.128/25\n  # keep me\n\nz 10.1.0.0/24",
    );
    expect(run(next).verdict).toBe("This plan works.");
    expect(next).not.toContain("late");
  });
});

describe("two ranges on one line, and old IPv6 space", () => {
  test.each([
    "lan 192.168.1.0/24, 192.168.2.0/24",
    "lan 192.168.1.0/24; 192.168.2.0/24",
    "192.168.1.0/24, 192.168.2.0/24",
  ])("%s is a bad line that says to use one per line", (line) => {
    const { entries, text } = run(line);
    expect(entries).toEqual([]);
    expect(text).toEqual([
      `Line 1 isn’t a range: “${line}”. Put one range on each line, with a name before it if you like.`,
    ]);
  });

  test("::/96 is IPv4-compatible space, and a finding", () => {
    const k = (a: string, p: number) => kind6(block6(parseV6(a) ?? 0n, p));
    expect(k("::", 96)).toBe("compat6");
    expect(k("::1.2.3.4", 128)).toBe("compat6");
    expect(k("::", 128)).toBe("unspecified6");
    expect(k("::1", 128)).toBe("loopback6");
    expect(k("::ffff:1.2.3.4", 128)).toBe("mapped6");
    expect(run("old ::/96").text[0]).toBe(
      "old is in ::/96, the old IPv4-compatible space: an outdated way of writing IPv4 addresses in IPv6, so it isn’t for a network.",
    );
  });
});

describe("split, again", () => {
  test("adding a second split replaces the first", () => {
    const r = block(parseV4("192.168.20.0") ?? 0, 24);
    const parts = (n: 2 | 4) =>
      (splitEqual(r, n) as { parts: ReturnType<typeof block>[] }).parts;
    const once = addSplit(
      "home 192.168.1.0/24\niot 192.168.20.0/24",
      2,
      "iot",
      parts(4),
    );
    const twice = addSplit(once, 2, "iot", parts(2));
    expect(twice).toBe(
      "home 192.168.1.0/24\niot 192.168.20.0/24\n  iot-1 192.168.20.0/25\n  iot-2 192.168.20.128/25",
    );
    expect(run(twice).verdict).toBe("This plan works.");
  });
});
