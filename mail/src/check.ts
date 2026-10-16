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

export async function check(domain: string): Promise<Result> {
  // Never asked of Cloudflare, whoever calls this.
  if (reservedName(domain)) return { problem: COPY.reserved };
  try {
    const report = await analyze(domain, resolve);
    if ("missing" in report) return { problem: COPY.missing(domain) };
    return renderReport(document, report);
  } catch (error) {
    if (error instanceof DnsError || error instanceof TypeError) {
      return { problem: COPY.noAnswer };
    }
    throw error;
  }
}
