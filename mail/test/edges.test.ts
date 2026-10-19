// The edges: lookups that don't answer, the DMARC tree walk, SPF counted
// the way receivers count it, and verdicts that never claim more than the
// records show.
import { Window } from "happy-dom";
import { describe, expect, test, vi } from "vitest";
import { analyze, dmarcNames } from "../src/analyze";
import { verdictUnchecked, VERDICT, WORDS } from "../src/copy";
import { DnsError, doh, type Resolve } from "../src/dns";
import type { Report } from "../src/model";
import { normalizeDomain } from "../src/normalize";
import { dmarcOf } from "../src/records";
import { renderReport } from "../src/render";
import { rows } from "../src/rows";
import { overall } from "../src/verdict";
import { stub, txt, type Zone } from "./stub";

const D = "example.com";
// A made-up Ed25519 public key: 32 bytes.
const ED = Buffer.alloc(32, 7).toString("base64");
const base = (more: Zone = {}): Zone => ({
  [`${D} MX`]: [["MX", "10 mx.example.net."]],
  [`${D} TXT`]: [["TXT", txt("v=spf1 ip4:192.0.2.0/24 -all")]],
  [`_dmarc.${D} TXT`]: [["TXT", txt("v=DMARC1; p=reject")]],
  [`google._domainkey.${D} TXT`]: [["TXT", txt(`v=DKIM1; k=ed25519; p=${ED}`)]],
  ...more,
});

/** A resolver that fails for the questions given, as the resolver says
 * SERVFAIL or times out. */
const failing = (zone: Zone, bad: string[]): Resolve => {
  const { resolve } = stub(zone);
  return (name, type) =>
    bad.includes(`${name} ${type}`)
      ? Promise.reject(new DnsError("SERVFAIL"))
      : resolve(name, type);
};

const report = async (resolve: Resolve, domain = D): Promise<Report> => {
  const r = await analyze(domain, resolve);
  if ("missing" in r) throw new Error("missing");
  return r;
};
const row = (r: Report, id: string) => {
  const found = rows(r).find((x) => x.id === id);
  if (!found) throw new Error(id);
  return found;
};

/** The verdict line as the page writes it. */
const verdictLine = (r: Report) => {
  const window = new Window();
  const line = renderReport(window.document as unknown as Document, r).verdict;
  void window.happyDOM.close();
  return line;
};

describe("a lookup that doesn't answer is unchecked, never missing", () => {
  test("_dmarc SERVFAIL: Couldn’t check, and so is the verdict", async () => {
    const r = await report(failing(base(), [`_dmarc.${D} TXT`]));
    expect(r.dmarc).toEqual({ kind: "unchecked" });
    expect(overall(r)).toBe("unchecked");
    expect(row(r, "dmarc")).toMatchObject({
      level: "unchecked",
      word: "Couldn’t check",
    });
    expect(verdictLine(r)).toBe(
      "Couldn’t check everything: the DMARC policy didn’t answer, so this can’t say how well mail from this domain is protected.",
    );
  });

  test("the domain's own TXT failing: the SPF record is unchecked", async () => {
    const r = await report(failing(base(), [`${D} TXT`]));
    expect(r.spf).toEqual({ kind: "unchecked" });
    expect(row(r, "spf").level).toBe("unchecked");
    expect(verdictLine(r)).toBe(verdictUnchecked(["spf"]));
  });

  test("DKIM, MTA-STS and TLS reporting failing are notes", async () => {
    const r = await report(
      failing(base(), [
        `k1._domainkey.${D} TXT`,
        `_mta-sts.${D} TXT`,
        `_smtp._tls.${D} TXT`,
      ]),
    );
    expect(r.dkimUnchecked).toBe(1);
    expect(row(r, "dkim").details).toContain(
      "Couldn’t check one of the common names.",
    );
    expect(row(r, "extras").details).toEqual([
      "Couldn’t check MTA-STS.",
      "Couldn’t check TLS reporting.",
    ]);
    expect(overall(r)).toBe("protected");
  });

  test("a truncated answer (TC) didn't answer", async () => {
    const tc: typeof fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ Status: 0, TC: true, Answer: [] })),
      );
    await expect(doh(tc)("example.com", "TXT")).rejects.toBeInstanceOf(
      DnsError,
    );
  });
});

