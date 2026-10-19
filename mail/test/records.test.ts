import { generateKeyPairSync } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  dkimKey,
  dmarcOf,
  mxOf,
  parseSpf,
  spfTerms,
  txtValue,
} from "../src/records";
import { txt } from "./stub";

describe("TXT values", () => {
  test("quoted, and joined when split", () => {
    expect(txtValue(txt("v=spf1 -all"))).toBe("v=spf1 -all");
    expect(txtValue(txt("v=DKIM1; k=rsa; p=AAA", "BBB"))).toBe(
      "v=DKIM1; k=rsa; p=AAABBB",
    );
    expect(txtValue('"say \\"hi\\""')).toBe('say "hi"');
    expect(txtValue("bare")).toBe("bare");
  });

  test("a backslash and three digits is that byte (RFC 1035, 5.1)", () => {
    expect(txtValue('"v=DMARC1\\059 p=reject"')).toBe("v=DMARC1; p=reject");
    // An escaped backslash before digits leaves the digits as they are.
    expect(txtValue('"a\\\\059"')).toBe("a\\059");
  });

  test("bytes read as UTF-8; a number past 255 stays as written", () => {
    expect(txtValue('"n=caf\\195\\169"')).toBe("n=café");
    // Split between two strings, the character is still one.
    expect(txtValue('"caf\\195" "\\169"')).toBe("café");
    expect(txtValue('"a\\300b"')).toBe("a\\300b");
  });
});

describe("MX", () => {
  test("hosts by preference, trailing dots gone", () => {
    expect(
      mxOf(["20 in2-smtp.example.net.", "10 in1-smtp.example.net."]),
    ).toEqual({
      kind: "hosts",
      hosts: [
        { host: "in1-smtp.example.net", preference: 10, alias: false },
        { host: "in2-smtp.example.net", preference: 20, alias: false },
      ],
      nullToo: false,
    });
  });

  test("none, and the null MX", () => {
    expect(mxOf([])).toEqual({ kind: "none" });
    expect(mxOf(["0 ."])).toEqual({ kind: "null" });
  });

  test("a null MX beside real servers is noted: it must be the only one (RFC 7505, 3)", () => {
    expect(mxOf(["0 .", "10 mx.example.net."])).toEqual({
      kind: "hosts",
      hosts: [{ host: "mx.example.net", preference: 10, alias: false }],
      nullToo: true,
    });
    expect(mxOf(["10 mx.example.net."])).toMatchObject({ nullToo: false });
  });
});

describe("SPF terms", () => {
  test("the all, the lookups, includes and redirect", () => {
    expect(
      spfTerms(
        "v=spf1 a mx ip4:192.0.2.0/24 include:_spf.example.net exists:%{i}.x.example ptr ~all",
      ),
    ).toEqual({
      all: "~",
      lookups: 5,
      ptr: true,
      includes: ["_spf.example.net"],
      redirect: null,
    });
    expect(spfTerms("v=spf1 redirect=_spf.example.net")).toEqual({
      all: null,
      lookups: 1,
      ptr: false,
      includes: [],
      redirect: "_spf.example.net",
    });
  });

  test("a redirect beside an all is never used, so it costs nothing (RFC 7208, 6.1)", () => {
    expect(
      spfTerms("v=spf1 ip4:192.0.2.1 redirect=_spf.example.net -all"),
    ).toEqual({
      all: "-",
      lookups: 0,
      ptr: false,
      includes: [],
      redirect: null,
    });
  });

  test("qualifiers on all, and a bare all is +", () => {
    expect(spfTerms("v=spf1 -all").all).toBe("-");
    expect(spfTerms("v=spf1 ?all").all).toBe("?");
    expect(spfTerms("v=spf1 +all").all).toBe("+");
    expect(spfTerms("v=spf1 all").all).toBe("+");
    expect(spfTerms("V=SPF1 A:mail.example.net -ALL")).toMatchObject({
      all: "-",
      lookups: 1,
    });
  });

  test("ip4, ip6 and exp= cost no lookup", () => {
    expect(
      spfTerms(
        "v=spf1 ip4:192.0.2.1 ip6:2001:db8::/32 exp=explain.example -all",
      ).lookups,
    ).toBe(0);
  });
});

