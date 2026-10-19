// Reading the records themselves: MX, SPF, DMARC and DKIM, from the text
// DNS gives back. The text is whatever the domain's owner (or anyone they
// pull in) chose to publish, so every reader here is strict and bounded:
// a record that doesn't parse is read as the mistake it is, never as
// something that works.
import type { All, DkimKey, Dmarc, Mx, Policy } from "./model.ts";

/** A TXT record's value: DoH JSON quotes it, and splits long ones. A
 * backslash and three digits is a byte by its number ("\059" is ";"); a
 * backslash before anything else keeps that as it is (RFC 1035, 5.1). */
export function txtValue(data: string): string {
  const parts = [...data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    (m[1] ?? "").replace(/\\(\d{3}|.)/g, (_, c: string) =>
      c.length === 3 ? String.fromCharCode(Number(c)) : c,
    ),
  );
  return parts.length ? parts.join("") : data;
}

export function mxOf(data: string[]): Mx {
  const hosts = data.flatMap((d) => {
    const [pref, host] = d.trim().split(/\s+/);
    const preference = Number(pref);
    return host && Number.isFinite(preference)
      ? [{ host: host.replace(/\.$/, ""), preference, alias: false }]
      : [];
  });
  if (!hosts.length) return { kind: "none" };
  const real = hosts.filter((h) => h.host !== "");
  // "0 .": no mail, on purpose.
  if (!real.length) return { kind: "null" };
  return {
    kind: "hosts",
    hosts: real.sort((a, b) => a.preference - b.preference),
    nullToo: real.length < hosts.length,
  };
}

export const isSpf = (v: string) => /^v=spf1(\s|$)/i.test(v);

// Mechanisms and modifiers that cost a DNS lookup (RFC 7208, 4.6.4).
const LOOKUP = /^[+?~-]?(include|a|mx|ptr|exists)(?=[:/]|$)/i;

export type Qualifier = "+" | "-" | "~" | "?";

/** One mechanism, read from an SPF record. */
export interface Mechanism {
  // As written.
  text: string;
  qualifier: Qualifier;
  name: "all" | "include" | "a" | "mx" | "ptr" | "ip4" | "ip6" | "exists";
  // The name it asks about (its domain-spec), when it has one.
  target: string | null;
  // The prefix length it matches within, for IPv4 and for IPv6 senders:
  // null where it can't match that kind of address at all.
  v4: number | null;
  v6: number | null;
}

/** An SPF record, term by term (RFC 7208, 12): its mechanisms in order,
 * its redirect, and the first term that breaks the syntax, if any. */
export interface ParsedSpf {
  mechanisms: Mechanism[];
  redirect: string | null;
  error: string | null;
}

const IP4 =
  /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
// A label that can end a name: not all digits (RFC 7208, 12, toplabel).
const TOPLABEL = /^(?:[a-z0-9]*[a-z][a-z0-9]*|[a-z0-9]+-[a-z0-9-]*[a-z0-9])$/i;
// Sticky: it reads a macro where the scan has got to.
const MACRO = /%(?:\{([a-z])(\d*)r?[.\-+,/_=]*\}|[%_-])/iy;
// c, r and t only belong in the explanation text exp= points to (7.2).
const DOMAIN_LETTERS = "slodiphv";
const ALL_LETTERS = "slodiphcrtv";

/** A macro-string (RFC 7208, 7.1): whether it's well formed, and where
 * its last macro ends (-1 for none). */
function macroString(
  text: string,
  letters: string,
): { ok: boolean; lastMacro: number } {
  let at = 0;
  let lastMacro = -1;
  while (at < text.length) {
    if (text[at] === "%") {
      MACRO.lastIndex = at;
      const m = MACRO.exec(text);
      if (!m) return { ok: false, lastMacro };
      const letter = m[1]?.toLowerCase();
      if (letter !== undefined && !letters.includes(letter)) {
        return { ok: false, lastMacro };
      }
      // A number of parts to keep, when given, is at least one.
      if (m[2] && Number(m[2]) === 0) return { ok: false, lastMacro };
      at += m[0].length;
      lastMacro = at;
    } else {
      const code = text.charCodeAt(at);
      if (code < 0x21 || code > 0x7e) return { ok: false, lastMacro };
      at++;
    }
  }
  return { ok: true, lastMacro };
}

