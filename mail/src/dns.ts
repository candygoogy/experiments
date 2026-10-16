// DNS questions over HTTPS, to Cloudflare's public resolver only (the
// page's CSP allows no other host): JSON answers, six questions at a time,
// each given 5 seconds and one more try. A question whose signal aborts
// stops where it is, without the other try, and gives up its place.

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

export type Resolve = (
  name: string,
  type: RRType,
  signal?: AbortSignal,
) => Promise<DnsAnswer>;

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
  const slot = (signal?: AbortSignal) =>
    new Promise<void>((go, stop) => {
      if (signal?.aborted) return stop(signal.reason);
      if (running < limit) return (running++, go());
      // Still waiting when it's called off: it leaves the line and never
      // takes a place.
      const leave = () => {
        queue.splice(queue.indexOf(next), 1);
        stop(signal?.reason);
      };
      const next = () => {
        signal?.removeEventListener("abort", leave);
        go();
      };
      signal?.addEventListener("abort", leave, { once: true });
      queue.push(next);
    });
  const free = () => {
    const next = queue.shift();
    if (next) next();
    else running--;
  };

  const once = async (
    name: string,
    type: RRType,
    signal?: AbortSignal,
  ): Promise<DnsAnswer> => {
    const url = `${ENDPOINT}?name=${encodeURIComponent(name)}&type=${type}`;
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetcher(url, {
      headers: { accept: "application/dns-json" },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
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

  return async (name, type, signal) => {
    await slot(signal);
    try {
      let last: unknown;
      for (let i = 0; i < tries; i++) {
        try {
          return await once(name, type, signal);
        } catch (error) {
          // Called off, not failed: no other try.
          if (signal?.aborted) throw signal.reason;
          last = error;
        }
      }
      throw last instanceof DnsError ? last : new DnsError(String(last));
    } finally {
      free();
    }
  };
}