describe("DMARC", () => {
  test("policy, subdomains, pct, reports", () => {
    expect(
      dmarcOf(
        ["v=DMARC1; p=reject; sp=quarantine; pct=50; rua=mailto:r@example.net"],
        "example.net",
      ),
    ).toEqual({
      kind: "one",
      from: "example.net",
      policy: "reject",
      subdomains: "quarantine",
      pct: 50,
      reports: true,
      invalid: null,
    });
    expect(dmarcOf(["v=DMARC1;p=none"], "example.net")).toEqual({
      kind: "one",
      from: "example.net",
      policy: "none",
      subdomains: null,
      pct: 100,
      reports: false,
      invalid: null,
    });
  });

  test("no policy, a bad one, none, several, and other TXT ignored", () => {
    expect(
      dmarcOf(["v=DMARC1; rua=mailto:r@example.net"], "example.net"),
    ).toMatchObject({
      policy: null,
    });
    expect(dmarcOf(["v=DMARC1; p=maybe"], "example.net")).toMatchObject({
      policy: null,
    });
    expect(dmarcOf([], "example.net")).toEqual({ kind: "none" });
    expect(dmarcOf(["some-verification=abc"], "example.net")).toEqual({
      kind: "none",
    });
    expect(
      dmarcOf(["v=DMARC1; p=none", "v=DMARC1; p=reject"], "example.net"),
    ).toEqual({
      kind: "many",
      count: 2,
      from: "example.net",
    });
  });
});

describe("DKIM keys", () => {
  const rsa = (bits: number) =>
    generateKeyPairSync("rsa", { modulusLength: bits })
      .publicKey.export({ type: "spki", format: "der" })
      .toString("base64");
  const pkcs1 = (bits: number) =>
    generateKeyPairSync("rsa", { modulusLength: bits })
      .publicKey.export({ type: "pkcs1", format: "der" })
      .toString("base64");

  test("RSA key length from the key itself", () => {
    expect(dkimKey("fm1", `v=DKIM1; k=rsa; p=${rsa(2048)}`)).toEqual({
      selector: "fm1",
      keyType: "rsa",
      bits: 2048,
      revoked: false,
      unusable: null,
    });
    expect(dkimKey("s1", `v=DKIM1; p=${rsa(1024)}`)?.bits).toBe(1024);
    expect(dkimKey("s2", `p=${pkcs1(2048)}`)?.bits).toBe(2048);
  });

  test("Ed25519, a withdrawn key, and garbage", () => {
    expect(
      dkimKey(
        "ed",
        `v=DKIM1; k=ed25519; p=${Buffer.alloc(32, 7).toString("base64")}`,
      ),
    ).toEqual({
      selector: "ed",
      keyType: "ed25519",
      bits: 256,
      revoked: false,
      unusable: null,
    });
    expect(dkimKey("old", "v=DKIM1; k=rsa; p=")).toEqual({
      selector: "old",
      keyType: "rsa",
      bits: null,
      revoked: true,
      unusable: null,
    });
    expect(dkimKey("x", "v=DKIM1; k=rsa; p=not base64!!")?.bits).toBeNull();
    expect(dkimKey("y", "v=spf1 -all")).toBeNull();
  });
});

