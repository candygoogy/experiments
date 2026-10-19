import { describe, expect, test } from "vitest";
import { LEVEL } from "../src/copy";
import type { Report } from "../src/model";
import { rows, type Row } from "../src/rows";
import { overall } from "../src/verdict";

const good: Report = {
  domain: "example.net",
  mx: {
    kind: "hosts",
    hosts: [{ host: "mx.example.net", preference: 10, alias: false }],
    nullToo: false,
  },
  spf: {
    kind: "one",
    record: "v=spf1 mx -all",
    all: "-",
    allFrom: null,
    lookups: 1,
    unchecked: [],
    uncheckedExists: [],
    macros: [],
    loop: false,
    emptyRedirect: null,
    emptyInclude: null,
    ptr: false,
    syntax: null,
    manyAt: null,
    open: null,
    wide: null,
    senders: true,
    mxOver: null,
  },
  dkim: [
    {
      selector: "s1",
      keyType: "rsa",
      bits: 2048,
      revoked: false,
      unusable: null,
    },
  ],
  dkimUnchecked: 0,
  dmarc: {
    kind: "one",
    from: "example.net",
    policy: "reject",
    subdomains: null,
    pct: 100,
    reports: true,
    invalid: null,
  },
  mtaSts: true,
  tlsRpt: true,
  dnssec: true,
};
const row = (r: Report, id: Row["id"]) => {
  const found = rows(r).find((x) => x.id === id);
  if (!found) throw new Error(id);
  return found;
};
const spf = (s: Partial<Extract<Report["spf"], { kind: "one" }>>): Report => ({
  ...good,
  spf: {
    kind: "one",
    record: "v=spf1 mx -all",
    all: "-",
    allFrom: null,
    lookups: 1,
    unchecked: [],
    uncheckedExists: [],
    macros: [],
    loop: false,
    emptyRedirect: null,
    emptyInclude: null,
    ptr: false,
    syntax: null,
    manyAt: null,
    open: null,
    wide: null,
    senders: true,
    mxOver: null,
    ...s,
  },
});

// [what, report, row, level, words the main sentence must hold]
const CASES: [string, Report, Row["id"], Row["level"], RegExp][] = [
  ["MX in place", good, "mx", "good", /receives mail through one server/],
  [
    "MX through an alias",
    {
      ...good,
      mx: {
        kind: "hosts",
        hosts: [{ host: "mx.example.net", preference: 10, alias: true }],
        nullToo: false,
      },
    },
    "mx",
    "weak",
    /alias \(CNAME\)/,
  ],
  [
    "no MX",
    { ...good, mx: { kind: "none" } },
    "mx",
    "missing",
    /can’t receive mail/,
  ],
  [
    "null MX",
    { ...good, mx: { kind: "null" } },
    "mx",
    "info",
    /receives no mail/,
  ],
  ["SPF -all", good, "spf", "good", /reject anyone else/],
  ["SPF ~all", spf({ all: "~" }), "spf", "good", /suspicious/],
  [
    "SPF ?all",
    spf({ all: "?" }),
    "spf",
    "weak",
    /says nothing about anyone else/,
  ],
  [
    "SPF with no all",
    spf({ all: null }),
    "spf",
    "weak",
    /doesn’t say what to do/,
  ],
  ["SPF ptr", spf({ ptr: true }), "spf", "weak", /ptr, which is deprecated/],
  [
    "SPF +all",
    spf({ all: "+", open: { term: "+all", from: null } }),
    "spf",
    "unsafe",
    /anyone at all/,
  ],
  [
    "SPF past 10 lookups",
    spf({ all: "?", lookups: 12 }),
    "spf",
    "broken",
    /12 DNS lookups, more than 10/,
  ],
  [
    "no SPF",
    { ...good, spf: { kind: "none" } },
    "spf",
    "missing",
    /No SPF record/,
  ],
  [
    "two SPF",
    { ...good, spf: { kind: "many", count: 2 } },
    "spf",
    "broken",
    /Only one is allowed/,
  ],
  ["DKIM in place", good, "dkim", "good", /under s1/],
  [
    "DKIM short key",
    {
      ...good,
      dkim: [
        {
          selector: "s1",
          keyType: "rsa",
          bits: 1024,
          revoked: false,
          unusable: null,
        },
      ],
    },
    "dkim",
    "weak",
    /1024 bits/,
  ],
  [
    "DKIM not found",
    { ...good, dkim: [] },
    "dkim",
    "info",
    /may use a different one/,
  ],
  [
    "DKIM only withdrawn",
    {
      ...good,
      dkim: [
        {
          selector: "s1",
          keyType: "rsa",
          bits: null,
          revoked: true,
          unusable: null,
        },
      ],
    },
    "dkim",
    "info",
    /withdrawn/,
  ],
  ["DMARC reject", good, "dmarc", "good", /rejected/],
  [
    "DMARC p=none",
    {
      ...good,
      dmarc: {
        kind: "one",
        from: "example.net",
        policy: "none",
        subdomains: null,
        pct: 100,
        reports: true,
        invalid: null,
      },
    },
    "dmarc",
    "weak",
    /Monitoring only/,
  ],
  [
    "DMARC part of the mail",
    {
      ...good,
      dmarc: {
        kind: "one",
        from: "example.net",
        policy: "quarantine",
        subdomains: null,
        pct: 50,
        reports: true,
        invalid: null,
      },
    },
    "dmarc",
    "weak",
    /only 50% of them; the rest are delivered as usual/,
  ],
  [
    "DMARC no policy",
    {
      ...good,
      dmarc: {
        kind: "one",
        from: "example.net",
        policy: null,
        subdomains: null,
        pct: 100,
        reports: false,
        invalid: null,
      },
    },
    "dmarc",
    "broken",
    /no policy/,
  ],
  [
    "no DMARC",
    { ...good, dmarc: { kind: "none" } },
    "dmarc",
    "missing",
    /No DMARC policy/,
  ],
  [
    "two DMARC",
    { ...good, dmarc: { kind: "many", count: 2, from: "example.net" } },
    "dmarc",
    "broken",
    /Only one is allowed/,
  ],
  ["extras", good, "extras", "info", /signed \(DNSSEC\)/],
];

