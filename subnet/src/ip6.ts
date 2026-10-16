// IPv6 prefixes, as BigInt: parsed (the :: shorthand and an embedded IPv4
// tail included; zone ids like %eth0 refused), written short, sized in
// /64s and checked for overlap. No hosts are listed: there are too many.
import { parseV4 } from "./ip.ts";

export interface Range6 {
  start: bigint;
  prefix: number;
}

const ALL = (1n << 128n) - 1n;

export function parseV6(text: string): bigint | null {
  if (!/^[\da-f:.]+$/i.test(text)) return null;
  let head = text;
  let tail: bigint[] = [];
  // An IPv4 address in the last 32 bits.
  const v4 = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4) {
    const n = parseV4(v4[2] ?? "");
    if (n === null) return null;
    head = `${v4[1] ?? ""}0:0`;
    tail = [BigInt(n)];
  }
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const groups = (s: string) => (s === "" ? [] : s.split(":"));
  const left = groups(halves[0] ?? "");
  const right = halves.length === 2 ? groups(halves[1] ?? "") : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const all = [
    ...left,
    ...Array<string>(halves.length === 2 ? missing : 0).fill("0"),
    ...right,
  ];
  let n = 0n;
  for (const g of all) {
    if (!/^[\da-f]{1,4}$/i.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  if (tail.length) n = (n & ~0xffffffffn) | (tail[0] ?? 0n);
  return n;
}

export function block6(address: bigint, prefix: number): Range6 {
  const host = (1n << BigInt(128 - prefix)) - 1n;
  return { start: address & (ALL ^ host), prefix };
}

export const end6 = (r: Range6) =>
  r.start | ((1n << BigInt(128 - r.prefix)) - 1n);

/** The short form: lower case, no leading zeros, the longest run of zero
 * groups as :: (RFC 5952). */
export function v6(n: bigint): string {
  const g = Array.from({ length: 8 }, (_, i) =>
    Number((n >> BigInt(112 - i * 16)) & 0xffffn),
  );
  let best = -1;
  let bestLen = 1;
  for (let i = 0; i < 8;) {
    if (g[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > bestLen) {
      best = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = g.map((x) => x.toString(16));
  if (best === -1) return hex.join(":");
  return `${hex.slice(0, best).join(":")}::${hex.slice(best + bestLen).join(":")}`;
}

export const cidr6 = (r: Range6) => `${v6(r.start)}/${r.prefix}`;

/** How many /64 networks the prefix holds (0 when it's smaller). */
export const sizeIn64s = (r: Range6): bigint =>
  r.prefix > 64 ? 0n : 1n << BigInt(64 - r.prefix);

export const overlap6 = (a: Range6, b: Range6): boolean =>
  a.start <= end6(b) && b.start <= end6(a);

export const contains6 = (outer: Range6, inner: Range6): boolean =>
  inner.start >= outer.start && end6(inner) <= end6(outer);

const K = (text: string, prefix: number) => block6(parseV6(text) ?? 0n, prefix);
const KINDS6 = [
  { kind: "unspecified6", range: K("::", 128) },
  { kind: "loopback6", range: K("::1", 128) },
  { kind: "compat6", range: K("::", 96) },
  { kind: "mapped6", range: K("::ffff:0:0", 96) },
  { kind: "nat64", range: K("64:ff9b::", 96) },
  { kind: "linkLocal6", range: K("fe80::", 10) },
  { kind: "ula", range: K("fc00::", 7) },
  { kind: "documentation6", range: K("2001:db8::", 32) },
  { kind: "multicast6", range: K("ff00::", 8) },
] as const;

export type Kind6 = (typeof KINDS6)[number]["kind"] | "global";

export function kind6(r: Range6): Kind6 {
  return KINDS6.find((k) => contains6(k.range, r))?.kind ?? "global";
}
