// The overall verdict, for every combination of SPF, DMARC and DKIM states:
// a table of the cases that matter, then rules that must hold for all of
// them, then whole domains looked up through stubbed DNS.
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { describe, expect, test } from "vitest";
import { analyze } from "../src/analyze";
import { DnsError } from "../src/dns";
import { VERDICT, WORDS } from "../src/copy";
import type { DkimKey, Dmarc, Report, Spf } from "../src/model";
import { renderReport } from "../src/render";
import { rows } from "../src/rows";
import { overall, type Overall } from "../src/verdict";
import { stub, txt, type Zone } from "./stub";

const DOMAIN = "example.net";

const one = (s: Partial<Extract<Spf, { kind: "one" }>> = {}): Spf => ({
  kind: "one",
  record: "v=spf1 mx -all",
  all: "-",
  allFrom: null,
  lookups: 1,
  unchecked: [],
  uncheckedExists: [],
  macros: [],
  redirectMacro: false,
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
});

const SPF = {
  none: { kind: "none" },
  many: { kind: "many", count: 2 },
  unchecked: { kind: "unchecked" },
  "-all": one(),
  "~all": one({ all: "~", record: "v=spf1 mx ~all" }),
  "?all": one({ all: "?", record: "v=spf1 mx ?all" }),
  "no all": one({ all: null, record: "v=spf1 mx" }),
  "+all": one({
    all: "+",
    record: "v=spf1 +all",
    open: { term: "+all", from: null },
    senders: false,
  }),
  "+all, 12 lookups": one({
    all: "+",
    lookups: 12,
    open: { term: "+all", from: null },
  }),
  // Anyone passes, through a record it pulls in, or a range that takes in
  // every address.
  "+all through an include": one({
    record: "v=spf1 include:open.example -all",
    open: { term: "+all", from: "open.example" },
  }),
  "ip4:0.0.0.0/0": one({
    record: "v=spf1 ip4:0.0.0.0/0 -all",
    lookups: 0,
    open: { term: "ip4:0.0.0.0/0", from: null },
  }),
  "a /8": one({
    record: "v=spf1 ip4:17.0.0.0/8 -all",
    lookups: 0,
    wide: { term: "ip4:17.0.0.0/8", from: null },
  }),
  "a mistake in it": one({
    record: "v=spf1 incude:_spf.example.net -all",
    lookups: 0,
    syntax: { term: "incude:_spf.example.net", from: null },
  }),
  "two records in an include": one({ manyAt: "a.example" }),
  "mx with 11 servers": one({ mxOver: 11 }),
  "names nobody (v=spf1)": one({
    record: "v=spf1",
    all: null,
    lookups: 0,
    senders: false,
  }),
  "12 lookups": one({ lookups: 12 }),
  loop: one({ loop: true }),
  "empty include": one({ emptyInclude: "a.example" }),
  "empty redirect": one({ emptyRedirect: "a.example", all: null }),
  "part unchecked": one({ unchecked: ["a.example"] }),
  "nobody (v=spf1 -all)": one({
    record: "v=spf1 -all",
    lookups: 0,
    senders: false,
  }),
} satisfies Record<string, Spf>;

const policy = (p: Partial<Extract<Dmarc, { kind: "one" }>> = {}): Dmarc => ({
  kind: "one",
  from: DOMAIN,
  policy: "reject",
  subdomains: null,
  pct: 100,
  reports: true,
  invalid: null,
  ...p,
});

const DMARC = {
  none: { kind: "none" },
  unchecked: { kind: "unchecked" },
  many: { kind: "many", count: 2, from: DOMAIN },
  "no p=": policy({ policy: null }),
  "p=none": policy({ policy: "none" }),
  "p=quarantine": policy({ policy: "quarantine" }),
  "p=reject": policy(),
  "p=reject pct=50": policy({ pct: 50 }),
  "p=quarantine pct=50": policy({ policy: "quarantine", pct: 50 }),
  "p=quarantine pct=0": policy({ policy: "quarantine", pct: 0 }),
  "p=reject pct=0": policy({ pct: 0 }),
  "p=reject sp=none": policy({ subdomains: "none" }),
  "parent's p=reject": policy({ from: "parent.example" }),
  // RFC 7489, 6.6.3: treated as p=none with reports, ignored without.
  "p=reject sp=rejcet": policy({ invalid: "sp=rejcet" }),
  "p=reject sp=rejcet, no rua": policy({
    invalid: "sp=rejcet",
    reports: false,
  }),
} satisfies Record<string, Dmarc>;

const key = (selector: string, bits: number | null, more = {}): DkimKey => ({
  selector,
  keyType: "rsa",
  bits,
  revoked: false,
  unusable: null,
  ...more,
});

