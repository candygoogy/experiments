// Every word the mail check shows, in one place.
import type { DkimKey, Policy, SpfTerm } from "./model.ts";
import { MAX_LOOKUPS, MAX_MX_HOSTS } from "./limits.ts";
import type { Level, Overall } from "./verdict.ts";

export const COPY = {
  title: "Mail check",
  // The meta description.
  description:
    "Type a domain to see how well its email is protected against fakes, in plain words.",
  noscript: "This tool needs JavaScript. It runs entirely in your browser.",
  intro:
    "Type a domain to see how well its email is protected against fakes, in plain words.",
  fieldLabel: "Domain or email address",
  placeholder: "example.com",
  check: "Check",
  network:
    "The domain name is sent to Cloudflare’s public DNS (1.1.1.1) to look up its records. Nothing else leaves your browser.",
  privacy:
    "Runs in your browser. Only the domain name is sent, to Cloudflare’s public DNS.",
  // A made-up domain under .example, the name kept for examples (RFC
  // 2606), so it can never be someone's real one.
  example: "Example: shop.example, a made-up domain",
  notDomain: "That doesn’t look like a domain. Try something like example.com.",
  // A name that's never in public DNS (.test, .example, .localhost and
  // the like): answered here, never sent to Cloudflare.
  reserved:
    "That name is kept for tests, examples or local networks, so it has no mail records to check.",
  looking: (domain: string) => `Looking up ${domain}…`,
  // In the same place once it's done: never longer than the line above,
  // so the line keeps its height.
  checked: (domain: string) => `Checked ${domain}.`,
  noAnswer:
    "Cloudflare’s DNS didn’t answer. Check your connection and try again.",
  missing: (domain: string) => `${domain} doesn’t exist in DNS.`,
  // Anything else that goes wrong (the page's code didn't load, say).
  wrong: "Something went wrong while checking. Try again.",
  // Read out once a domain is checked.
  ready: (domain: string, verdict: string) => `${domain}: ${verdict}`,
  // Over the last answer, dimmed, once a newer check fails.
  lastChecked: (domain: string) => `Last checked: ${domain}`,
} as const;

const list = (items: string[]) =>
  items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

const NUMBERS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];
const num = (n: number) => NUMBERS[n] ?? String(n);

// An SPF term as the page shows it: as written, and whose record it's in
// when that's a record the domain's own pulls in.
const term = (t: SpfTerm) =>
  t.from === null ? t.term : `${t.term} in ${t.from}’s record`;

export const VERDICT: Record<Exclude<Overall, "unchecked">, string> = {
  protected: "Mail from this domain is well protected.",
  parked:
    "Mail from this domain is well protected: it says it sends none, and asks receivers to stop any that claims to be from it.",
  partly: "Mail from this domain is partly protected.",
  fakeable: "Mail from this domain can be faked.",
};

const UNCHECKED_PART = {
  dmarc: "the DMARC policy",
  spf: "the SPF record",
  spfPart: "part of the SPF record",
};

/** The verdict when a lookup it depends on didn't answer. */
export const verdictUnchecked = (parts: (keyof typeof UNCHECKED_PART)[]) =>
  `Couldn’t check everything: ${list(parts.map((p) => UNCHECKED_PART[p]))} didn’t answer, so this can’t say how well mail from this domain is protected.`;

// The word beside each check; a note has none.
export const LEVEL: Record<Level, string> = {
  good: "In place",
  weak: "Weak",
  missing: "Missing",
  broken: "Broken",
  unsafe: "Unsafe",
  unchecked: "Couldn’t check",
  info: "",
};

export const NAMES = {
  mx: "Receiving (MX)",
  spf: "Who may send (SPF)",
  dkim: "Signatures (DKIM)",
  dmarc: "Policy (DMARC)",
  extras: "Extras",
};

const POLICY: Record<Policy, string> = {
  none: "Monitoring only (p=none): fakes are still delivered.",
  quarantine: "Fakes go to spam (p=quarantine).",
  reject: "Fakes are rejected (p=reject).",
};

