// A resolver for the tests: answers from a table, every question counted.
import type { DnsAnswer, Resolve, RRType } from "../src/dns";

const TYPES: Record<string, number> = { A: 1, CNAME: 5, MX: 15, TXT: 16 };

export interface Zone {
  // "name TYPE" → records as [type, data], or a whole answer.
  [question: string]: [keyof typeof TYPES, string][] | Partial<DnsAnswer>;
}

export function stub(zone: Zone, { ad = false, nxdomain = false } = {}) {
  const asked: string[] = [];
  const resolve: Resolve = (name: string, type: RRType) => {
    const q = `${name} ${type}`;
    asked.push(q);
    const entry = zone[q];
    if (Array.isArray(entry)) {
      return Promise.resolve({
        status: 0,
        ad,
        records: entry.map(([t, data]) => ({ type: TYPES[t] ?? 0, data })),
      });
    }
    return Promise.resolve({
      status: nxdomain ? 3 : 0,
      ad,
      records: [],
      ...entry,
    });
  };
  return { resolve, asked };
}

// TXT data as DoH JSON gives it: quoted, long values split in parts.
export const txt = (...parts: string[]) => parts.map((p) => `"${p}"`).join(" ");