const DKIM = {
  none: [],
  "2048": [key("s1", 2048)],
  "1024": [key("s1", 1024)],
  "2048 + 1024": [key("selector1", 2048), key("selector2", 1024)],
  "512": [key("s1", 512)],
  "2048 + 512": [key("s1", 2048), key("s2", 512)],
  withdrawn: [key("s1", null, { revoked: true })],
  ed25519: [key("s1", 256, { keyType: "ed25519" })],
  "not a valid key": [key("s1", null, { unusable: "bad" })],
  "k=foo": [key("s1", 2048, { keyType: "foo", unusable: "kind" })],
  "2048 + not a valid key": [
    key("s1", 2048),
    key("s2", null, { unusable: "bad" }),
  ],
} satisfies Record<string, DkimKey[]>;

type S = keyof typeof SPF;
type D = keyof typeof DMARC;
type K = keyof typeof DKIM;

const report = (s: S, d: D, k: K, more: Partial<Report> = {}): Report => ({
  domain: DOMAIN,
  mx: {
    kind: "hosts",
    hosts: [{ host: "mx.example.net", preference: 10, alias: false }],
    nullToo: false,
  },
  spf: SPF[s],
  dkim: DKIM[k],
  dkimUnchecked: 0,
  dmarc: DMARC[d],
  mtaSts: true,
  tlsRpt: true,
  dnssec: true,
  ...more,
});

// [SPF, DMARC, DKIM, verdict]
const TABLE: [S, D, K, Overall][] = [
  // Everything in place.
  ["-all", "p=reject", "2048", "protected"],
  ["~all", "p=quarantine", "2048", "protected"],
  ["-all", "p=reject", "ed25519", "protected"],
  ["-all", "parent's p=reject", "2048", "protected"],
  // SPF that doesn't stop others still can't let a fake pass DMARC.
  ["?all", "p=reject", "2048", "protected"],
  ["no all", "p=reject", "2048", "protected"],
  // Anyone passes SPF: fakes pass DMARC whatever it says.
  ["+all", "p=reject", "2048", "fakeable"],
  ["+all", "unchecked", "2048", "fakeable"],
  ["+all, 12 lookups", "p=reject", "2048", "fakeable"],
  ["+all through an include", "p=reject", "2048", "fakeable"],
  ["ip4:0.0.0.0/0", "p=reject", "2048", "fakeable"],
  ["ip4:0.0.0.0/0", "unchecked", "2048", "fakeable"],
  // No policy that stops fakes: receivers decide on their own.
  ["-all", "none", "2048", "fakeable"],
  ["-all", "many", "2048", "fakeable"],
  ["-all", "no p=", "2048", "fakeable"],
  ["-all", "p=none", "2048", "fakeable"],
  ["-all", "p=quarantine pct=0", "2048", "fakeable"],
  ["-all", "p=reject sp=rejcet", "2048", "fakeable"],
  ["-all", "p=reject sp=rejcet, no rua", "2048", "fakeable"],
  ["none", "none", "none", "fakeable"],
  ["many", "p=none", "2048", "fakeable"],
  ["unchecked", "none", "2048", "fakeable"],
  // Fakes stopped, but SPF missing or broken: the domain's own mail
  // rests on DKIM alone.
  ["none", "p=reject", "2048", "partly"],
  ["many", "p=reject", "2048", "partly"],
  ["none", "p=quarantine", "ed25519", "partly"],
  ["12 lookups", "p=reject", "2048", "partly"],
  ["loop", "p=reject", "2048", "partly"],
  ["empty include", "p=reject", "2048", "partly"],
  ["empty redirect", "p=reject", "2048", "partly"],
  ["a mistake in it", "p=reject", "2048", "partly"],
  ["two records in an include", "p=reject", "2048", "partly"],
  ["mx with 11 servers", "p=reject", "2048", "partly"],
  ["names nobody (v=spf1)", "p=reject", "2048", "partly"],
  // A range so wide that senders who aren't the domain's may be in it.
  ["a /8", "p=reject", "2048", "partly"],
  ["none", "p=reject", "none", "partly"],
  // Fakes stopped, but no key its own mail could be signed with.
  ["-all", "p=reject", "none", "partly"],
  ["-all", "p=reject", "withdrawn", "partly"],
  ["-all", "p=reject", "512", "partly"],
  ["-all", "p=reject", "not a valid key", "partly"],
  ["-all", "p=reject", "k=foo", "partly"],
  ["nobody (v=spf1 -all)", "p=reject", "512", "partly"],
  // A weakened policy or only short keys.
  ["-all", "p=reject pct=50", "2048", "partly"],
  ["-all", "p=quarantine pct=50", "2048", "partly"],
  ["-all", "p=reject pct=0", "2048", "partly"],
  ["-all", "p=reject sp=none", "2048", "partly"],
  ["-all", "p=reject", "1024", "partly"],
  // One strong key is enough; a short key beside it doesn't count against.
  ["-all", "p=reject", "2048 + 1024", "protected"],
  ["-all", "p=reject", "2048 + 512", "protected"],
  ["-all", "p=reject", "2048 + not a valid key", "protected"],
  // A domain that sends no mail at all.
  ["nobody (v=spf1 -all)", "p=reject", "none", "parked"],
  ["nobody (v=spf1 -all)", "p=quarantine", "withdrawn", "parked"],
  ["nobody (v=spf1 -all)", "p=reject", "2048", "protected"],
  ["nobody (v=spf1 -all)", "p=reject pct=50", "none", "partly"],
  ["nobody (v=spf1 -all)", "p=none", "none", "fakeable"],
  // What the verdict depends on didn't answer.
  ["-all", "unchecked", "2048", "unchecked"],
  ["none", "unchecked", "2048", "unchecked"],
  ["many", "unchecked", "2048", "unchecked"],
  ["unchecked", "p=reject", "2048", "unchecked"],
  ["part unchecked", "p=reject", "2048", "unchecked"],
];