describe("each row leads with what its level is about", () => {
  test.each(CASES)("%s", (_what, report, id, level, says) => {
    const r = row(report, id);
    expect(r.level).toBe(level);
    expect(r.says).toMatch(says);
  });

  test("a level word never stands alone: there's always a sentence, and a note has no word", () => {
    for (const [, report] of CASES) {
      for (const r of rows(report)) {
        expect(r.says.length).toBeGreaterThan(10);
        expect(r.word).toBe(LEVEL[r.level]);
        if (r.level === "info") expect(r.word).toBe("");
        else expect(r.word).not.toBe("");
      }
    }
  });

  test("a healthy row says In place", () => {
    expect(row(good, "spf").word).toBe("In place");
  });

  test("the rest of a row's issues follow in its details", () => {
    const r = row(spf({ all: "?", lookups: 12, ptr: true }), "spf");
    expect(r.says).toMatch(/12 DNS lookups/);
    expect(r.details.join(" ")).toMatch(/says nothing about anyone else/);
    expect(r.details.join(" ")).toMatch(/ptr/);
    expect(r.details).toContain("v=spf1 mx -all");
  });
});

describe("the verdict", () => {
  test("well protected: enforced DMARC, working SPF, a DKIM key", () => {
    expect(overall(good)).toBe("protected");
  });

  test("can be faked: no DMARC, p=none, or +all", () => {
    expect(overall({ ...good, dmarc: { kind: "none" } })).toBe("fakeable");
    expect(
      overall({
        ...good,
        dmarc: {
          kind: "one",
          from: "example.net",
          policy: "none",
          subdomains: null,
          pct: 100,
          reports: true,
          invalid: null,
        },
      }),
    ).toBe("fakeable");
    expect(overall(spf({ all: "+", open: { term: "+all", from: null } }))).toBe(
      "fakeable",
    );
    expect(
      overall({
        ...good,
        dmarc: { kind: "many", count: 2, from: "example.net" },
      }),
    ).toBe("fakeable");
  });

  test("in between: fakes stopped, but SPF missing or broken, or no DKIM key", () => {
    expect(overall({ ...good, dkim: [] })).toBe("partly");
    expect(overall(spf({ lookups: 11 }))).toBe("partly");
    expect(overall({ ...good, spf: { kind: "none" } })).toBe("partly");
    expect(overall({ ...good, spf: { kind: "many", count: 2 } })).toBe(
      "partly",
    );
  });
});
