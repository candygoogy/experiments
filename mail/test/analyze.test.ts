import { describe, expect, test } from "vitest";
import { analyze, SELECTORS } from "../src/analyze";
import { DnsError, type Resolve } from "../src/dns";
import { stub, txt } from "./stub";

const D = "example.net";

describe("a whole domain", () => {
  test("every record read into the report", async () => {
    const { resolve } = stub(
      {
        [`${D} MX`]: [
          ["MX", "10 in1.mail.example.com."],
          ["MX", "20 in2.mail.example.com."],
        ],
        [`${D} TXT`]: [
          ["TXT", txt("google-site-verification=abc")],
          ["TXT", txt("v=spf1 include:spf.mail.example.com ?all")],
        ],
        "spf.mail.example.com TXT": [
          [
            "TXT",
            txt("v=spf1 ip4:192.0.2.0/24 include:more.mail.example.com -all"),
          ],
        ],
        "more.mail.example.com TXT": [["TXT", txt("v=spf1 a -all")]],
        [`_dmarc.${D} TXT`]: [
          ["TXT", txt("v=DMARC1; p=none; rua=mailto:r@example.net")],
        ],
        [`fm1._domainkey.${D} TXT`]: [
          ["CNAME", "fm1.example.net.dkim.example.com."],
          [
            "TXT",
            txt(
              "v=DKIM1; k=ed25519; p=",
              "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            ),
          ],
        ],
        [`_mta-sts.${D} TXT`]: [["TXT", txt("v=STSv1; id=1")]],
        [`_smtp._tls.${D} TXT`]: [
          ["TXT", txt("v=TLSRPTv1; rua=mailto:t@example.net")],
        ],
        "in1.mail.example.com CNAME": [],
        "in2.mail.example.com CNAME": [["CNAME", "elsewhere.example.com."]],
      },
      { ad: true },
    );
    expect(await analyze(D, resolve)).toEqual({
      domain: D,
      mx: {
        kind: "hosts",
        hosts: [
          { host: "in1.mail.example.com", preference: 10, alias: false },
          { host: "in2.mail.example.com", preference: 20, alias: true },
        ],
        nullToo: false,
      },
      spf: {
        kind: "one",
        record: "v=spf1 include:spf.mail.example.com ?all",
        all: "?",
        allFrom: null,
        lookups: 3,
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
          selector: "fm1",
          keyType: "ed25519",
          bits: 256,
          revoked: false,
          unusable: null,
        },
      ],
      dkimUnchecked: 0,
      dmarc: {
        kind: "one",
        from: D,
        policy: "none",
        subdomains: null,
        pct: 100,
        reports: true,
        invalid: null,
      },
      mtaSts: true,
      tlsRpt: true,
      dnssec: true,
    });
  });

  test("asks every common DKIM name, as the spec lists them", async () => {
    const { resolve, asked } = stub({});
    await analyze(D, resolve);
    for (const s of [
      "default",
      "dkim",
      "google",
      "selector1",
      "selector2",
      "fm1",
      "fm2",
      "fm3",
      "k1",
      "k2",
      "k3",
      "s1",
      "s2",
      "mail",
      "zoho",
      "protonmail",
      "protonmail2",
      "protonmail3",
      "mxvault",
    ]) {
      expect(SELECTORS).toContain(s);
      expect(asked).toContain(`${s}._domainkey.${D} TXT`);
    }
  });

  test("nothing at all: every check missing, nothing breaks", async () => {
    const { resolve } = stub({});
    expect(await analyze(D, resolve)).toMatchObject({
      mx: { kind: "none" },
      spf: { kind: "none" },
      dkim: [],
      dmarc: { kind: "none" },
      mtaSts: false,
      tlsRpt: false,
      dnssec: false,
    });
  });

  test("a domain that doesn't exist", async () => {
    const { resolve } = stub({}, { nxdomain: true });
    expect(await analyze(D, resolve)).toEqual({ missing: true });
  });

  test("both of the domain's own questions failing is an error; one failing is unchecked, never missing", async () => {
    const failing = (bad: string): Resolve => {
      const { resolve } = stub({ [`${D} MX`]: [["MX", "10 mx.example.net."]] });
      return (name, type) =>
        `${name} ${type}` === bad
          ? Promise.reject(new DnsError("down"))
          : resolve(name, type);
    };
    await expect(analyze(D, failing(`${D} MX`))).resolves.toMatchObject({
      mx: { kind: "unchecked" },
    });
    await expect(analyze(D, failing(`${D} TXT`))).resolves.toMatchObject({
      spf: { kind: "unchecked" },
    });
    await expect(
      analyze(D, failing(`k1._domainkey.${D} TXT`)),
    ).resolves.toMatchObject({
      mx: { kind: "hosts" },
      dkimUnchecked: 1,
    });
    const both: Resolve = (name, type) =>
      name === D
        ? Promise.reject(new DnsError("down"))
        : stub({}).resolve(name, type);
    await expect(analyze(D, both)).rejects.toBeInstanceOf(DnsError);
  });
});

describe("SPF lookups, counted through include and redirect", () => {
  const spfOf = async (zone: Parameters<typeof stub>[0]) => {
    const { resolve } = stub(zone);
    return (await analyze(D, resolve)).valueOf();
  };

  test("a loop ends, and is broken", async () => {
    const r = await spfOf({
      [`${D} TXT`]: [["TXT", txt("v=spf1 include:a.example.net -all")]],
      "a.example.net TXT": [["TXT", txt("v=spf1 include:b.example.net -all")]],
      "b.example.net TXT": [["TXT", txt("v=spf1 include:a.example.net -all")]],
    });
    expect(r).toMatchObject({ spf: { lookups: 3, loop: true } });
  });

  test("past ten, it says how many", async () => {
    const zone: Parameters<typeof stub>[0] = {
      [`${D} TXT`]: [
        [
          "TXT",
          txt(
            `v=spf1 ${Array.from({ length: 6 }, (_, i) => `include:i${i}.example.net`).join(" ")} -all`,
          ),
        ],
      ],
    };
    for (let i = 0; i < 6; i++)
      zone[`i${i}.example.net TXT`] = [["TXT", txt("v=spf1 a mx -all")]];
    expect(await spfOf(zone)).toMatchObject({ spf: { lookups: 18 } });
  });

  test("an include with no SPF still costs its lookup", async () => {
    expect(
      await spfOf({
        [`${D} TXT`]: [["TXT", txt("v=spf1 include:gone.example.net -all")]],
      }),
    ).toMatchObject({ spf: { lookups: 1 } });
  });

  test("two SPF records are invalid", async () => {
    expect(
      await spfOf({
        [`${D} TXT`]: [
          ["TXT", txt("v=spf1 -all")],
          ["TXT", txt("v=spf1 ~all")],
        ],
      }),
    ).toMatchObject({ spf: { kind: "many", count: 2 } });
  });
});
