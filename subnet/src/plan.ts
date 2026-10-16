// The plan as typed: one range per line, an optional name first
// ("home 192.168.1.0/24", "iot: 192.168.20.0/24", "10.0.30.0/24"), or an
// address and its mask ("lan 192.168.12.0 255.255.255.0"). A line
// indented under a range is part of it (a split). Each line becomes a
// range, or a line that couldn't be read; # starts a comment.
import { block, maskPrefix, parseV4, type Range4 } from "./ip.ts";
import { block6, parseV6, type Range6 } from "./ip6.ts";

export type Net = { v: 4; range: Range4 } | { v: 6; range: Range6 };

export interface Entry {
  line: number;
  name: string;
  net: Net;
  // What was typed, when it isn't the range's own short form
  // (192.168.1.5/24, or 192.168.1.0 255.255.255.0).
  typed: string | null;
  // The address typed has host bits set (192.168.1.5/24): a host, read as
  // its network.
  host: boolean;
  // The range this line is indented under: its index in entries.
  parent: number | null;
}

export interface Bad {
  line: number;
  text: string;
  // Why, when there's more to say than "isn't a range": a first-to-last
  // range ("a - b"), a mask with gaps, a name ending in an address, a
  // number over 255, a number with a leading zero, an address without four
  // numbers, or a size past /32 (/128). `part` is the piece at fault.
  why?: Why;
  part?: string;
}

export type Why =
  "range" | "mask" | "name" | "octet" | "zero" | "parts" | "prefix" | "prefix6";

const LINE = /^(?:(.+?):?\s+)?([\da-f.:]+)(?:\/(\d{1,3}))?$/i;
const MASKED =
  /^(?:(.+?):?\s+)?(\d+\.\d+\.\d+\.\d+)(\s+|\/)(\d+\.\d+\.\d+\.\d+)$/;
const SPAN = /^(?:(.+?):?\s+)?([\da-f.:]+)\s*-\s*([\da-f.:]+)$/i;

const isAddress = (text: string) =>
  parseV4(text) !== null || (text.includes(":") && parseV6(text) !== null);

// A name can't be, or end in, an address ("lan 192.168.12.0" is not a
// name): that line is something else, typed in a way the page can't read.
// Any word of the name counts, with a trailing comma, semicolon or colon
// ignored ("lan 10.0.0.0/24, 10.0.1.0/24" is two ranges on one line).
const nameIsAddress = (name: string | undefined) =>
  !!name
    ?.trim()
    .split(/\s+/)
    .some((word) =>
      isAddress(word.replace(/[,;:]+$/, "").replace(/\/\d{1,3}$/, "")),
    );

type Found = { net: Net; typed: string | null; host: boolean };
type Problem = { why?: Why; part?: string };

/** Why an address (and its size) can't be read, when it's close enough to
 * one to say: nothing when it's something else altogether. */
function why(address: string, prefixText?: string): Problem {
  const prefix = prefixText === undefined ? 0 : Number(prefixText);
  if (address.includes(":")) {
    return parseV6(address) !== null && prefix > 128
      ? { why: "prefix6", part: `/${prefixText}` }
      : {};
  }
  const parts = address.split(".");
  if (parts.length < 2 || !parts.every((p) => /^\d+$/.test(p))) return {};
  const over = parts.find((p) => Number(p) > 255);
  if (over !== undefined) return { why: "octet", part: over };
  if (parts.length !== 4) return { why: "parts", part: address };
  const zero = parts.find((p) => p.length > 1 && p.startsWith("0"));
  if (zero !== undefined) return { why: "zero", part: zero };
  return prefix > 32 ? { why: "prefix", part: `/${prefixText}` } : {};
}

function net(address: string, prefixText: string | undefined): Found | null {
  if (address.includes(":")) {
    const n = parseV6(address);
    const prefix = prefixText === undefined ? 128 : Number(prefixText);
    if (n === null || prefix > 128) return null;
    const range = block6(n, prefix);
    const host = n !== range.start;
    return {
      net: { v: 6, range },
      // Said only when the address isn't the range's start, however it
      // was written (2001:0db8:0000::/32 is 2001:db8::/32).
      typed: host ? `${address.toLowerCase()}/${prefix}` : null,
      host,
    };
  }
  const n = parseV4(address);
  const prefix = prefixText === undefined ? 32 : Number(prefixText);
  if (n === null || prefix > 32) return null;
  const range = block(n, prefix);
  const host = n !== range.start;
  return {
    net: { v: 4, range },
    typed: host ? `${address}/${prefix}` : null,
    host,
  };
}

type Read = ({ name: string } & Found) | Problem;

function read(line: string): Read {
  const span = SPAN.exec(line);
  if (span?.[2] && span[3] && isAddress(span[2]) && isAddress(span[3])) {
    return { why: "range" };
  }
  const masked = MASKED.exec(line);
  const [, maskedName, address = "", gap = "", mask = ""] = masked ?? [];
  if (masked && !nameIsAddress(maskedName)) {
    const n = parseV4(address);
    if (n !== null && parseV4(mask) !== null) {
      const prefix = maskPrefix(mask);
      if (prefix === null) return { why: "mask", part: mask };
      const range = block(n, prefix);
      return {
        name: maskedName?.trim() ?? "",
        net: { v: 4, range },
        typed: `${address}${gap.trim() ? "/" : " "}${mask}`,
        host: n !== range.start,
      };
    }
    // An address or a mask with a number out of place.
    const problem = n === null ? why(address) : why(mask);
    if (problem.why) return problem;
  }
  const m = LINE.exec(line);
  if (m && nameIsAddress(m[1])) return { why: "name" };
  if (!m?.[2]) return {};
  const found = net(m[2], m[3]);
  if (!found) return why(m[2], m[3]);
  return { name: m[1]?.trim() ?? "", ...found };
}

// No range, even with a long name, comes near this; a longer line isn't
// read at all. (The patterns above try every split of a line into a name
// and an address, so a 100,000-character line would freeze the page.)
const MAX_LINE = 300;
// How much of such a line its finding quotes.
const QUOTED = 40;

export function parsePlan(text: string): { entries: Entry[]; bad: Bad[] } {
  const entries: Entry[] = [];
  const bad: Bad[] = [];
  let top: number | null = null;
  // Line ends as Windows, old Macs or anything else wrote them.
  text.split(/\r\n?|\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) return;
    if (line.length > MAX_LINE) {
      bad.push({ line: i + 1, text: `${line.slice(0, QUOTED).trimEnd()}…` });
      return;
    }
    const found = read(line);
    if (!("net" in found)) {
      bad.push({ line: i + 1, text: raw.trim(), ...found });
      return;
    }
    const indented = /^\s/.test(raw);
    entries.push({
      line: i + 1,
      name: found.name,
      net: found.net,
      typed: found.typed,
      host: found.host,
      parent: indented ? top : null,
    });
    if (!indented) top = entries.length - 1;
  });
  return { entries, bad };
}
