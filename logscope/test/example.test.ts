import { describe, expect, test } from "vitest";
import { exampleHtml, exampleResult } from "../example-html.ts";
import { verdict } from "../src/summary.ts";

describe("the page's example", () => {
  test("shows both a problem worth a look and the noise to ignore", async () => {
    const result = await exampleResult();
    expect(verdict(result)).toBe(
      "This PC restarted without shutting down 3 times.",
    );
    const html = await exampleHtml();
    expect(html).toContain("Kernel-Power 41");
    expect(html).toContain("Usually safe to ignore");
    expect(html).toContain("DistributedCOM 10016");
  });

  test("its verdict heads it, one level under the label; no filters, no information rows", async () => {
    const html = await exampleHtml();
    expect(html).toMatch(/^<h3 class="verdict">/);
    expect(html).not.toContain("<h2");
    expect(html).toContain('<h4 class="name">');
    expect(html).not.toContain("filters");
    expect(html).not.toContain("Service Control Manager 7036");
    expect(html).not.toContain("The log stays on this device");
  });
});