describe("DMARC: the tree walk", () => {
  test("a subdomain follows its organisation's policy", async () => {
    const zone = base({
      [`news.${D} MX`]: [["MX", "10 mx.example.net."]],
      [`news.${D} TXT`]: [["TXT", txt("v=spf1 -all")]],
      [`google._domainkey.news.${D} TXT`]: [
        ["TXT", txt(`v=DKIM1; k=ed25519; p=${ED}`)],
      ],
    });
    const r = await report(stub(zone).resolve, `news.${D}`);
    expect(r.dmarc).toMatchObject({ kind: "one", from: D, policy: "reject" });
    expect(row(r, "dmarc").details[0]).toBe("It follows example.com’s policy.");
    expect(overall(r)).toBe("protected");
  });

  test("sp= is the policy a parent's record sets for its subdomains", () => {
    expect(
      dmarcOf(["v=DMARC1; p=reject; sp=quarantine"], D, true),
    ).toMatchObject({ policy: "quarantine" });
  });

  test("the names asked: the domain, then each parent, never the TLD", () => {
    expect(dmarcNames("a.b.example.co.uk")).toEqual([
      "a.b.example.co.uk",
      "b.example.co.uk",
      "example.co.uk",
      "co.uk",
    ]);
    expect(dmarcNames("example.com")).toEqual(["example.com"]);
  });

  test("a long name skips to its last seven labels, and still reaches its organisation", () => {
    const names = dmarcNames("1.2.3.4.5.6.7.8.9.10.example.com");
    expect(names).toEqual([
      "1.2.3.4.5.6.7.8.9.10.example.com",
      "6.7.8.9.10.example.com",
      "7.8.9.10.example.com",
      "8.9.10.example.com",
      "9.10.example.com",
      "10.example.com",
      "example.com",
    ]);
  });

  test("a name that didn't answer before the first record leaves it unchecked", async () => {
    const zone = base({
      [`news.${D} MX`]: [["MX", "10 mx.example.net."]],
      [`news.${D} TXT`]: [["TXT", txt("v=spf1 -all")]],
    });
    const r = await report(
      failing(zone, [`_dmarc.news.${D} TXT`]),
      `news.${D}`,
    );
    expect(r.dmarc).toEqual({ kind: "unchecked" });
  });

  test("spaces around = are allowed", () => {
    expect(dmarcOf(["v = DMARC1; p = reject"], D)).toMatchObject({
      kind: "one",
      policy: "reject",
    });
  });
});

