// Turns the parts of a message that change from one event to the next
// (numbers, ids, addresses, paths, names in quotes, times) into
// placeholders, so events that say the same thing group together. A
// placeholder is its kind between two private-use characters, which no
// log contains; the page draws each as a small chip.

export const OPEN = "\u{e000}";
export const CLOSE = "\u{e001}";

export type Slot =
  | "guid"
  | "sid"
  | "path"
  | "url"
  | "ip"
  | "hex"
  | "date"
  | "time"
  | "name"
  | "n";

const slot = (kind: Slot) => `${OPEN}${kind}${CLOSE}`;

const HEX = "[0-9a-fA-F]";

// IPv6: two to eight groups, with at least one letter or a "::".
const IPV6 = /^(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{1,4}$/i;
const isIpv6 = (token: string) => IPV6.test(token) && /[a-f]|::/i.test(token);
// The IPv6 groups before an IPv4 address: up to six, each ending in ":".
const IPV4_HEAD = /^(?:[0-9a-f]{0,4}:){2,6}$/i;

/** A run of hex digits and colons, as the placeholder when it holds an
 * IPv6 address. A single colon at either end is the sentence's ("to
 * 2001:db8::1: refused"), and a run glued to a word's end belongs to that
 * word ("IPv6:2001:db8::1"). Anything else stays as it is. */
function ipv6(run: string, at: number, whole: string): string {
  if (run.length > 45) return run;
  let from = 0;
  let to = run.length;
  if (/\w/.test(whole[at - 1] ?? "")) {
    const colon = run.indexOf(":");
    if (colon === -1) return run;
    from = colon + 1;
  }
  if (run[from] === ":" && run[from + 1] !== ":") from++;
  // An IPv4 address written in IPv6 ("::ffff:192.168.1.1"): its IPv4
  // part is a placeholder already, and the two are one address.
  const head = run.slice(from);
  if (
    whole.startsWith(slot("ip"), at + run.length) &&
    IPV4_HEAD.test(head) &&
    (head.includes("::") || head.split(":").length === 7)
  ) {
    return run.slice(0, from);
  }
  if (run[to - 1] === ":" && run[to - 2] !== ":") to--;
  return isIpv6(run.slice(from, to))
    ? `${run.slice(0, from)}${slot("ip")}${run.slice(to)}`
    : run;
}

// A rule: what to look for, the placeholder, and how to replace a match
// that needs a look first.
const RULES: [
  RegExp,
  Slot,
  ((match: string, at: number, whole: string) => string)?,
][] = [
  // {01234567-89ab-cdef-0123-456789abcdef}, with or without braces.
  [
    new RegExp(
      `\\{?${HEX}{8}-${HEX}{4}-${HEX}{4}-${HEX}{4}-${HEX}{12}\\}?`,
      "g",
    ),
    "guid",
  ],
  [/\bS-1-\d+(?:-\d+)+\b/g, "sid"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, "url"],
  // C:\Windows\…, \\server\share\…, \Device\HarddiskVolume3\…; a lone
  // backslash (PC\user) isn't a path. A bracket or a full stop after one
  // is the sentence's, not the path's.
  [
    /(?:\b[A-Za-z]:\\|\\\\|(?<![\w-])\\(?=[A-Za-z][^\s\\]*\\))(?:[^\s"'<>|()]*[^\s"'<>|().,;:])?/g,
    "path",
  ],
  // /var/log/…, at least two parts, so "and/or" stays.
  [/(?<![\w.])\/(?:[\w.@-]+\/)+[\w.@-]*/g, "path"],
  // Dates and times before addresses: 22:46:02 isn't an IPv6 address.
  [
    /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g,
    "date",
  ],
  [/\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g, "date"],
  [/\b\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:\s?[AP]M)?\b/gi, "time"],
  [/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "ip"],
  // IPv6: a whole run of hex digits and colons, looked at as a whole, so
  // a long run costs a single pass.
  [/(?<![0-9a-fA-F:])[0-9a-fA-F:]{3,}(?![0-9a-fA-F:])/g, "ip", ipv6],
  [/\b0x[0-9a-fA-F]+\b/g, "hex"],
  // Names in quotes: ‘…’, “…”, "…", '…'.
  [/“[^”]{1,200}”|‘[^’]{1,200}’|"[^"\n]{1,200}"|'[^'\n]{1,200}'/g, "name"],
  // Long hex runs without 0x (hashes, addresses), then plain numbers.
  [/\b(?=[0-9a-fA-F]*\d)[0-9a-fA-F]{12,}\b/g, "hex"],
  [/(?<![\w.])[-+]?\d+(?:[.,]\d+)*\b/g, "n"],
];

/** The message with its variable parts as placeholders, and its spaces
 * tidied. */
export function normalize(message: string): string {
  // Event Viewer puts direction marks around the parts of a date.
  let out = message
    .replace(/[\u200e\u200f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  for (const [pattern, kind, check] of RULES) {
    out = check
      ? out.replace(pattern, check)
      : out.replace(pattern, slot(kind));
  }
  return out;
}

/** A request path with its ids as placeholders and no query. */
export function normalizePath(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? "";
  return bare
    .split("/")
    .map((part) =>
      /^\d+$/.test(part)
        ? slot("n")
        : new RegExp(`^${HEX}{8}-${HEX}{4}-`).test(part) ||
            /^[0-9a-fA-F]{16,}$/.test(part)
          ? slot("hex")
          : part,
    )
    .join("/");
}

/** A normalized message as text and placeholders, in order. */
export function parts(
  normalized: string,
): ({ text: string } | { slot: string })[] {
  const out: ({ text: string } | { slot: string })[] = [];
  const pattern = new RegExp(`${OPEN}([a-z]+)${CLOSE}`, "gu");
  let at = 0;
  for (const match of normalized.matchAll(pattern)) {
    if (match.index > at) out.push({ text: normalized.slice(at, match.index) });
    out.push({ slot: match[1] ?? "" });
    at = match.index + match[0].length;
  }
  if (at < normalized.length) out.push({ text: normalized.slice(at) });
  return out;
}