describe("SPF syntax, term by term (RFC 7208, 12)", () => {
  test.each([
    "v=spf1 -all",
    "v=spf1",
    "v=spf1 a mx -all",
    "v=spf1 a:mail.example.com/24 mx//64 a/24//64 mx:example.net -all",
    "v=spf1 ip4:192.0.2.0/24 ip4:192.0.2.1 ip4:0.0.0.0/0 ~all",
    "v=spf1 ip6:2001:db8::/32 ip6:::1 ip6:::/0 ip6:2001:db8::192.0.2.1 ?all",
    "v=spf1 ip6:2001:db8:0:0:0:0:0:1/128 -all",
    "v=spf1 include:_spf.example.net +all",
    "v=spf1 exists:%{ir}.%{l1r+-}._spf.%{d} -all",
    "v=spf1 exists:%{i}._spf.example.org%% -all",
    "v=spf1 ptr:example.org ptr -all",
    "v=spf1 redirect=_spf.example.net",
    "v=spf1 mx exp=explain.example.org -all",
    "v=spf1 a:example.com. -all",
    "v=spf1 a:%{d} -all",
    // A modifier nobody knows is allowed, and ignored.
    "v=spf1 x-note=anything%_at%-all -all",
    "V=SPF1 A:MAIL.EXAMPLE.NET IP6:2001:DB8::1 -ALL",
  ])("well formed: %s", (record) => {
    expect(parseSpf(record).error).toBeNull();
  });

  test.each([
    ["v=spf1 incude:_spf.example.net -all", "incude:_spf.example.net"],
    ["v=spf1 ip4:1.2.3 -all", "ip4:1.2.3"],
    ["v=spf1 ip4:192.0.2.1/33 -all", "ip4:192.0.2.1/33"],
    ["v=spf1 ip4:192.0.2.01 -all", "ip4:192.0.2.01"],
    ["v=spf1 ip4:256.0.2.1 -all", "ip4:256.0.2.1"],
    // A space after the colon leaves "ip4:" empty.
    ["v=spf1 ip4: 192.0.2.1 -all", "ip4:"],
    ["v=spf1 ip6:2001:db8::/129 -all", "ip6:2001:db8::/129"],
    ["v=spf1 ip6:2001:db8:::1 -all", "ip6:2001:db8:::1"],
    ["v=spf1 ip6:2001:db8::1::2 -all", "ip6:2001:db8::1::2"],
    ["v=spf1 ip6:192.0.2.1 -all", "ip6:192.0.2.1"],
    ["v=spf1 a:%{z} -all", "a:%{z}"],
    ["v=spf1 a:%{c}.example.com -all", "a:%{c}.example.com"],
    ["v=spf1 exists:%{i0}.example.com -all", "exists:%{i0}.example.com"],
    ["v=spf1 a:example.com% -all", "a:example.com%"],
    // A name has to end in a dot and a name (or a macro): no bare
    // address, no single label.
    ["v=spf1 a:192.0.2.1 -all", "a:192.0.2.1"],
    ["v=spf1 include:localhost -all", "include:localhost"],
    ["v=spf1 include: -all", "include:"],
    ["v=spf1 a:example.com/24/ -all", "a:example.com/24/"],
    ["v=spf1 mx/033 -all", "mx/033"],
    ["v=spf1 all:example.com", "all:example.com"],
    ["v=spf1 ptr/24 -all", "ptr/24"],
    // Two TXT strings joined without a space, as DNS joins them.
    ["v=spf1 mx-all", "mx-all"],
    [
      "v=spf1 redirect=a.example.com redirect=b.example.com",
      "redirect=b.example.com",
    ],
    ["v=spf1 exp=a.example.com exp=b.example.com -all", "exp=b.example.com"],
    ["v=spf1 redirect= -all", "redirect="],
    ["v=spf1 +redirect=a.example.com", "+redirect=a.example.com"],
    ["v=spf1 1x=y -all", "1x=y"],
  ])("a mistake: %s", (record, term) => {
    expect(parseSpf(record).error).toBe(term);
  });

  test("evaluation stops at the first all, so a later one is never reached", () => {
    expect(spfTerms("v=spf1 mx -all +all").all).toBe("-");
    expect(spfTerms("v=spf1 ?all -all").all).toBe("?");
  });
});

