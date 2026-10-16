// DNS questions over HTTPS, to Cloudflare's public resolver only (the
// page's CSP allows no other host): JSON answers, six questions at a time,
// each given 5 seconds and one more try.

// A only for an SPF exists term, which asks whether a name has an address.
export type RRType = "MX" | "TXT" | "CNAME" | "A";

export interface DnsRecord {
  type: number;
  data: string;
}

export interface DnsAnswer {
  // 0: an answer (maybe empty); 3: the name doesn't exist.
  status: number;
  // Validated with DNSSEC.
  ad: boolean;
  records: DnsRecord[];
}

export type Resolve = (name: string, type: RRType) => Promise<DnsAnswer>;

/** The resolver didn't answer, or answered with a failure. */
export class DnsError extends Error {}

export const ENDPOINT = "https://cloudflare-dns.com/dns-query";

interface DohJson {
  Status?: number;
  AD?: boolean;
  // The answer was cut short: what's there may not be all of it.
  TC?: boolean;
  Answer?: { type?: number; data?: string }[];
}

export function doh(
  fetcher: typeof fetch = (...args) => fetch(...args),
  { limit = 6, timeoutMs = 5000, tries = 2 } = {},
): Resolve {
  let running = 0;
  const queue: (() => void)[] = [];
  const slot = () =>
    running < limit
      ? (running++, Promise.resolve())
      : new Promise<void>((go) => queue.push(go));
  const free = () => {
    const next = queue.shift();
    if (next) next();
    else running--;
  };

  const once = async (name: string, type: RRType): Promise<DnsAnswer> => {
    const url = `${ENDPOINT}?name=${encodeURIComponent(name)}&type=${type}`;
    const response = await fetcher(url, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new DnsError(`HTTP ${response.status}`);
    const body = (await response.json()) as DohJson;
    const status = body.Status ?? -1;
    if (status !== 0 && status !== 3) throw new DnsError(`status ${status}`);
    if (body.TC === true) throw new DnsError("truncated");
    return {
      status,
      ad: body.AD === true,
      records: (body.Answer ?? []).flatMap((a) =>
        typeof a.type === "number" && typeof a.data === "string"
          ? [{ type: a.type, data: a.data }]
          : [],
      ),
    };
  };

  return async (name, type) => {
    await slot();
    try {
      let last: unknown;
      for (let i = 0; i < tries; i++) {
        try {
          return await once(name, type);
        } catch (error) {
          last = error;
        }
      }
      throw last instanceof DnsError ? last : new DnsError(String(last));
    } finally {
      free();
    }
  };
}