/** A domain-spec: a macro-string that ends in a macro, or in a dot and a
 * top label (with an optional dot after). */
function domainSpec(text: string): boolean {
  if (!text) return false;
  const { ok, lastMacro } = macroString(text, DOMAIN_LETTERS);
  if (!ok) return false;
  if (lastMacro === text.length) return true;
  const tail = text.slice(Math.max(lastMacro, 0)).replace(/\.$/, "");
  const dot = tail.lastIndexOf(".");
  return dot !== -1 && TOPLABEL.test(tail.slice(dot + 1));
}

function ip6(text: string): boolean {
  if (!/^[0-9a-f:.]+$/i.test(text)) return false;
  let head = text;
  let groups = 0;
  // An IPv4 address at the end stands for the last two groups.
  const v4 = /:(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4) {
    if (!IP4.test(v4[1] ?? "")) return false;
    head = text.slice(0, text.length - (v4[1] ?? "").length);
    if (!head.endsWith("::")) head = head.slice(0, -1);
    groups = 2;
  }
  const halves = head.split("::");
  if (halves.length > 2) return false;
  const parts = halves.map((h) => (h === "" ? [] : h.split(":")));
  if (!parts.flat().every((p) => /^[0-9a-f]{1,4}$/i.test(p))) return false;
  const count = parts.flat().length + groups;
  return halves.length === 2 ? count <= 7 : count === 8;
}

const prefix = (text: string, max: number): number | null =>
  /^(?:0|[1-9]\d*)$/.test(text) && Number(text) <= max ? Number(text) : null;

function mechanism(term: string): Mechanism | null {
  let qualifier: Qualifier = "+";
  let rest = term;
  const q = rest[0];
  if (q === "+" || q === "-" || q === "~" || q === "?") {
    qualifier = q;
    rest = rest.slice(1);
  }
  const name = (/^[a-z0-9]*/i.exec(rest)?.[0] ?? "").toLowerCase();
  const arg = rest.slice(name.length);
  const make = (
    n: Mechanism["name"],
    target: string | null,
    v4: number | null,
    v6: number | null,
  ): Mechanism => ({ text: term, qualifier, name: n, target, v4, v6 });
  const spec = (text: string) =>
    text.startsWith(":") && domainSpec(text.slice(1)) ? text.slice(1) : null;
  switch (name) {
    case "all":
      return arg === "" ? make("all", null, 0, 0) : null;
    case "include":
    case "exists": {
      const target = spec(arg);
      return target === null ? null : make(name, target, null, null);
    }
    case "ptr": {
      if (arg === "") return make("ptr", null, null, null);
      const target = spec(arg);
      return target === null ? null : make("ptr", target, null, null);
    }
    case "a":
    case "mx": {
      // A domain-spec, then optional prefix lengths: /24, //64, /24//64.
      const cidr = /(?:\/(\d+))?(?:\/\/(\d+))?$/.exec(arg);
      if (!cidr) return null;
      const v4 = cidr[1] === undefined ? 32 : prefix(cidr[1], 32);
      const v6 = cidr[2] === undefined ? 128 : prefix(cidr[2], 128);
      if (v4 === null || v6 === null) return null;
      const before = arg.slice(0, cidr.index);
      if (before === "") return make(name, null, v4, v6);
      const target = spec(before);
      return target === null ? null : make(name, target, v4, v6);
    }
    case "ip4":
    case "ip6": {
      if (!arg.startsWith(":")) return null;
      const [network = "", length, extra] = arg.slice(1).split("/");
      if (extra !== undefined) return null;
      const max = name === "ip4" ? 32 : 128;
      const bits = length === undefined ? max : prefix(length, max);
      if (bits === null) return null;
      if (name === "ip4") {
        return IP4.test(network) ? make("ip4", null, bits, null) : null;
      }
      return ip6(network) ? make("ip6", null, null, bits) : null;
    }
    default:
      return null;
  }
}