describe("SPF, counted as receivers count it", () => {
  // c costs five lookups.
  const C =
    "v=spf1 a:1.example a:2.example a:3.example a:4.example a:5.example -all";

  test("a name met twice counts twice: the diamond is 14, and broken", async () => {
    const r = await report(
      stub(
        base({
          [`${D} TXT`]: [
            ["TXT", txt("v=spf1 include:a.example include:b.example -all")],
          ],
          "a.example TXT": [["TXT", txt("v=spf1 include:c.example -all")]],
          "b.example TXT": [["TXT", txt("v=spf1 include:c.example -all")]],
          "c.example TXT": [["TXT", txt(C)]],
        }),
      ).resolve,
    );
    expect(r.spf).toMatchObject({ lookups: 14, loop: false });
    expect(row(r, "spf")).toMatchObject({ level: "broken" });
    expect(row(r, "spf").says).toMatch(/14 DNS lookups/);
    expect(overall(r)).toBe("partly");
  });

  test("an include loop is broken", async () => {
    const r = await report(
      stub(
        base({
          [`${D} TXT`]: [["TXT", txt("v=spf1 include:a.example -all")]],
          "a.example TXT": [["TXT", txt("v=spf1 include:b.example -all")]],
          "b.example TXT": [["TXT", txt("v=spf1 include:a.example -all")]],
        }),
      ).resolve,
    );
    expect(r.spf).toMatchObject({ loop: true });
    expect(row(r, "spf").level).toBe("broken");
    expect(overall(r)).toBe("partly");
  });

  test("a redirect beside an all isn't followed", async () => {
    const { resolve, asked } = stub(
      base({
        [`${D} TXT`]: [
          ["TXT", txt("v=spf1 ip4:192.0.2.1 redirect=_spf.example.net -all")],
        ],
        "_spf.example.net TXT": [
          [
            "TXT",
            txt(
              `v=spf1 ${Array.from({ length: 10 }, (_, i) => `a:h${i}.example`).join(" ")} -all`,
            ),
          ],
        ],
      }),
    );
    const r = await report(resolve);
    expect(r.spf).toMatchObject({ lookups: 0, all: "-" });
    expect(asked).not.toContain("_spf.example.net TXT");
    expect(row(r, "spf").level).toBe("good");
  });

  // A made-up domain whose record only redirects, to a record that pulls
  // in three more: names kept for examples (RFC 2606), addresses kept for
  // documentation (RFC 5737, RFC 3849).
  const G = "example.org";
  const chain = (more: Zone = {}): Zone => ({
    [`${G} MX`]: [["MX", "5 mx.example.net."]],
    [`${G} TXT`]: [["TXT", txt("v=spf1 redirect=_spf.example.net")]],
    "_spf.example.net TXT": [
      [
        "TXT",
        txt(
          "v=spf1 include:_blocks1.example.net include:_blocks2.example.net include:_blocks3.example.net ~all",
        ),
      ],
    ],
    "_blocks1.example.net TXT": [
      ["TXT", txt("v=spf1 ip4:192.0.2.0/24 ip4:198.51.100.0/24 ~all")],
    ],
    "_blocks2.example.net TXT": [
      ["TXT", txt("v=spf1 ip6:2001:db8:4000::/36 ~all")],
    ],
    "_blocks3.example.net TXT": [
      ["TXT", txt("v=spf1 ip4:203.0.113.0/24 ~all")],
    ],
    [`_dmarc.${G} TXT`]: [
      ["TXT", txt("v=DMARC1; p=none; sp=quarantine; rua=mailto:x@example.org")],
    ],
    ...more,
  });

  test("a record that only redirects takes the target's last word: ~all", async () => {
    const r = await report(stub(chain()).resolve, G);
    expect(r.spf).toMatchObject({
      all: "~",
      allFrom: "_spf.example.net",
      lookups: 4,
      unchecked: [],
    });
    expect(row(r, "spf")).toMatchObject({
      level: "good",
      word: "In place",
      says: "It lists who may send, and asks receivers to mark anyone else as suspicious (~all).",
    });
    expect(row(r, "spf").details).toContain(
      "Its last word comes from _spf.example.net, which it redirects to.",
    );
    expect(row(r, "spf").details).toContain("4 of 10 DNS lookups.");
  });

  test("its redirect timing out: at least 1, never a silent count", async () => {
    const r = await report(failing(chain(), ["_spf.example.net TXT"]), G);
    expect(r.spf).toMatchObject({
      all: null,
      lookups: 1,
      unchecked: ["_spf.example.net"],
    });
    const spf = row(r, "spf");
    expect(spf).toMatchObject({
      level: "unchecked",
      says: "Couldn’t check _spf.example.net, so it takes at least 1 of 10 DNS lookups, maybe more.",
    });
    // Its last word is unknown, not missing.
    expect([spf.says, ...spf.details].join(" ")).not.toMatch(
      /doesn’t say what to do/,
    );
    expect(spf.details).not.toContain("1 of 10 DNS lookups.");
  });

  test("+all reached through a redirect is unsafe", async () => {
    const r = await report(
      stub(
        base({
          [`${D} TXT`]: [["TXT", txt("v=spf1 redirect=_spf.example.net")]],
          "_spf.example.net TXT": [["TXT", txt("v=spf1 +all")]],
        }),
      ).resolve,
    );
    expect(row(r, "spf").level).toBe("unsafe");
    expect(overall(r)).toBe("fakeable");
  });

  test("an include that didn't answer: at least N, and unchecked", async () => {
    const r = await report(
      failing(
        base({
          [`${D} TXT`]: [["TXT", txt("v=spf1 include:a.example -all")]],
        }),
        ["a.example TXT"],
      ),
    );
    expect(r.spf).toMatchObject({ lookups: 1, unchecked: ["a.example"] });
    expect(row(r, "spf")).toMatchObject({ level: "unchecked" });
    expect(row(r, "spf").says).toBe(
      "Couldn’t check a.example, so it takes at least 1 of 10 DNS lookups, maybe more.",
    );
    expect(verdictLine(r)).toBe(verdictUnchecked(["spfPart"]));
  });
});

// A 1024-bit RSA key, as SubjectPublicKeyInfo.
const RSA_1024 =
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDwIRP/UC3SBsEmGqZ9ZJW3/DkMoGeLnQg1fWn7/zYtIxN2SnFCjxOCKG9v3b4jYfcTNh5ijSsq631uBItLa7od+v/RtdC2UzJ1lWT947qR+Rcac2gbto/NMqJ0fzfVjH4OuKhitdY9tf6mcwGjaNBcWToIMmPSPDdQPNUYckcQ2QIDAQAB";

