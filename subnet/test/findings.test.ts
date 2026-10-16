import { describe, expect, test } from "vitest";
import { findings } from "../src/findings";
import { parsePlan } from "../src/plan";
import { sentence, verdictOf } from "../src/render";

// The quiet note about 192.168.0.0/16 is left out of rules and text (most
// plans here use it); it has tests of its own below.
const run = (text: string, quiet = false) => {
  const { entries, bad } = parsePlan(text);
  const all = findings(entries, bad);
  const shown = quiet ? all : all.filter((f) => f.rule !== "pool192");
  return {
    rules: shown.map((f) => f.rule),
    text: shown.map((f) => sentence(f, entries)),
    verdict: verdictOf(all, entries),
  };
};

const FINE = "Fine if";

describe("ranges inside ranges", () => {
  test("one inside another: fine as its subnet, a conflict if separate", () => {
    expect(run("home 192.168.1.0/24\ncameras 192.168.1.128/25")).toEqual({
      rules: ["inside"],
      text: [
        "cameras sits inside home. Fine if home is the parent block; a conflict if they’re separate networks.",
      ],
      verdict: "One range sits inside home.",
    });
  });

  test("a single address inside a range", () => {
    expect(run("home 192.168.1.0/24\nnas 192.168.1.10/32").text).toEqual([
      "nas sits inside home. Fine if home is the parent block; a conflict if they’re separate networks.",
    ]);
  });

  test("a chain is one finding under its outermost range (loopback ⊂ p2p ⊂ wide)", () => {
    const r = run("wide 10.0.0.0/8\np2p 10.0.0.0/31\nloopback 10.0.0.1/32");
    expect(r.rules).toEqual(["inside"]);
    expect(r.text).toEqual([
      "Two ranges sit inside wide: p2p, and loopback inside p2p. Fine if wide is their parent block; a conflict if they’re separate networks.",
    ]);
    expect(r.verdict).toBe("Two ranges sit inside wide.");
  });

  test("the chain is the same whatever order it's typed in", () => {
    expect(
      run("loopback 10.0.0.1/32\np2p 10.0.0.0/31\nwide 10.0.0.0/8").text,
    ).toEqual([
      "Two ranges sit inside wide: p2p, and loopback inside p2p. Fine if wide is their parent block; a conflict if they’re separate networks.",
    ]);
  });

  test("siblings in one range, and a range in a sibling", () => {
    expect(
      run(
        "lab 10.0.0.0/16\na 10.0.1.0/24\nb 10.0.2.0/24\nc 10.0.2.0/25\nd 10.0.3.0/24\ne 10.0.4.0/24\nf 10.0.5.0/24",
      ).text,
    ).toEqual([
      "Six ranges sit inside lab: a, b, c inside b, d, and 2 more. Fine if lab is their parent block; a conflict if they’re separate networks.",
    ]);
  });

  test("two separate chains: two findings, and the verdict counts both", () => {
    const r = run(
      "home 192.168.1.0/24\ncams 192.168.1.128/25\nwide 10.0.0.0/8\np2p 10.0.0.0/31",
    );
    expect(r.rules).toEqual(["inside", "inside"]);
    expect(r.verdict).toBe("Two ranges sit inside other ranges.");
  });

  test("a range's own parts don't count; parts inside each other do", () => {
    expect(
      run("iot 192.168.20.0/24\n  a 192.168.20.0/25\n  b 192.168.20.128/25")
        .rules,
    ).toEqual([]);
    expect(
      run("iot 192.168.20.0/24\n  a 192.168.20.0/25\n  b 192.168.20.0/26").text,
    ).toEqual([
      "b sits inside a. Fine if a is the parent block; a conflict if they’re separate networks.",
    ]);
  });

  test("a part that isn't inside its range", () => {
    expect(run("iot 192.168.20.0/24\n  iot-c 192.168.21.0/25")).toMatchObject({
      rules: ["notInside"],
      text: [
        "iot-c 192.168.21.0/25 is indented under iot but isn’t inside it.",
      ],
    });
  });

  test("a part of one range inside another range counts", () => {
    expect(
      run("home 192.168.1.0/24\niot 192.168.20.0/24\n  x 192.168.1.0/25").rules,
    ).toEqual(["notInside", "inside"]);
  });

  test("ranges side by side don't", () => {
    expect(run("a 192.168.1.0/25\nb 192.168.1.128/25").rules).toEqual([]);
  });

  test("IPv6 too", () => {
    expect(
      run("site fd12:3456:789a::/48\nlan fd12:3456:789a:5::/64"),
    ).toMatchObject({
      rules: ["inside"],
      text: [
        `lan sits inside site. ${FINE} site is the parent block; a conflict if they’re separate networks.`,
      ],
    });
    expect(run("a fd12:1::/48\nb fd12:2::/48").rules).toEqual([]);
  });
});