// Each check's sentences (rows.ts picks which, and in what order).
export const WORDS = {
  mxNone: "It can’t receive mail: no mail servers (MX) are listed.",
  mxNull: "It says it receives no mail (a null MX).",
  mxHosts: (n: number) =>
    `It receives mail through ${n === 1 ? "one server" : `${num(n)} servers`}.`,
  mxUnchecked: "Couldn’t check its mail servers (MX): the DNS didn’t answer.",
  mxAlias: (host: string) =>
    `${host} is an alias (CNAME), which other mail servers shouldn’t have to follow.`,
  mxNullToo:
    "It also says it receives no mail (a null MX), which contradicts its servers, so some senders may not deliver to it.",

  spfNone:
    "No SPF record, so receivers can’t tell who may send as this domain.",
  spfMany: (n: number) =>
    `${num(n).replace(/^./, (c) => c.toUpperCase())} SPF records. Only one is allowed, so receivers treat SPF as broken (an error).`,
  spfAll: {
    "-": "It lists who may send, and asks receivers to reject anyone else (-all).",
    "~": "It lists who may send, and asks receivers to mark anyone else as suspicious (~all).",
    "?": "It lists who may send, but says nothing about anyone else (?all).",
    "+": "It lets anyone at all send as this domain (+all).",
    none: "It lists who may send, but doesn’t say what to do with anyone else.",
  },
  spfOpen: (t: SpfTerm) =>
    `It lets anyone at all send as this domain (${term(t)}).`,
  spfWide: (t: SpfTerm) =>
    `It lets a very large block of addresses send (${term(t)}), so senders who aren’t yours may be inside it.`,
  spfNobody: "It says nobody sends mail as this domain (-all).",
  spfNoSenders:
    "It names nobody who may send, so it works like having no SPF record.",
  spfSyntax: (t: SpfTerm) =>
    t.from === null
      ? `It has a mistake in it (${t.term}), so receivers treat it as broken.`
      : `It pulls in ${t.from}, whose record has a mistake (${t.term}), so receivers treat it as broken.`,
  spfManyAt: (name: string) =>
    `It pulls in ${name}, which has more than one SPF record, so receivers treat it as broken.`,
  spfMxOver: (n: number) =>
    `It lets the domain’s mail servers send (mx), but there are ${n} of them, more than ${MAX_MX_HOSTS}, so receivers treat it as broken.`,
  spfUnchecked: "Couldn’t check its SPF record: the DNS didn’t answer.",
  spfTooMany: (n: number, atLeast: boolean) =>
    `It takes ${atLeast ? "at least " : ""}${n} DNS lookups, more than ${MAX_LOOKUPS}, so it breaks, and receivers may ignore it.`,
  spfLoop:
    "It pulls itself in again (an include loop), so receivers treat it as broken.",
  spfEmptyInclude: (name: string) =>
    `It includes ${name}, which has no SPF record, so receivers treat it as broken.`,
  spfEmptyRedirect: (name: string) =>
    `It redirects to ${name}, which has no SPF record, so receivers treat it as broken.`,
  spfUncheckedPart: (names: string[], n: number) =>
    `Couldn’t check ${list(names)}, so it takes at least ${n} of ${MAX_LOOKUPS} DNS lookups, maybe more.`,
  spfUncheckedExists: (names: string[]) =>
    `Couldn’t check ${list(names)}, so this page can’t tell who it lets send.`,
  spfLookups: (n: number, atLeast = false) =>
    `${atLeast ? "At least " : ""}${n} of ${MAX_LOOKUPS} DNS lookups.`,
  spfAllFrom: (name: string) =>
    `Its last word comes from ${name}, which it redirects to.`,
  spfPtr: "It uses ptr, which is deprecated and slow.",
  spfDkimOnly:
    "Its DMARC policy still stops fakes, but its own mail now passes only when it’s signed with DKIM: anything it sends unsigned is treated like a fake too.",

  dkimNone:
    "No DKIM key under the common names. Your provider may use a different one.",
  dkimFound: (names: string[]) =>
    `Found ${names.length === 1 ? "a key" : "keys"} under ${list(names)}.`,
  dkimNotNeeded:
    "No DKIM key, which fits: its SPF record says it sends no mail.",
  dkimBad: (name: string) =>
    `The key under ${name} isn’t a valid key, so receivers ignore its signatures.`,
  dkimKind: (name: string, kind: string) =>
    `The key under ${name} is of a kind receivers don’t know (k=${kind}), so they ignore its signatures.`,
  dkimEd25519Only:
    "Some large mail services don’t check Ed25519 keys yet; an RSA key beside it covers them.",
  dkimTooShort: (name: string, bits: number) =>
    `The key under ${name} is only ${bits} bits, so receivers ignore its signatures.`,
  dkimShort: (name: string, bits: number) =>
    `The key under ${name} is only ${bits} bits; 2048 is the usual length now.`,
  dkimWithdrawn: (names: string[]) =>
    `Only withdrawn keys under ${list(names)}. Your provider may sign under a different name.`,
  dkimUnchecked: (n: number) =>
    `Couldn’t check ${n === 1 ? "one of the common names" : `${num(n)} of the common names`}.`,
  dkimKey: (k: DkimKey) =>
    k.revoked
      ? `${k.selector}: withdrawn (an empty key)`
      : `${k.selector}: ${k.keyType === "rsa" ? "RSA" : k.keyType === "ed25519" ? "Ed25519" : k.keyType}${k.unusable === "bad" ? ", not a valid key" : k.bits ? `, ${k.bits} bits` : ""}`,

  dmarcNone:
    "No DMARC policy, so receivers decide on their own what to do with fakes.",
  dmarcMany: (n: number) =>
    `${num(n).replace(/^./, (c) => c.toUpperCase())} DMARC records. Only one is allowed, so receivers treat it as none.`,
  // With somewhere to send reports, receivers act as if it said p=none;
  // without, they ignore it (RFC 7489, 6.6.3).
  dmarcNoPolicy: (reports: boolean) =>
    `Its DMARC record has no policy (p=), so receivers ${reports ? "treat it as monitoring only" : "ignore it"}.`,
  dmarcInvalid: (tag: string, reports: boolean) =>
    `Its DMARC record has a mistake (${tag}), so receivers ${reports ? "treat it as monitoring only" : "ignore it"}.`,
  dmarcNotFirst:
    "A DMARC record is there, but it doesn’t start with v=DMARC1, so receivers ignore it.",
  dmarcUnchecked: "Couldn’t check its DMARC policy: the DNS didn’t answer.",
  dmarcFrom: (domain: string) => `It follows ${domain}’s policy.`,
  dmarcBypassed: (t: SpfTerm) =>
    `Its policy would stop fakes, but its SPF record lets anyone send (${term(t)}), so fakes pass DMARC anyway.`,
  dmarcSubNone:
    "Its subdomains aren’t covered (sp=none): fakes sent from them are still delivered.",
  dmarcPolicy: POLICY,
  // pct= applies the policy to that share of the fakes; the rest get the
  // next milder policy (RFC 7489, 6.6.4).
  dmarcPartial: (policy: Policy, pct: number) =>
    policy === "reject"
      ? pct === 0
        ? "None of the fakes are rejected (pct=0): they all go to spam instead."
        : `Fakes are rejected (p=reject), but only ${pct}% of them; the rest go to spam.`
      : policy === "quarantine"
        ? pct === 0
          ? "None of the fakes go to spam (pct=0): they’re all delivered as usual."
          : `Fakes go to spam (p=quarantine), but only ${pct}% of them; the rest are delivered as usual.`
        : POLICY.none,
  dmarcSubdomains: (p: Policy) => `Subdomains: ${POLICY[p]}`,
  dmarcReports:
    "Reports on all mail that claims to be from this domain go to the address it lists, usually once a day.",
  dmarcNoReports: "No reports are collected.",

  dnssec: "Its DNS answers are signed (DNSSEC).",
  noDnssec: "Its DNS answers aren’t signed (no DNSSEC).",
  mtaSts: "MTA-STS asks other servers to always encrypt mail to it.",
  noMtaSts: "No MTA-STS, so other servers may deliver to it unencrypted.",
  tlsRpt: "TLS reporting is on.",
  noTlsRpt: "No TLS reporting.",
  mtaStsUnchecked: "Couldn’t check MTA-STS.",
  tlsRptUnchecked: "Couldn’t check TLS reporting.",
};
