// What the page loads with the first question: the lookups and the
// drawing.
import { analyze } from "./analyze";
import { COPY } from "./copy";
import { DnsError, doh } from "./dns";
import { reservedName } from "./normalize";
import { renderReport } from "./render";

export type Result =
  { nodes: HTMLElement[]; verdict: string } | { problem: string };

const resolve = doh();

// A check called off with its signal rejects with the signal's reason,
// never a problem to show: whoever aborted it has moved on.
export async function check(
  domain: string,
  signal?: AbortSignal,
): Promise<Result> {
  // Never asked of Cloudflare, whoever calls this.
  if (reservedName(domain)) return { problem: COPY.reserved };
  try {
    const report = await analyze(domain, resolve, signal);
    if ("missing" in report) return { problem: COPY.missing(domain) };
    return renderReport(document, report);
  } catch (error) {
    if (error instanceof DnsError) return { problem: COPY.noAnswer };
    throw error;
  }
}