describe("the same range twice is a real clash", () => {
  test("named, and it leads the verdict", () => {
    expect(run("a 10.0.0.0/24\nb 10.0.0.0/24")).toMatchObject({
      rules: ["sameRange"],
      text: ["a and b are the same range, 10.0.0.0/24."],
      verdict: "Two ranges overlap, so some devices won’t reach each other.",
    });
  });

  test("ahead of ranges inside ranges", () => {
    expect(
      run("a 10.0.0.0/24\nb 10.0.0.0/25\nc 10.0.0.128/25\nd 10.0.0.0/25")
        .verdict,
    ).toBe("Two ranges overlap, so some devices won’t reach each other.");
  });
});

describe("Docker's defaults, at their edges", () => {
  test.each([
    ["172.17.0.0/16", "bridge"],
    ["172.17.5.0/24", "bridge"],
    ["172.18.0.0/24", "pool"],
    ["172.31.255.0/24", "pool"],
    ["172.16.0.0/16", null],
    ["172.32.0.0/16", null],
    ["10.0.0.0/8", null],
    ["172.16.0.0/12", "bridge"],
    ["192.168.0.0/24", "pool192"],
    ["192.168.255.0/24", "pool192"],
    ["192.167.255.0/24", null],
    ["192.169.0.0/24", null],
  ])("%s", (range, rule) => {
    const docker = run(`lab ${range}`, true).rules.filter(
      (r) => r === "bridge" || r === "pool" || r === "pool192",
    );
    expect(docker).toEqual(rule ? [rule] : []);
  });

  test("the bridge: the host routes it to its own bridge", () => {
    expect(run("lab 172.17.0.0/16").text).toEqual([
      "lab is Docker’s default bridge (172.17.0.0/16). A Docker host routes that range to its own bridge, so the host and its containers can’t reach devices in lab.",
    ]);
  });

  test("the compose pool: only a clash for a network outside Docker", () => {
    expect(run("docker-custom 172.18.0.0/16").text).toEqual([
      "docker-custom is in the range Docker gives compose networks (172.18.0.0 to 172.31.255.255). If docker-custom is a network outside Docker, a new compose network can clash with it.",
    ]);
  });

  test("192.168.0.0/16: one quiet note for every range in it, last, not in the verdict", () => {
    const r = run(
      "home 192.168.1.0/24\nlab 172.17.0.0/16\niot 192.168.20.0/24\n  iot-1 192.168.20.0/25\ncopy 192.168.1.0/24",
      true,
    );
    expect(r.rules).toEqual(["sameRange", "bridge", "pool192"]);
    expect(r.text.at(-1)).toBe(
      "home and iot are in 192.168.0.0/16, which Docker also gives compose networks (in /20s) once 172.17 to 172.31 are used up, so on a busy Docker host a compose network can clash with them.",
    );
    expect(run("home 192.168.1.0/24", true)).toEqual({
      rules: ["pool192"],
      text: [
        "home is in 192.168.0.0/16, which Docker also gives compose networks (in /20s) once 172.17 to 172.31 are used up, so on a busy Docker host a compose network can clash with it.",
      ],
      verdict: "This plan works.",
    });
  });

  test("a range wider than 192.168.0.0/16 includes it; the /16 itself is it", () => {
    expect(run("all 0.0.0.0/0", true).text.at(-1)).toBe(
      "all includes 192.168.0.0/16, which Docker also gives compose networks (in /20s) once 172.17 to 172.31 are used up, so on a busy Docker host a compose network can clash with part of it.",
    );
    expect(run("wide 192.0.0.0/8", true).text.at(-1)).toMatch(
      /^wide includes 192\.168\.0\.0\/16, /,
    );
    expect(run("lan 192.168.0.0/16", true).text.at(-1)).toMatch(
      /^lan is 192\.168\.0\.0\/16, .* can clash with it\.$/,
    );
    // In it and holding it: one note each, never "all is in".
    const both = run("home 192.168.1.0/24\nall 0.0.0.0/0", true);
    expect(both.text.filter((t) => t.includes("192.168.0.0/16,"))).toEqual([
      expect.stringMatching(/^home is in 192\.168/),
      expect.stringMatching(/^all includes 192\.168/),
    ]);
  });
});