/** An SPF record read strictly, as RFC 7208 (12) writes it. Any term that
 * doesn't fit makes the whole record a permerror (4.6), and `error` holds
 * the first such term as written. The mechanisms that do fit are kept, in
 * order, for the receivers that read past a mistake. */
export function parseSpf(record: string): ParsedSpf {
  const mechanisms: Mechanism[] = [];
  let redirect: string | null = null;
  let error: string | null = null;
  let explain = false;
  const fail = (term: string) => {
    error ??= term;
  };
  for (const term of record.trim().split(/\s+/).slice(1)) {
    const modifier = /^([a-z][a-z0-9._-]*)=(.*)$/is.exec(term);
    if (modifier) {
      const name = (modifier[1] ?? "").toLowerCase();
      const value = modifier[2] ?? "";
      if (name === "redirect" || name === "exp") {
        // Each at most once (RFC 7208, 6).
        const twice = name === "redirect" ? redirect !== null : explain;
        if (twice || !domainSpec(value)) fail(term);
        else if (name === "redirect") redirect = value;
        else explain = true;
      } else if (!macroString(value, ALL_LETTERS).ok) {
        fail(term);
      }
      continue;
    }
    const m = mechanism(term);
    if (m) mechanisms.push(m);
    else fail(term);
  }
  return { mechanisms, redirect, error };
}

// How wide a range may be before it stops naming the domain's own
// senders. IPv4: no one network was ever given more than a /8 (16 million
// addresses), so a /8 is very wide, and anything wider (/0 to /7) spans
// many networks: senders anywhere can be inside it, so it counts as
// letting anyone send. IPv6: a /16 is far more than any one provider holds
// (the largest blocks are around /19), so a /16 is very wide and anything
// wider counts as anyone.
export const WIDE_V4 = 8;
export const WIDE_V6 = 16;

export type Reach = "anyone" | "wide" | null;

const reachOf = (bits: number | null, wide: number): Reach =>
  bits === null ? null : bits < wide ? "anyone" : bits === wide ? "wide" : null;

/** How far a mechanism reaches among senders it doesn't name, for IPv4
 * and IPv6: "anyone" when it takes in every sender (all, a range wider
 * than any one network, or an exists check that doesn't depend on the
 * sender's address), "wide" for a very wide range. An a or mx term's range
 * is counted as written, as if its name has an address: if it has none,
 * the term matches nobody, so the record means nothing by it. include is
 * left to the caller, which reads the record it pulls in. */