describe("DKIM keys that receivers can't use", () => {
  const spki = (bits: number) =>
    generateKeyPairSync("rsa", { modulusLength: bits })
      .publicKey.export({ type: "spki", format: "der" })
      .toString("base64");
  const RSA = spki(2048);

  test("a key cut short, as when one of its TXT strings is lost", () => {
    expect(
      dkimKey("selector1", `v=DKIM1; k=rsa; p=${RSA.slice(0, 200)}`),
    ).toEqual({
      selector: "selector1",
      keyType: "rsa",
      bits: null,
      revoked: false,
      unusable: "bad",
    });
  });

  test("garbage, whatever its shape", () => {
    for (const p of ["hello", "not base64!!", "AAAA", "MAA=", "MIIBIjAN"]) {
      expect(dkimKey("s1", `v=DKIM1; k=rsa; p=${p}`), p).toMatchObject({
        bits: null,
        unusable: "bad",
      });
    }
  });

  test("bytes left over after the key, or a length that runs past the end", () => {
    const der = Buffer.from(RSA, "base64");
    const extra = Buffer.concat([der, Buffer.from([0, 0])]).toString("base64");
    expect(dkimKey("s1", `p=${extra}`)?.unusable).toBe("bad");
    const long = Buffer.from(der);
    // The outer SEQUENCE's length, two bytes after 0x30 0x82, made longer.
    long.writeUInt16BE(der.readUInt16BE(2) + 1, 2);
    expect(dkimKey("s1", `p=${long.toString("base64")}`)?.unusable).toBe("bad");
  });

  test("a public key that isn't RSA, under k=rsa", () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" })
      .publicKey.export({ type: "spki", format: "der" })
      .toString("base64");
    expect(dkimKey("s1", `v=DKIM1; k=rsa; p=${ec}`)?.unusable).toBe("bad");
  });

  test("the length comes from the modulus itself", () => {
    expect(dkimKey("s1", `p=${spki(1024)}`)).toMatchObject({
      bits: 1024,
      unusable: null,
    });
    expect(dkimKey("s1", `p=${spki(3072)}`)?.bits).toBe(3072);
  });

  test("an Ed25519 key is 32 bytes, no more and no less", () => {
    expect(
      dkimKey("ed", `k=ed25519; p=${Buffer.alloc(31, 7).toString("base64")}`),
    ).toMatchObject({ unusable: "bad" });
    expect(dkimKey("ed", "k=ed25519; p=abc")).toMatchObject({
      unusable: "bad",
    });
  });

  test("a key of a kind receivers don't know (k=foo)", () => {
    expect(dkimKey("s1", `v=DKIM1; k=foo; p=${RSA}`)).toMatchObject({
      keyType: "foo",
      unusable: "kind",
    });
  });
});

describe("DMARC tags with values that aren't valid (RFC 7489, 6.3 and 6.6.3)", () => {
  test("an sp= that isn't a policy is a mistake in the record", () => {
    expect(
      dmarcOf(
        ["v=DMARC1; p=reject; sp=rejcet; rua=mailto:d@example.com"],
        "example.com",
      ),
    ).toMatchObject({ policy: "reject", invalid: "sp=rejcet", reports: true });
  });

  test("so is a p= that isn't one; a missing p= is just missing", () => {
    expect(dmarcOf(["v=DMARC1; p=maybe"], "example.com")).toMatchObject({
      policy: null,
      invalid: "p=maybe",
    });
    expect(
      dmarcOf(["v=DMARC1; rua=mailto:d@example.com"], "example.com"),
    ).toMatchObject({ policy: null, invalid: null, reports: true });
  });

  test("an empty or invalid pct= falls back to 100, never to 0", () => {
    for (const pct of ["pct=", "pct=abc", "pct=150", "pct=-5", "pct=5.5"]) {
      expect(
        dmarcOf([`v=DMARC1; p=quarantine; ${pct}`], "example.com"),
        pct,
      ).toMatchObject({ pct: 100 });
    }
    expect(
      dmarcOf(["v=DMARC1; p=quarantine; pct=0"], "example.com"),
    ).toMatchObject({ pct: 0 });
  });

  test("reports need an address that can be used", () => {
    const reports = (rua: string) =>
      dmarcOf([`v=DMARC1; p=none; rua=${rua}`], "example.com");
    expect(reports("")).toMatchObject({ reports: false });
    expect(reports("nonsense")).toMatchObject({ reports: false });
    expect(reports("mailto:d@example.com!10m")).toMatchObject({
      reports: true,
    });
  });
});