describe("the verdict never claims more than the records show", () => {
  test.each([
    [
      "pct below 100",
      { [`_dmarc.${D} TXT`]: [["TXT", txt("v=DMARC1; p=quarantine; pct=50")]] },
    ],
    [
      "subdomains left open",
      { [`_dmarc.${D} TXT`]: [["TXT", txt("v=DMARC1; p=reject; sp=none")]] },
    ],
    [
      "a 1024-bit RSA key",
      {
        [`google._domainkey.${D} TXT`]: [
          ["TXT", txt(`v=DKIM1; k=rsa; p=${RSA_1024}`)],
        ],
      },
    ],
    [
      "pct=50 and a 1024-bit key together",
      {
        [`_dmarc.${D} TXT`]: [["TXT", txt("v=DMARC1; p=quarantine; pct=50")]],
        [`google._domainkey.${D} TXT`]: [
          ["TXT", txt(`v=DKIM1; k=rsa; p=${RSA_1024}`)],
        ],
      },
    ],
  ] as [string, Zone][])("%s: partly protected", async (_what, more) => {
    const r = await report(stub(base(more)).resolve);
    expect(overall(r)).toBe("partly");
    expect(verdictLine(r)).toBe(VERDICT.partly);
  });

  test("sp=none under p=reject makes the DMARC row Weak", async () => {
    const r = await report(
      stub(
        base({
          [`_dmarc.${D} TXT`]: [["TXT", txt("v=DMARC1; p=reject; sp=none")]],
        }),
      ).resolve,
    );
    expect(row(r, "dmarc").level).toBe("weak");
    expect(row(r, "dmarc").says).toMatch(/sp=none/);
    expect(row(r, "dmarc").details).toContain("Fakes are rejected (p=reject).");
  });

  test("everything in place: well protected", async () => {
    const r = await report(stub(base()).resolve);
    expect(overall(r)).toBe("protected");
  });
});

describe("what people type", () => {
  test("a mail program's “Name <address>”", () => {
    expect(normalizeDomain("John Doe <john@example.com>")).toBe("example.com");
    expect(normalizeDomain("<john@example.com>")).toBe("example.com");
  });
});

describe("what's known stays known", () => {
  // _dmarc doesn't answer, but SPF alone shows anyone can send as the
  // domain.
  test("_dmarc SERVFAIL and SPF lets anyone send (+all): can be faked", async () => {
    const r = await report(
      failing(base({ [`${D} TXT`]: [["TXT", txt("v=spf1 +all")]] }), [
        `_dmarc.${D} TXT`,
      ]),
    );
    expect(r.dmarc).toEqual({ kind: "unchecked" });
    expect(overall(r)).toBe("fakeable");
    expect(verdictLine(r)).toBe(VERDICT.fakeable);
  });

  // Without SPF, or with two records, it all turns on DMARC: a policy
  // that stops fakes would stop them, so the verdict waits for it.
  test.each([
    ["no SPF record", [["TXT", txt("v=foo")]]],
    [
      "two SPF records",
      [
        ["TXT", txt("v=spf1 -all")],
        ["TXT", txt("v=spf1 ~all")],
      ],
    ],
  ] as [string, Zone[string]][])(
    "_dmarc SERVFAIL and %s: couldn't check",
    async (_what, spf) => {
      const r = await report(
        failing(base({ [`${D} TXT`]: spf }), [`_dmarc.${D} TXT`]),
      );
      expect(r.dmarc).toEqual({ kind: "unchecked" });
      expect(overall(r)).toBe("unchecked");
      expect(verdictLine(r)).toBe(verdictUnchecked(["dmarc"]));
    },
  );

  test("the mail servers' aliases are asked while SPF is still being counted", async () => {
    const { resolve: answer, asked } = stub(
      base({
        [`${D} TXT`]: [["TXT", txt("v=spf1 include:a.example -all")]],
        "a.example TXT": [["TXT", txt("v=spf1 -all")]],
      }),
    );
    let release = () => {};
    const gate = new Promise<void>((go) => (release = go));
    // The include answers only once it's let through.
    const resolve: Resolve = async (name, type) => {
      if (name === "a.example") await gate;
      return answer(name, type);
    };
    const pending = analyze(D, resolve);
    try {
      await vi.waitFor(() => expect(asked).toContain("mx.example.net CNAME"));
      expect(asked).not.toContain("a.example TXT");
    } finally {
      release();
    }
    const r = await pending;
    expect("missing" in r).toBe(false);
  });

  test("a redirect to a name with no SPF record is broken", async () => {
    const r = await report(
      stub(base({ [`${D} TXT`]: [["TXT", txt("v=spf1 redirect=b.example")]] }))
        .resolve,
    );
    expect(r.spf).toMatchObject({
      emptyRedirect: "b.example",
      all: null,
      allFrom: null,
    });
    const spf = row(r, "spf");
    expect(spf).toMatchObject({
      level: "broken",
      word: "Broken",
      says: "It redirects to b.example, which has no SPF record, so receivers treat it as broken.",
    });
    expect(spf.details.join(" ")).not.toMatch(/last word comes from/);
    expect(spf.details.join(" ")).not.toMatch(/doesn’t say what to do/);
    expect(overall(r)).toBe("partly");
    expect(verdictLine(r)).toBe(VERDICT.partly);
  });

  test("a redirect loop names no record as the last word", async () => {
    const r = await report(
      stub(
        base({
          [`${D} TXT`]: [["TXT", txt("v=spf1 redirect=b.example")]],
          "b.example TXT": [["TXT", txt(`v=spf1 redirect=${D}`)]],
        }),
      ).resolve,
    );
    expect(r.spf).toMatchObject({ loop: true, all: null, allFrom: null });
    const spf = row(r, "spf");
    expect(spf.level).toBe("broken");
    expect(spf.details.join(" ")).not.toMatch(/last word comes from/);
    expect(overall(r)).toBe("partly");
  });

  test("a redirect whose target has no all: its last word isn't credited to it", async () => {
    const r = await report(
      stub(
        base({
          [`${D} TXT`]: [["TXT", txt("v=spf1 redirect=b.example")]],
          "b.example TXT": [["TXT", txt("v=spf1 ip4:192.0.2.1")]],
        }),
      ).resolve,
    );
    expect(r.spf).toMatchObject({ all: null, allFrom: null });
    const spf = row(r, "spf");
    expect(spf.level).toBe("weak");
    expect(spf.details.join(" ")).not.toMatch(/last word comes from/);
  });
});