export function reach(m: Mechanism): { v4: Reach; v6: Reach } {
  if (m.name === "all") return { v4: "anyone", v6: "anyone" };
  if (m.name === "exists") {
    // %{i} and %{p} are the sender's address and its checked name; every
    // other macro is the same for every sender, or chosen by the sender.
    const bound = /%\{[ip]/i.test(m.target ?? "");
    return bound ? { v4: null, v6: null } : { v4: "anyone", v6: "anyone" };
  }
  if (m.name === "include" || m.name === "ptr") return { v4: null, v6: null };
  return { v4: reachOf(m.v4, WIDE_V4), v6: reachOf(m.v6, WIDE_V6) };
}

/** An SPF record's terms: its own last word on others, the lookups it
 * costs itself, and the names it pulls in (each include, and the redirect),
 * for counting theirs. Evaluation stops at the first "all", so a later one
 * is never reached. A redirect beside an "all" is never used (RFC 7208,
 * 6.1), so it costs nothing and isn't followed. */
export function spfTerms(record: string): {
  all: All;
  lookups: number;
  ptr: boolean;
  includes: string[];
  redirect: string | null;
} {
  const parsed = parseSpf(record);
  const first = parsed.mechanisms.find((m) => m.name === "all");
  const all: All = first ? first.qualifier : null;
  const includes = parsed.mechanisms.flatMap((m) =>
    m.name === "include" && m.target !== null ? [m.target] : [],
  );
  let lookups = 0;
  let ptr = false;
  for (const term of record.trim().split(/\s+/).slice(1)) {
    const mech = LOOKUP.exec(term.toLowerCase());
    if (!mech) continue;
    lookups++;
    if (mech[1] === "ptr") ptr = true;
  }
  const redirect = all === null ? parsed.redirect : null;
  if (redirect !== null) lookups++;
  return { all, lookups, ptr, includes, redirect };
}

const tags = (record: string) =>
  new Map(
    record.split(";").flatMap((part) => {
      const eq = part.indexOf("=");
      return eq === -1
        ? []
        : [[part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim()]];
    }),
  );

const POLICIES = new Set(["none", "quarantine", "reject"]);
const policy = (v: string | undefined): Policy | null => {
  const p = v?.toLowerCase();
  return p && POLICIES.has(p) ? (p as Policy) : null;
};

/** A DMARC record, or not: "v=DMARC1" first, spaces allowed around "=". */
export const isDmarc = (v: string) => /^v\s*=\s*DMARC1\s*(;|$)/i.test(v.trim());

/** A record with v=DMARC1 in it, but not first: receivers ignore it. */
export const looksLikeDmarc = (v: string) =>
  !isDmarc(v) && /(^|;)\s*v\s*=\s*DMARC1\s*(;|$)/i.test(v.trim());

// rua=: addresses for reports, comma-separated, each a URI with an
// optional size limit (RFC 7489, 6.4).
const reportsTo = (rua: string | undefined) =>
  (rua ?? "")
    .split(",")
    .some((u) => /^[a-z][a-z0-9+.-]*:[^\s!]+(?:!\d+[kmgt]?)?$/i.test(u.trim()));

/** The DMARC records found under `from`. When `from` is a parent of the
 * domain checked (inherited), that domain is one of its subdomains, so sp=
 * is its policy, and p= when there's no sp=. A p= or sp= that isn't a
 * policy is a mistake; an empty or invalid pct= falls back to 100, its
 * default (RFC 7489, 6.3). */
export function dmarcOf(
  values: string[],
  from: string,
  inherited = false,
): Dmarc {
  const found = values.filter(isDmarc);
  if (!found.length) return { kind: "none" };
  if (found.length > 1) return { kind: "many", count: found.length, from };
  const t = tags(found[0] ?? "");
  const p = t.get("p");
  const sp = t.get("sp");
  const own = policy(p);
  const subdomains = policy(sp);
  const invalid =
    p !== undefined && own === null
      ? `p=${p}`
      : sp !== undefined && subdomains === null
        ? `sp=${sp}`
        : null;
  const pctText = t.get("pct") ?? "";
  const pct = prefix(pctText, 100) ?? 100;
  return {
    kind: "one",
    from,
    // Without a valid p=, there's no policy at all, whatever sp= says.
    policy: own === null ? null : inherited ? (subdomains ?? own) : own,
    subdomains,
    pct,
    reports: reportsTo(t.get("rua")),
    invalid,
  };
}

// A DER element at `at`: its tag, and where its contents start and end.
// Null when it runs past `end`, or its length isn't one DER allows.
interface Der {
  tag: number;
  start: number;
  end: number;
}
function element(der: Uint8Array, at: number, end: number): Der | null {
  if (at + 2 > end) return null;
  const tag = der[at] ?? 0;
  let len = der[at + 1] ?? 0;
  let start = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    // No indefinite lengths, and no key needs more than three bytes of it.
    if (n === 0 || n > 3 || start + n > end) return null;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + (der[start++] ?? 0);
  }
  if (start + len > end) return null;
  return { tag, start, end: start + len };
}

