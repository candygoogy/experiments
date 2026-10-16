// What someone types, as a domain name: an email address gives its domain,
// a link its host, and an international name its punycode (the form DNS
// uses). Anything that isn't a hostname with a dot is null.

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeDomain(input: string): string | null {
  let text = input.trim();
  // "Name <address@domain>", as a mail program copies it.
  const angle = /<([^<>]*)>$/.exec(text);
  if (angle) text = (angle[1] ?? "").trim();
  const at = text.lastIndexOf("@");
  // An address (not the user:pass@ of a link).
  if (at !== -1 && !text.includes("://")) text = text.slice(at + 1);
  if (!text) return null;
  let host: string;
  try {
    const url = new URL(text.includes("://") ? text : `http://${text}`);
    host = url.hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.$/, "").toLowerCase();
  if (host.length > 253 || host.startsWith("[")) return null;
  const labels = host.split(".");
  if (labels.length < 2) return null;
  if (!labels.every((l) => LABEL.test(l))) return null;
  // An address like 192.168.1.1, or a name ending in numbers.
  if (/^\d+$/.test(labels.at(-1) ?? "")) return null;
  return host;
}

// Names that are never in public DNS, so a lookup could only leak them
// for nothing: .localhost and .invalid must not be sent to DNS at all
// (RFC 6761, 6.3 and 6.4); .test and .example never have real records
// (RFC 2606); .local is for the local network (RFC 6762), .onion for Tor
// (RFC 7686), .alt for names outside DNS (RFC 9476), and home.arpa for
// home networks (RFC 8375). example.com, .net and .org are real names
// with real records, so they can still be checked.
const RESERVED = [
  "localhost",
  "invalid",
  "test",
  "example",
  "local",
  "onion",
  "alt",
  "home.arpa",
];

/** A name kept for tests, examples or local networks: never looked up. */
export const reservedName = (domain: string): boolean =>
  RESERVED.some((r) => domain === r || domain.endsWith(`.${r}`));