describe("how the plan was read", () => {
  test("a host address is said, as typed, and read as its network", () => {
    expect(run("misaligned 192.168.1.10/24")).toEqual({
      rules: ["host"],
      text: [
        "192.168.1.10/24 is a host address; treated as network 192.168.1.0/24.",
      ],
      verdict: "This plan works, but one thing is worth a look.",
    });
    expect(run("v6 fd00::5/64").text).toContain(
      "fd00::5/64 is a host address; treated as network fd00::/64.",
    );
    // A network written with its mask isn't a host address.
    expect(run("lan 10.0.0.0 255.0.0.0").rules).toEqual([]);
  });

  test("typos say why, and come first: the plan is missing them", () => {
    const r = run(
      "home 192.168.1.0/24\nb 192.168.1.0/24\nx 192.168.1/24\ny 10.010.0.0/16\nz 10.0.0.0/33\nnas 192.168.1.300/32\nv6 fd00::/129\noops",
    );
    expect(r.rules.slice(0, 6)).toEqual([
      "bad",
      "bad",
      "bad",
      "bad",
      "bad",
      "bad",
    ]);
    expect(r.text.slice(0, 6)).toEqual([
      "Line 3: 192.168.1 has three parts; an IPv4 address has four, like 192.168.1.0.",
      "Line 4: 010 starts with a zero, which some tools read as octal. Write it as 10.",
      "Line 5: /33 isn’t a valid size (/0 to /32).",
      "Line 6: 300 isn’t a valid octet (0 to 255).",
      "Line 7: /129 isn’t a valid size (/0 to /128).",
      "Line 8 isn’t a range: “oops”.",
    ]);
    expect(r.rules.at(-1)).toBe("sameRange");
  });
});

describe("the rest", () => {
  test("a name used twice, in any case", () => {
    expect(run("lab 10.0.0.0/24\nLab 10.0.1.0/24")).toMatchObject({
      rules: ["sameName"],
      text: ["Two ranges are called lab."],
      verdict: "This plan works, but one thing is worth a look.",
    });
  });
});

describe("the verdict", () => {
  test("a plan with nothing wrong", () => {
    expect(run("home 192.168.1.0/24\niot 192.168.20.0/24").verdict).toBe(
      "This plan works.",
    );
  });

  test("the same range counted in pairs", () => {
    expect(
      run("a 10.0.0.0/24\nb 10.0.0.0/24\nc 10.0.0.0/24\nlab 172.17.0.0/16")
        .verdict,
    ).toBe(
      "Two pairs of ranges overlap, so some devices won’t reach each other.",
    );
  });

  test("nothing typed yet", () => {
    expect(run("").verdict).toBe("This plan works.");
  });
});