describe("the verdict table", () => {
  test.each(TABLE)("SPF %s, DMARC %s, DKIM %s: %s", (s, d, k, verdict) => {
    expect(overall(report(s, d, k))).toBe(verdict);
  });
});

const ALL = (Object.keys(SPF) as S[]).flatMap((s) =>
  (Object.keys(DMARC) as D[]).flatMap((d) =>
    (Object.keys(DKIM) as K[]).map((k) => [s, d, k] as const),
  ),
);

const stops = (d: D) =>
  [
    "p=quarantine",
    "p=reject",
    "p=reject pct=50",
    "p=quarantine pct=50",
    "p=reject pct=0",
    "p=reject sp=none",
    "parent's p=reject",
  ].includes(d);
const anyone = (s: S) =>
  [
    "+all",
    "+all, 12 lookups",
    "+all through an include",
    "ip4:0.0.0.0/0",
  ].includes(s);

describe(`every combination (${ALL.length})`, () => {
  test("+all is always fakeable", () => {
    for (const [s, d, k] of ALL) {
      if (anyone(s))
        expect(overall(report(s, d, k)), `${s} ${d} ${k}`).toBe("fakeable");
    }
  });

  test("when anyone passes SPF, its row is Unsafe and DMARC's never In place", () => {
    for (const [s, d, k] of ALL) {
      if (!anyone(s)) continue;
      const r = report(s, d, k);
      expect(rowOf(r, "spf").level, `${s} ${d} ${k}`).toBe("unsafe");
      expect(rowOf(r, "dmarc").level, `${s} ${d} ${k}`).not.toBe("good");
    }
  });

  test("without a policy that stops fakes, it's fakeable; an unanswered policy can't be judged", () => {
    for (const [s, d, k] of ALL) {
      if (anyone(s) || stops(d)) continue;
      expect(overall(report(s, d, k)), `${s} ${d} ${k}`).toBe(
        d === "unchecked" ? "unchecked" : "fakeable",
      );
    }
  });

  test("a policy that stops fakes is never called fakeable, whatever SPF and DKIM are (short of +all)", () => {
    for (const [s, d, k] of ALL) {
      if (anyone(s) || !stops(d)) continue;
      expect(overall(report(s, d, k)), `${s} ${d} ${k}`).not.toBe("fakeable");
    }
  });

  test("the verdict never contradicts the DMARC row", () => {
    for (const [s, d, k] of ALL) {
      const r = report(s, d, k);
      const dmarc = rows(r).find((x) => x.id === "dmarc");
      if (dmarc?.level === "good") {
        expect(overall(r), `${s} ${d} ${k}`).not.toBe("fakeable");
      }
    }
  });

  test("well protected only with a policy that stops fakes, nothing unanswered, and no problem in SPF, DKIM or DMARC", () => {
    for (const [s, d, k] of ALL) {
      const r = report(s, d, k);
      const o = overall(r);
      if (o !== "protected" && o !== "parked") continue;
      expect(stops(d), `${s} ${d} ${k}`).toBe(true);
      for (const row of rows(r).filter((x) => x.id !== "mx")) {
        expect(["good", "weak", "info"], `${s} ${d} ${k}: ${row.id}`).toContain(
          row.level,
        );
      }
      if (o === "parked") {
        expect(s).toBe("nobody (v=spf1 -all)");
        expect(["none", "withdrawn"]).toContain(k);
      }
    }
  });

  test("a missing or broken SPF under a policy that stops fakes explains what that leaves", () => {
    for (const [s, d, k] of ALL) {
      const r = report(s, d, k);
      const spf = rows(r).find((x) => x.id === "spf");
      const broken = spf?.level === "missing" || spf?.level === "broken";
      expect(spf?.details.includes(WORDS.spfDkimOnly), `${s} ${d} ${k}`).toBe(
        broken && stops(d),
      );
    }
  });
});