describe("an include with no SPF record is broken, not unchecked", () => {
  test("at the top level", async () => {
    const r = await report(
      stub(
        base({ [`${D} TXT`]: [["TXT", txt("v=spf1 include:b.example -all")]] }),
      ).resolve,
    );
    expect(r.spf).toMatchObject({ emptyInclude: "b.example", unchecked: [] });
    expect(row(r, "spf")).toMatchObject({
      level: "broken",
      word: "Broken",
      says: "It includes b.example, which has no SPF record, so receivers treat it as broken.",
    });
    expect(overall(r)).toBe("partly");
    expect(verdictLine(r)).toBe(VERDICT.partly);
  });

  test("two levels down", async () => {
    const r = await report(
      stub(
        base({
          [`${D} TXT`]: [["TXT", txt("v=spf1 include:a.example -all")]],
          "a.example TXT": [["TXT", txt("v=spf1 include:b.example -all")]],
          "b.example TXT": [["TXT", txt("v=spf1 include:c.example -all")]],
          // c.example answers, with no SPF record among its TXT records.
          "c.example TXT": [["TXT", txt("google-site-verification=abc")]],
        }),
      ).resolve,
    );
    expect(r.spf).toMatchObject({ emptyInclude: "c.example", lookups: 3 });
    expect(row(r, "spf").level).toBe("broken");
    expect(row(r, "spf").says).toBe(
      "It includes c.example, which has no SPF record, so receivers treat it as broken.",
    );
    expect(overall(r)).toBe("partly");
  });

  test("a timeout and an empty answer, side by side", async () => {
    const zone = base({
      [`${D} TXT`]: [
        ["TXT", txt("v=spf1 include:slow.example include:empty.example -all")],
      ],
    });
    const r = await report(failing(zone, ["slow.example TXT"]));
    // The empty answer is known: broken. The timeout stays unchecked.
    expect(r.spf).toMatchObject({
      emptyInclude: "empty.example",
      unchecked: ["slow.example"],
      lookups: 2,
    });
    const spf = row(r, "spf");
    expect(spf.level).toBe("broken");
    expect(spf.says).toBe(
      "It includes empty.example, which has no SPF record, so receivers treat it as broken.",
    );
    expect(spf.details).toContain(
      "Couldn’t check slow.example, so it takes at least 2 of 10 DNS lookups, maybe more.",
    );
    // Broken is known whatever slow.example says, so the verdict doesn't
    // wait on it.
    expect(overall(r)).toBe("partly");

    // Each alone: the timeout is couldn't-check, the empty answer broken.
    const slow = await report(
      failing(
        base({
          [`${D} TXT`]: [["TXT", txt("v=spf1 include:slow.example -all")]],
        }),
        ["slow.example TXT"],
      ),
    );
    expect(slow.spf).toMatchObject({ emptyInclude: null });
    expect(row(slow, "spf").level).toBe("unchecked");
    expect(verdictLine(slow)).toBe(verdictUnchecked(["spfPart"]));
  });
});