// A positive INTEGER's length in bits: null for an empty, negative or
// zero one.
function positiveBits(der: Uint8Array, x: Der): number | null {
  if (x.end <= x.start || (der[x.start] ?? 0) & 0x80) return null;
  let start = x.start;
  while (start < x.end && der[start] === 0) start++;
  if (start === x.end) return null;
  return (x.end - start) * 8 - (Math.clz32(der[start] ?? 0) - 24);
}

// RSAPublicKey: SEQUENCE { modulus INTEGER, publicExponent INTEGER },
// filling [at, end) exactly. The modulus's length in bits, or null.
function rsaPublicKey(der: Uint8Array, at: number, end: number) {
  const seq = element(der, at, end);
  if (!seq || seq.tag !== 0x30 || seq.end !== end) return null;
  const n = element(der, seq.start, seq.end);
  if (!n || n.tag !== 0x02) return null;
  const e = element(der, n.end, seq.end);
  if (!e || e.tag !== 0x02 || e.end !== seq.end) return null;
  const bits = positiveBits(der, n);
  const exponent = positiveBits(der, e);
  if (bits === null || exponent === null || exponent < 2) return null;
  // The modulus is a product of two odd primes, and the exponent is odd.
  const odd = (x: Der) => ((der[x.end - 1] ?? 0) & 1) === 1;
  return odd(n) && odd(e) ? bits : null;
}

// rsaEncryption, 1.2.840.113549.1.1.1.
const RSA_OID = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];

// An RSA key's length, from its DER: SubjectPublicKeyInfo (the usual
// form) or a bare RSAPublicKey. Every length is checked against the bytes
// there, and the key must fill them exactly, so a key cut short (or with
// anything after it) is no key.
function rsaBits(der: Uint8Array): number | null {
  const outer = element(der, 0, der.length);
  if (!outer || outer.tag !== 0x30 || outer.end !== der.length) return null;
  const first = element(der, outer.start, outer.end);
  if (!first) return null;
  if (first.tag === 0x02) return rsaPublicKey(der, 0, der.length);
  if (first.tag !== 0x30) return null;
  // The algorithm: rsaEncryption, with NULL parameters or none.
  const oid = element(der, first.start, first.end);
  if (
    !oid ||
    oid.tag !== 0x06 ||
    oid.end - oid.start !== RSA_OID.length ||
    !RSA_OID.every((b, i) => der[oid.start + i] === b)
  ) {
    return null;
  }
  if (oid.end !== first.end) {
    const params = element(der, oid.end, first.end);
    if (!params || params.tag !== 0x05 || params.start !== params.end) {
      return null;
    }
    if (params.end !== first.end) return null;
  }
  const bits = element(der, first.end, outer.end);
  if (!bits || bits.tag !== 0x03 || bits.end !== outer.end) return null;
  // A bit string of whole bytes.
  if (der[bits.start] !== 0) return null;
  return rsaPublicKey(der, bits.start + 1, bits.end);
}

function base64(text: string): Uint8Array | null {
  const clean = text.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null;
  try {
    return Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** A DKIM key record (RFC 6376, 3.6.1). The key itself is read: an RSA
 * key must parse, and its length comes from its modulus; an Ed25519 key is
 * 32 bytes (RFC 8463). A key that doesn't is "bad", and a k= other than
 * those two is a kind receivers don't know: neither can verify anything. */
export function dkimKey(selector: string, value: string): DkimKey | null {
  const t = tags(value);
  const p = t.get("p");
  if (p === undefined) return null;
  const keyType = (t.get("k") ?? "rsa").toLowerCase();
  const key = (bits: number | null, unusable: DkimKey["unusable"]) => ({
    selector,
    keyType,
    bits,
    revoked: false,
    unusable,
  });
  if (p === "") return { ...key(null, null), revoked: true };
  const bytes = base64(p);
  if (keyType === "rsa") {
    const bits = bytes ? rsaBits(bytes) : null;
    return key(bits, bits === null ? "bad" : null);
  }
  if (keyType === "ed25519") {
    return bytes?.length === 32 ? key(256, null) : key(null, "bad");
  }
  return key(null, "kind");
}