// Whole domains, looked up through stubbed DNS.
const D2 = "example.com";
const der = (bits: number) =>
  generateKeyPairSync("rsa", { modulusLength: bits })
    .publicKey.export({ type: "spki", format: "der" })
    .toString("base64");
const RSA_2048 = der(2048);
const RSA_1024 = der(1024);

const lookUp = async (zone: Zone) => {
  const r = await analyze(D2, stub(zone).resolve);
  if ("missing" in r) throw new Error("missing");
  return r;
};
const line = (r: Report) => {
  const window = new Window();
  const verdict = renderReport(
    window.document as unknown as Document,
    r,
  ).verdict;
  void window.happyDOM.close();
  return verdict;
};
const rowOf = (r: Report, id: string) => {
  const found = rows(r).find((x) => x.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe("whole domains", () => {
  test("no SPF, p=reject and a 2048-bit key: partly protected, and SPF says what's left", async () => {
    const r = await lookUp({
      [`${D2} MX`]: [["MX", "10 mx.example.net."]],
      [`_dmarc.${D2} TXT`]: [["TXT", txt("v=DMARC1; p=reject")]],
      [`selector1._domainkey.${D2} TXT`]: [
        ["TXT", txt(`v=DKIM1; k=rsa; p=${RSA_2048}`)],
      ],
    });
    expect(overall(r)).toBe("partly");
    expect(line(r)).toBe(VERDICT.partly);
    expect(rowOf(r, "spf").level).toBe("missing");
    expect(rowOf(r, "spf").details).toContain(WORDS.spfDkimOnly);
    expect(rowOf(r, "dmarc").says).toBe("Fakes are rejected (p=reject).");
  });

  test("two SPF records, p=reject and a key: partly protected, and SPF is broken (an error)", async () => {
    const r = await lookUp({
      [`${D2} MX`]: [["MX", "10 mx.example.net."]],
      [`${D2} TXT`]: [
        ["TXT", txt("v=spf1 -all")],
        ["TXT", txt("v=spf1 mx -all")],
      ],
      [`_dmarc.${D2} TXT`]: [["TXT", txt("v=DMARC1; p=reject")]],
      [`selector1._domainkey.${D2} TXT`]: [
        ["TXT", txt(`v=DKIM1; k=rsa; p=${RSA_2048}`)],
      ],
    });
    expect(overall(r)).toBe("partly");
    expect(rowOf(r, "spf").says).toBe(
      "Two SPF records. Only one is allowed, so receivers treat SPF as broken (an error).",
    );
  });

  test("a parked domain: null MX, v=spf1 -all, p=reject: well protected, in its own words", async () => {
    const r = await lookUp({
      [`${D2} MX`]: [["MX", "0 ."]],
      [`${D2} TXT`]: [["TXT", txt("v=spf1 -all")]],
      [`_dmarc.${D2} TXT`]: [
        ["TXT", txt("v=DMARC1;p=reject;sp=reject;adkim=s;aspf=s")],
      ],
    });
    expect(overall(r)).toBe("parked");
    expect(line(r)).toBe(VERDICT.parked);
    expect(rowOf(r, "dkim").says).toBe(WORDS.dkimNotNeeded);
  });

  test("a 2048-bit key with a 1024-bit one beside it: well protected, with the short key noted", async () => {
    const r = await lookUp({
      [`${D2} MX`]: [["MX", "10 mx.example.net."]],
      [`${D2} TXT`]: [["TXT", txt("v=spf1 mx -all")]],
      [`_dmarc.${D2} TXT`]: [["TXT", txt("v=DMARC1; p=reject")]],
      [`selector1._domainkey.${D2} TXT`]: [
        ["TXT", txt(`v=DKIM1; k=rsa; p=${RSA_2048}`)],
      ],
      [`selector2._domainkey.${D2} TXT`]: [
        ["TXT", txt(`v=DKIM1; k=rsa; p=${RSA_1024}`)],
      ],
    });
    expect(overall(r)).toBe("protected");
    expect(rowOf(r, "dkim").level).toBe("weak");
    expect(rowOf(r, "dkim").says).toBe(
      "The key under selector2 is only 1024 bits; 2048 is the usual length now.",
    );
    expect(rowOf(r, "dkim").details).toContain(
      "Found keys under selector1 and selector2.",
    );
  });

  test("the page's example is well protected, under a name kept for examples", () => {
    const table = JSON.parse(
      readFileSync(new URL("../src/example.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    const names = Object.keys(table).filter((k) => k !== "_comment");
    for (const n of names) expect(n).toMatch(/\.example (MX|TXT)$/);
  });
});

// A sound domain to change one thing in: MX, SPF -all, p=reject and a
// 2048-bit key.
const sound = (more: Zone = {}): Zone => ({
  [`${D2} MX`]: [["MX", "10 mx.example.net."]],
  [`${D2} TXT`]: [["TXT", txt("v=spf1 mx -all")]],
  [`_dmarc.${D2} TXT`]: [["TXT", txt("v=DMARC1; p=reject")]],
  [`selector1._domainkey.${D2} TXT`]: [
    ["TXT", txt(`v=DKIM1; k=rsa; p=${RSA_2048}`)],
  ],
  ...more,
});
const spfIs = (...records: string[]): Zone =>
  sound({
    [`${D2} TXT`]: records.map((v) => ["TXT", txt(v)] as ["TXT", string]),
  });

describe("anyone can pass SPF, however the record lets them (RFC 7208, 5)", () => {
  test("the sound domain is well protected", async () => {
    expect(overall(await lookUp(sound()))).toBe("protected");
  });

  test.each([
    [
      "an include whose record says +all",
      { "open.example TXT": [["TXT", txt("v=spf1 +all")]] },
      "v=spf1 include:open.example -all",
      "It lets anyone at all send as this domain (+all in open.example’s record).",
    ],
    [
      "a bare all, two includes down",
      {
        "a.example TXT": [
          ["TXT", txt("v=spf1 ip4:192.0.2.1 include:b.example -all")],
        ],
        "b.example TXT": [["TXT", txt("v=spf1 all")]],
      },
      "v=spf1 include:a.example -all",
      "It lets anyone at all send as this domain (+all in b.example’s record).",
    ],
    [
      "a redirect to a record that includes one",
      {
        "_spf.example.net TXT": [
          ["TXT", txt("v=spf1 include:open.example ~all")],
        ],
        "open.example TXT": [["TXT", txt("v=spf1 +all")]],
      },
      "v=spf1 redirect=_spf.example.net",
      "It lets anyone at all send as this domain (+all in open.example’s record).",
    ],
    [
      "every IPv4 address",
      {},
      "v=spf1 ip4:0.0.0.0/0 -all",
      "It lets anyone at all send as this domain (ip4:0.0.0.0/0).",
    ],
    [
      "every IPv6 address",
      {},
      "v=spf1 ip6:::/0 -all",
      "It lets anyone at all send as this domain (ip6:::/0).",
    ],
    [
      "more than a /8, which no one network holds",
      {},
      "v=spf1 ip4:16.0.0.0/7 -all",
      "It lets anyone at all send as this domain (ip4:16.0.0.0/7).",
    ],
    [
      "the domain's addresses, widened to all of them",
      {},
      "v=spf1 a/0 -all",
      "It lets anyone at all send as this domain (a/0).",
    ],
    [
      "an exists check on a name that has an address",
      { "example.org A": [["A", "192.0.2.10"]] },
      "v=spf1 exists:example.org -all",
      "It lets anyone at all send as this domain (exists:example.org).",
    ],
    [
      "an exists check on a name the sender picks",
      {},
      "v=spf1 exists:%{l}.users.example.org -all",
      "It lets anyone at all send as this domain (exists:%{l}.users.example.org).",
    ],
    [
      "an include whose record takes in every address",
      { "open.example TXT": [["TXT", txt("v=spf1 ip6:::/0 -all")]] },
      "v=spf1 include:open.example -all",
      "It lets anyone at all send as this domain (ip6:::/0 in open.example’s record).",
    ],
  ] as [string, Zone, string, string][])(
    "%s: can be faked, and SPF is Unsafe",
    async (_what, more, record, says) => {
      const r = await lookUp({ ...spfIs(record), ...more });
      expect(overall(r)).toBe("fakeable");
      expect(line(r)).toBe(VERDICT.fakeable);
      expect(rowOf(r, "spf")).toMatchObject({ level: "unsafe", says });
      // The record's own -all isn't offered as if it held.
      expect(rowOf(r, "spf").details.join(" ")).not.toMatch(
        /reject anyone else/,
      );
      expect(rowOf(r, "dmarc").level).toBe("unsafe");
      expect(rowOf(r, "dmarc").says).toMatch(/fakes pass DMARC anyway/);
    },
  );

  test.each([
    ["an include that ends ~all", "v=spf1 ip4:192.0.2.1 ~all"],
    ["an include that ends ?all", "v=spf1 ip4:192.0.2.1 ?all"],
    ["an include that lists one address", "v=spf1 ip4:192.0.2.1"],
  ])(
    "%s never lets a stranger through: an include only matches on a pass",
    async (_what, inner) => {
      const r = await lookUp({
        ...spfIs("v=spf1 include:inner.example -all"),
        "inner.example TXT": [["TXT", txt(inner)]],
      });
      expect(overall(r)).toBe("protected");
    },
  );

  test("?include of a +all record makes strangers neutral, not passing", async () => {
    const r = await lookUp({
      ...spfIs("v=spf1 mx ?include:open.example -all"),
      "open.example TXT": [["TXT", txt("v=spf1 +all")]],
    });
    expect(overall(r)).not.toBe("fakeable");
  });

  test("a +all after -all is never reached", async () => {
    const r = await lookUp(spfIs("v=spf1 mx -all +all"));
    expect(overall(r)).toBe("protected");
    expect(rowOf(r, "spf")).toMatchObject({
      level: "good",
      says: "It lists who may send, and asks receivers to reject anyone else (-all).",
    });
  });

  test("an exists check on a name with no address matches nobody (RFC 7208, 5.7)", async () => {
    const { resolve, asked } = stub(spfIs("v=spf1 mx exists:x.example -all"));
    const r = await analyze(D2, resolve);
    if ("missing" in r) throw new Error("missing");
    expect(asked).toContain("x.example A");
    expect(overall(r)).toBe("protected");
  });

  test("an exists check whose lookup fails leaves the verdict waiting", async () => {
    const { resolve } = stub(spfIs("v=spf1 mx exists:x.example -all"));
    const r = await analyze(D2, (name, type) =>
      name === "x.example"
        ? Promise.reject(new DnsError("SERVFAIL"))
        : resolve(name, type),
    );
    if ("missing" in r) throw new Error("missing");
    expect(overall(r)).toBe("unchecked");
    // The lookups are all known: only who it lets send isn't.
    const spf = rowOf(r, "spf");
    expect(spf).toMatchObject({
      level: "unchecked",
      says: "Couldn’t check x.example, so this page can’t tell who it lets send.",
    });
    expect(spf.details).toContain("2 of 10 DNS lookups.");
    expect([spf.says, ...spf.details].join(" ")).not.toMatch(/at least/i);
  });

  test("an exists check and an include both failing: each says what it leaves unknown", async () => {
    const { resolve } = stub(
      spfIs("v=spf1 include:slow.example exists:x.example -all"),
    );
    const r = await analyze(D2, (name, type) =>
      name === "x.example" || name === "slow.example"
        ? Promise.reject(new DnsError("SERVFAIL"))
        : resolve(name, type),
    );
    if ("missing" in r) throw new Error("missing");
    expect(overall(r)).toBe("unchecked");
    const spf = rowOf(r, "spf");
    expect([spf.says, ...spf.details]).toEqual(
      expect.arrayContaining([
        "Couldn’t check slow.example, so it takes at least 2 of 10 DNS lookups, maybe more.",
        "Couldn’t check x.example, so this page can’t tell who it lets send.",
      ]),
    );
  });

  test("an exists check on the sender's address is an ordinary sender", async () => {
    const r = await lookUp(spfIs("v=spf1 exists:%{i}._spf.example.org -all"));
    expect(overall(r)).toBe("protected");
  });

  test.each([
    [
      "a /8",
      "v=spf1 ip4:17.0.0.0/8 -all",
      {},
      "It lets a very large block of addresses send (ip4:17.0.0.0/8), so senders who aren’t yours may be inside it.",
    ],
    [
      "an IPv6 /16",
      "v=spf1 mx ip6:2001::/16 -all",
      {},
      "It lets a very large block of addresses send (ip6:2001::/16), so senders who aren’t yours may be inside it.",
    ],
    [
      "a /8 in an include",
      "v=spf1 include:big.example -all",
      { "big.example TXT": [["TXT", txt("v=spf1 ip4:17.0.0.0/8 -all")]] },
      "It lets a very large block of addresses send (ip4:17.0.0.0/8 in big.example’s record), so senders who aren’t yours may be inside it.",
    ],
  ] as [string, string, Zone, string][])(
    "%s: partly protected, and SPF is Weak",
    async (_what, record, more, says) => {
      const r = await lookUp({ ...spfIs(record), ...more });
      expect(overall(r)).toBe("partly");
      expect(rowOf(r, "spf")).toMatchObject({ level: "weak", says });
    },
  );

  test("a /9 is an ordinary range", async () => {
    expect(overall(await lookUp(spfIs("v=spf1 ip4:17.0.0.0/9 -all")))).toBe(
      "protected",
    );
  });

  test("the include still counts toward the lookup limit", async () => {
    const r = await lookUp({
      ...spfIs("v=spf1 include:open.example -all"),
      "open.example TXT": [["TXT", txt("v=spf1 +all")]],
    });
    expect(r.spf).toMatchObject({ lookups: 1 });
  });
});

describe("a mistake in the SPF record is broken, never In place (RFC 7208, 4.6)", () => {
  test.each([
    ["v=spf1 incude:_spf.example.net -all", "incude:_spf.example.net"],
    ["v=spf1 ip4:1.2.3 -all", "ip4:1.2.3"],
    ["v=spf1 ip4:1.2.3.4/33 -all", "ip4:1.2.3.4/33"],
    ["v=spf1 ip4: 1.2.3.4 -all", "ip4:"],
    ["v=spf1 a:%{z} -all", "a:%{z}"],
  ])("%s", async (record, term) => {
    const r = await lookUp(spfIs(record));
    expect(overall(r)).toBe("partly");
    expect(rowOf(r, "spf")).toMatchObject({
      level: "broken",
      says: `It has a mistake in it (${term}), so receivers treat it as broken.`,
    });
    expect(rowOf(r, "spf").details).toContain(WORDS.spfDkimOnly);
    expect(rowOf(r, "spf").details.join(" ")).not.toMatch(/lists who may send/);
  });

  test("a record split in two TXT strings that loses its space", async () => {
    const r = await lookUp(
      sound({ [`${D2} TXT`]: [["TXT", txt("v=spf1 mx", "-all")]] }),
    );
    expect(overall(r)).toBe("partly");
    expect(rowOf(r, "spf").says).toBe(
      "It has a mistake in it (mx-all), so receivers treat it as broken.",
    );
  });

  test("a mistake in a record it pulls in", async () => {
    const r = await lookUp({
      ...spfIs("v=spf1 include:a.example -all"),
      "a.example TXT": [["TXT", txt("v=spf1 ip4:192.0.2.300 -all")]],
    });
    expect(overall(r)).toBe("partly");
    expect(rowOf(r, "spf")).toMatchObject({
      level: "broken",
      says: "It pulls in a.example, whose record has a mistake (ip4:192.0.2.300), so receivers treat it as broken.",
    });
  });

  test("a mistake beside +all is still fakeable: some receivers read past it", async () => {
    const r = await lookUp(spfIs("v=spf1 incude:x.example +all"));
    expect(overall(r)).toBe("fakeable");
  });
});

describe("a DKIM key receivers can't use doesn't count", () => {
  test("a key cut short: partly protected, and DKIM is Broken", async () => {
    const r = await lookUp(
      sound({
        [`selector1._domainkey.${D2} TXT`]: [
          ["TXT", txt(`v=DKIM1; k=rsa; p=${RSA_2048.slice(0, 200)}`)],
        ],
      }),
    );
    expect(overall(r)).toBe("partly");
    expect(rowOf(r, "dkim")).toMatchObject({
      level: "broken",
      says: "The key under selector1 isn’t a valid key, so receivers ignore its signatures.",
    });
    expect(rowOf(r, "dkim").details).toContain(
      "selector1: RSA, not a valid key",
    );
  });

  test("p=hello: partly protected", async () => {
    const r = await lookUp(
      sound({
        [`selector1._domainkey.${D2} TXT`]: [
          ["TXT", txt("v=DKIM1; k=rsa; p=hello")],
        ],
      }),
    );
    expect(overall(r)).toBe("partly");
    expect(rowOf(r, "dkim").level).toBe("broken");
  });

  test("k=foo: a kind receivers don't know", async () => {
    const r = await lookUp(
      sound({
        [`selector1._domainkey.${D2} TXT`]: [
          ["TXT", txt(`v=DKIM1; k=foo; p=${RSA_2048}`)],
        ],
      }),
    );
    expect(overall(r)).toBe("partly");
    expect(rowOf(r, "dkim")).toMatchObject({
      level: "broken",
      says: "The key under selector1 is of a kind receivers don’t know (k=foo), so they ignore its signatures.",
    });
  });

  test("a good key beside a broken one: still well protected, the broken one noted", async () => {
    const r = await lookUp(
      sound({
        [`selector2._domainkey.${D2} TXT`]: [["TXT", txt("v=DKIM1; p=hello")]],
      }),
    );
    expect(overall(r)).toBe("protected");
    expect(rowOf(r, "dkim").level).toBe("weak");
  });

  test("an Ed25519 key alone: a note that some services don't check it yet", async () => {
    const ed = Buffer.alloc(32, 7).toString("base64");
    const r = await lookUp(
      sound({
        [`selector1._domainkey.${D2} TXT`]: [
          ["TXT", txt(`v=DKIM1; k=ed25519; p=${ed}`)],
        ],
      }),
    );
    expect(overall(r)).toBe("protected");
    expect(rowOf(r, "dkim").details).toContain(
      "Some large mail services don’t check Ed25519 keys yet; an RSA key beside it covers them.",
    );
  });
});

describe("a DMARC record with a tag that isn't valid (RFC 7489, 6.6.3)", () => {
  test("sp=rejcet with reports: monitoring only, so can be faked", async () => {
    const r = await lookUp(
      sound({
        [`_dmarc.${D2} TXT`]: [
          [
            "TXT",
            txt("v=DMARC1; p=reject; sp=rejcet; rua=mailto:d@example.com"),
          ],
        ],
      }),
    );
    expect(overall(r)).toBe("fakeable");
    expect(rowOf(r, "dmarc")).toMatchObject({
      level: "broken",
      says: "Its DMARC record has a mistake (sp=rejcet), so receivers treat it as monitoring only.",
    });
  });

  test("sp=rejcet without reports: ignored", async () => {
    const r = await lookUp(
      sound({
        [`_dmarc.${D2} TXT`]: [["TXT", txt("v=DMARC1; p=reject; sp=rejcet")]],
      }),
    );
    expect(overall(r)).toBe("fakeable");
    expect(rowOf(r, "dmarc").says).toBe(
      "Its DMARC record has a mistake (sp=rejcet), so receivers ignore it.",
    );
  });

  test("no p= but reports: monitoring only", async () => {
    const r = await lookUp(
      sound({
        [`_dmarc.${D2} TXT`]: [
          ["TXT", txt("v=DMARC1; rua=mailto:d@example.com")],
        ],
      }),
    );
    expect(overall(r)).toBe("fakeable");
    expect(rowOf(r, "dmarc").says).toBe(
      "Its DMARC record has no policy (p=), so receivers treat it as monitoring only.",
    );
  });

  test("v=DMARC1 not first: there, but ignored", async () => {
    const r = await lookUp(
      sound({ [`_dmarc.${D2} TXT`]: [["TXT", txt("p=reject; v=DMARC1")]] }),
    );
    expect(overall(r)).toBe("fakeable");
    expect(rowOf(r, "dmarc")).toMatchObject({
      level: "broken",
      says: "A DMARC record is there, but it doesn’t start with v=DMARC1, so receivers ignore it.",
    });
  });

  test("an empty pct= is 100, not 0", async () => {
    const r = await lookUp(
      sound({
        [`_dmarc.${D2} TXT`]: [["TXT", txt("v=DMARC1; p=quarantine; pct=")]],
      }),
    );
    expect(overall(r)).toBe("protected");
    expect(rowOf(r, "dmarc").says).toBe("Fakes go to spam (p=quarantine).");
  });

  test.each([
    [
      "p=reject; pct=0",
      "partly",
      "None of the fakes are rejected (pct=0): they all go to spam instead.",
    ],
    [
      "p=quarantine; pct=0",
      "fakeable",
      "None of the fakes go to spam (pct=0): they’re all delivered as usual.",
    ],
  ])("%s", async (tags, verdict, says) => {
    const r = await lookUp(
      sound({ [`_dmarc.${D2} TXT`]: [["TXT", txt(`v=DMARC1; ${tags}`)]] }),
    );
    expect(overall(r)).toBe(verdict);
    expect(rowOf(r, "dmarc").says).toBe(says);
  });
});

describe("SPF records that name nobody", () => {
  test("v=spf1 alone names nobody: partly protected, like no SPF record", async () => {
    const r = await lookUp(spfIs("v=spf1"));
    expect(overall(r)).toBe("partly");
    expect(rowOf(r, "spf")).toMatchObject({
      level: "missing",
      says: "It names nobody who may send, so it works like having no SPF record.",
    });
    expect(rowOf(r, "spf").details).toContain(WORDS.spfDkimOnly);
  });

  test("v=spf1 -all says nobody sends", async () => {
    const r = await lookUp({
      ...spfIs("v=spf1 -all"),
      [`${D2} MX`]: [["MX", "0 ."]],
      [`selector1._domainkey.${D2} TXT`]: [],
    });
    expect(overall(r)).toBe("parked");
    expect(rowOf(r, "spf")).toMatchObject({
      level: "good",
      says: "It says nobody sends mail as this domain (-all).",
    });
  });
});

describe("checks SPF and MX make on themselves", () => {
  test("a null MX beside real servers is Weak (RFC 7505, 3)", async () => {
    const r = await lookUp(
      sound({
        [`${D2} MX`]: [
          ["MX", "0 ."],
          ["MX", "10 mx.example.net."],
        ],
      }),
    );
    expect(rowOf(r, "mx")).toMatchObject({
      level: "weak",
      says: "It also says it receives no mail (a null MX), which contradicts its servers, so some senders may not deliver to it.",
    });
  });

  test("mx over more than 10 mail servers is broken (RFC 7208, 4.6.4)", async () => {
    const r = await lookUp(
      sound({
        [`${D2} MX`]: Array.from(
          { length: 11 },
          (_, i) => ["MX", `${i} mx${i}.example.net.`] as ["MX", string],
        ),
      }),
    );
    expect(overall(r)).toBe("partly");
    expect(rowOf(r, "spf")).toMatchObject({
      level: "broken",
      says: "It lets the domain’s mail servers send (mx), but there are 11 of them, more than 10, so receivers treat it as broken.",
    });
  });

  test("an include with two SPF records is broken", async () => {
    const r = await lookUp({
      ...spfIs("v=spf1 include:a.example -all"),
      "a.example TXT": [
        ["TXT", txt("v=spf1 ip4:192.0.2.1 -all")],
        ["TXT", txt("v=spf1 +all")],
      ],
    });
    expect(overall(r)).toBe("partly");
    expect(rowOf(r, "spf")).toMatchObject({
      level: "broken",
      says: "It pulls in a.example, which has more than one SPF record, so receivers treat it as broken.",
    });
  });
});
