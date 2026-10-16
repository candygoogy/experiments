// IPv4 ranges as numbers: parsing, the arithmetic of a prefix, and what
// kind of address space a range sits in. Addresses are unsigned 32-bit
// numbers, held in plain JS numbers (exact up to 2^53).

export interface Range4 {
  // The first address (the network) and how many there are.
  start: number;
  size: number;
  prefix: number;
}

export const SPACE = 2 ** 32;

export function parseV4(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255 || (p.length > 1 && p.startsWith("0"))) return null;
    n = n * 256 + v;
  }
  return n;
}

export const v4 = (n: number): string =>
  [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");

/** A prefix length's block, aligned down from an address. */
export function block(address: number, prefix: number): Range4 {
  const size = 2 ** (32 - prefix);
  return { start: Math.floor(address / size) * size, size, prefix };
}

export const end = (r: Range4): number => r.start + r.size - 1;

export const cidr = (r: Range4): string => `${v4(r.start)}/${r.prefix}`;

export const mask = (prefix: number): string => v4(SPACE - 2 ** (32 - prefix));

export const wildcard = (prefix: number): string => v4(2 ** (32 - prefix) - 1);

/** Usable host addresses: /31 is a point-to-point pair, /32 one address. */
export function hosts(r: Range4): {
  first: number;
  last: number;
  count: number;
} {
  if (r.prefix >= 31) return { first: r.start, last: end(r), count: r.size };
  return { first: r.start + 1, last: end(r) - 1, count: r.size - 2 };
}

export const overlap = (a: Range4, b: Range4): [number, number] | null => {
  const lo = Math.max(a.start, b.start);
  const hi = Math.min(end(a), end(b));
  return lo <= hi ? [lo, hi] : null;
};

export const contains = (outer: Range4, inner: Range4): boolean =>
  inner.start >= outer.start && end(inner) <= end(outer);

const R = (text: string): Range4 => {
  const [a = "", p = "0"] = text.split("/");
  return block(parseV4(a) ?? 0, Number(p));
};

// The kinds of address space, most specific first.
export const KINDS = [
  { kind: "loopback", range: R("127.0.0.0/8") },
  { kind: "linkLocal", range: R("169.254.0.0/16") },
  { kind: "cgnat", range: R("100.64.0.0/10") },
  { kind: "documentation", range: R("192.0.2.0/24") },
  { kind: "documentation", range: R("198.51.100.0/24") },
  { kind: "documentation", range: R("203.0.113.0/24") },
  { kind: "protocol", range: R("192.0.0.0/24") },
  { kind: "benchmarking", range: R("198.18.0.0/15") },
  { kind: "thisNetwork", range: R("0.0.0.0/8") },
  { kind: "multicast", range: R("224.0.0.0/4") },
  { kind: "reserved", range: R("240.0.0.0/4") },
  { kind: "private", range: R("10.0.0.0/8") },
  { kind: "private", range: R("172.16.0.0/12") },
  { kind: "private", range: R("192.168.0.0/16") },
] as const;

export type Kind = (typeof KINDS)[number]["kind"] | "public" | "mixed";

/** The kind of space a range is in, and the block of that kind it's in. */
export function kindOf(r: Range4): { kind: Kind; within: Range4 | null } {
  for (const k of KINDS) {
    if (contains(k.range, r)) return { kind: k.kind, within: k.range };
  }
  const touches = KINDS.some((k) => overlap(k.range, r));
  return { kind: touches ? "mixed" : "public", within: null };
}

/** A dotted mask's prefix length (255.255.255.0 is 24), or null when its
 * ones and zeros are mixed (255.0.255.0). */
export function maskPrefix(text: string): number | null {
  const n = parseV4(text);
  if (n === null) return null;
  const hostPart = SPACE - 1 - n;
  const bits = Math.log2(hostPart + 1);
  return Number.isInteger(bits) ? 32 - bits : null;
}

/** The smallest block holding every range given. */
export function supernet(ranges: Range4[]): Range4 {
  const lo = Math.min(...ranges.map((r) => r.start));
  const hi = Math.max(...ranges.map(end));
  let prefix = 32;
  while (prefix > 0 && end(block(lo, prefix)) < hi) prefix--;
  return block(lo, prefix);
}

// Docker's default address pools (moby's ipamutils): the bridge
// (172.17.0.0/16); the pool compose networks are taken from, in /16s
// (172.18.0.0 to 172.31.255.255); and once those are used up,
// 192.168.0.0/16 in /20s. As spans of addresses.
export const DOCKER = {
  bridge: {
    first: R("172.17.0.0/32").start,
    last: R("172.17.255.255/32").start,
  },
  pool: { first: R("172.18.0.0/32").start, last: R("172.31.255.255/32").start },
  last: {
    first: R("192.168.0.0/32").start,
    last: R("192.168.255.255/32").start,
  },
};