describe("an include or redirect whose name depends on the sender", () => {
  // Valimail's, as published.
  const VALIMAIL = "include:%{i}._ip.%{h}._ehlo.%{d}._spf.vali.email";

  test("isn't looked up, still costs its lookup, and isn't broken", async () => {
    const { resolve, asked } = stub(
      base({ [`${D} TXT`]: [["TXT", txt(`v=spf1 ${VALIMAIL} ~all`)]] }),
    );
    const r = await report(resolve);
    expect(asked.some((q) => q.includes("%"))).toBe(false);
    expect(r.spf).toMatchObject({
      lookups: 1,
      unchecked: [],
      emptyInclude: null,
      macros: [VALIMAIL],
      senders: true,
    });
    const spf = row(r, "spf");
    expect(spf.level).toBe("good");
    expect(spf.details).toContain(
      `${VALIMAIL} depends on who’s sending, so this page can’t tell who that part lets send.`,
    );
    expect(overall(r)).toBe("protected");
    expect(verdictLine(r)).toBe(VERDICT.protected);
  });

  test("a redirect: its last word is unknown, not missing", async () => {
    const { resolve, asked } = stub(
      base({
        [`${D} TXT`]: [["TXT", txt("v=spf1 redirect=%{d}._spf.example")]],
      }),
    );
    const r = await report(resolve);
    expect(asked.some((q) => q.includes("%"))).toBe(false);
    expect(r.spf).toMatchObject({
      lookups: 1,
      emptyRedirect: null,
      macros: ["redirect=%{d}._spf.example"],
    });
    const spf = row(r, "spf");
    expect(spf.level).toBe("info");
    expect(spf.says).toBe(
      "redirect=%{d}._spf.example depends on who’s sending, so this page can’t tell who that part lets send.",
    );
    expect(overall(r)).not.toBe("unchecked");
  });

  test("an included record's redirect: the last word is still the record's own", async () => {
    const zone = (b: string) =>
      base({
        [`${D} TXT`]: [
          ["TXT", txt("v=spf1 include:a.example redirect=b.example")],
        ],
        "a.example TXT": [
          ["TXT", txt("v=spf1 ip4:192.0.2.1 redirect=%{d}.x.example")],
        ],
        "b.example TXT": [["TXT", txt(b)]],
      });
    const r = await report(stub(zone("v=spf1 ip4:192.0.2.2 -all")).resolve);
    expect(r.spf).toMatchObject({
      all: "-",
      allFrom: "b.example",
      macros: ["redirect=%{d}.x.example"],
      redirectUnknown: false,
    });
    expect(row(r, "spf").says).toBe(WORDS.spfAll["-"]);
    // With no last word at the end of the redirect, there's none: known,
    // not left unknown for the included record's macro.
    const none = await report(stub(zone("v=spf1 ip4:192.0.2.2")).resolve);
    expect(none.spf).toMatchObject({ all: null, redirectUnknown: false });
    expect(row(none, "spf").says).toBe(WORDS.spfAll.none);
  });

  test("an include that didn't answer: the redirect's last word still holds", async () => {
    const zone = base({
      [`${D} TXT`]: [
        ["TXT", txt("v=spf1 include:a.example redirect=b.example")],
      ],
      "b.example TXT": [["TXT", txt("v=spf1 ip4:192.0.2.2")]],
    });
    const r = await report(failing(zone, ["a.example TXT"]));
    expect(r.spf).toMatchObject({
      all: null,
      unchecked: ["a.example"],
      redirectUnknown: false,
    });
    // The include that didn't answer keeps its own line, and the last word
    // is there beside it.
    const spf = row(r, "spf");
    expect(spf.says).toBe(WORDS.spfUncheckedPart(["a.example"], 2));
    expect(spf.details).toContain(WORDS.spfAll.none);
  });
});
