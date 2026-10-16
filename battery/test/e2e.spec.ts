import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkBasics,
  consoleErrors,
  layoutShift,
  serve,
  SIZES,
} from "../../shared/test/e2e";
import { copy } from "../src/copy";

const PORT = 4421;
const BASE = `http://127.0.0.1:${PORT}/`;
const FIXTURES = join(import.meta.dirname, "fixtures");
const WORN_OUT =
  "Worn out. It holds only 57% of its original charge. Plan a replacement.";
let stop: (() => Promise<void>) | undefined;

test.beforeAll(async () => {
  stop = await serve("battery", PORT);
});

test.afterAll(async () => {
  await stop?.();
});

/** Drops fixtures onto the zone the way a file manager would; a name can
 * come with its own text (a fixture changed for the test). */
async function drop(page: Page, ...files: (string | [string, string])[]) {
  const list = files.map((f) =>
    typeof f === "string"
      ? ([f, readFileSync(join(FIXTURES, f), "utf8")] as const)
      : f,
  );
  const transfer = await page.evaluateHandle((all) => {
    const dt = new DataTransfer();
    for (const [fileName, body] of all) {
      dt.items.add(new File([body], fileName, { type: "text/html" }));
    }
    return dt;
  }, list);
  const zone = page.locator(".drop");
  await zone.dispatchEvent("dragenter", { dataTransfer: transfer });
  await zone.dispatchEvent("dragover", { dataTransfer: transfer });
  await zone.dispatchEvent("drop", { dataTransfer: transfer });
}

test("meets the shared basics", async ({ page }) => {
  await checkBasics(page, BASE);
});

test("picking the English report gives the verdict", async ({ page }) => {
  await page.goto(BASE);
  await page.setInputFiles(".drop input", join(FIXTURES, "en.html"));
  await expect(page.locator(".verdict")).toHaveText(WORN_OUT);
  await expect(page.locator(".history svg path")).toHaveCount(2);
  await expect(page.locator(".estimate")).toContainText(
    "3\u00a0h\u00a015\u00a0min",
  );
});

test("dropping the Italian report gives the same verdict", async ({ page }) => {
  await page.goto(BASE);
  await drop(page, "it.html");
  await expect(page.locator(".verdict")).toHaveText(WORN_OUT);
});

test("the XML report gets its own message", async ({ page }) => {
  await page.goto(BASE);
  await drop(page, "report.xml");
  await expect(page.locator(".problem")).toHaveText(
    "This is the XML version of the report. Run powercfg /batteryreport without /xml and drop the HTML file.",
  );
  await expect(page.locator(".verdict")).toHaveCount(0);
});

test("two batteries, two verdicts", async ({ page }) => {
  await page.goto(BASE);
  await drop(page, "two-batteries.html");
  await expect(page.locator(".verdict")).toHaveCount(2);
  // Each battery's name is a heading under the label, its verdict under it.
  const yours = page.locator(".pane.yours");
  await expect(yours.getByRole("heading", { level: 3 })).toHaveCount(2);
  await expect(yours.getByRole("heading", { level: 4 })).toHaveCount(2);
});

test("a history of dashes: no chart, and it says so", async ({ page }) => {
  await page.goto(BASE);
  await drop(page, "no-history.html");
  await expect(page.locator(".verdict")).toHaveText(WORN_OUT);
  await expect(page.locator(".history")).toHaveCount(0);
  await expect(page.locator(".no-history")).toHaveText(
    "Windows kept no capacity history for this battery.",
  );
  // No estimate at full charge either, so no estimate sentence.
  await expect(page.locator(".estimate")).toHaveCount(0);
});

test("two files at once: the first is read, and the page says so", async ({
  page,
}) => {
  await page.goto(BASE);
  await drop(page, "en.html", "it.html");
  await expect(page.locator(".one-file")).toHaveText(
    "One file at a time: showing en.html.",
  );
  await expect(page.locator(".verdict")).toHaveText(WORN_OUT);
  await expect(page.locator("[data-status]")).toHaveText(
    `One file at a time: showing en.html. ${WORN_OUT}`,
  );
  // One file: no such line.
  await drop(page, "it.html");
  await expect(page.locator(".one-file")).toHaveCount(0);
});

/** Where the dashed line starts, and where the label naming it sits. */
const labelAndLine = (page: Page) =>
  page.evaluate(() => {
    const svg = document.querySelector(".history svg") as SVGSVGElement;
    const d = svg.querySelector(".design")?.getAttribute("d") ?? "";
    const y0 = Number(/^M0 ([\d.]+)/.exec(d)?.[1]);
    const box = svg.getBoundingClientRect();
    const tick = document.querySelector(".tick") as HTMLElement;
    const t = tick.getBoundingClientRect();
    return {
      text: tick.textContent,
      line: box.top + (y0 / 200) * box.height,
      top: t.top,
      bottom: t.bottom,
    };
  });

test("the chart's label is the original capacity, beside its dashed line", async ({
  page,
}) => {
  await page.goto(BASE);
  await drop(page, "en.html");
  const usual = await labelAndLine(page);
  expect(usual.text).toBe("45,000\u00a0mWh");
  expect(Math.abs(usual.bottom + 2 - usual.line)).toBeLessThan(2);
  // A young battery over 100%: the original capacity still, now under
  // its line (the solid line starts above it).
  const over = readFileSync(join(FIXTURES, "en.html"), "utf8").replaceAll(
    "45,000 mWh",
    "24,000 mWh",
  );
  await drop(page, ["battery-report.html", over]);
  await expect(page.locator(".verdict")).toHaveText(
    "Healthy. It holds 106% of its original charge. Over 100% is normal for a young battery.",
  );
  const young = await labelAndLine(page);
  expect(young.text).toBe("24,000\u00a0mWh");
  expect(young.line).toBeGreaterThan(usual.line + 40);
  expect(Math.abs(young.top - 4 - young.line)).toBeLessThan(2);
});

test("no original capacity: it says not recorded, never 0 mWh", async ({
  page,
}) => {
  await page.goto(BASE);
  await drop(page, "design-zero.html");
  const row = page.locator(".numbers div", { hasText: "Original capacity" });
  await expect(row.locator("dd")).toHaveText("Not recorded");
  await expect(page.locator(".answer")).not.toContainText(/(^|[^\d,.])0\smWh/);
});

test("two batteries: the chart and estimate say they're both together", async ({
  page,
}) => {
  await page.goto(BASE);
  await drop(page, "two-batteries.html");
  await expect(page.locator(".history figcaption")).toContainText(
    "Full charge capacity of both batteries together, week by week. The dashed line is their original capacity.",
  );
  await expect(page.locator(".estimate")).toHaveText(
    /^With both batteries at full charge Windows estimated /,
  );
});

test("not a report, then a report: the page recovers", async ({ page }) => {
  await page.goto(BASE);
  await drop(page, "not-a-report.html");
  await expect(page.locator(".problem")).toHaveText(
    "This doesn’t look like a battery report. Drop the battery-report.html file that powercfg saves.",
  );
  await drop(page, "en.html");
  await expect(page.locator(".problem")).toHaveCount(0);
  await expect(page.locator(".verdict")).toHaveText(WORN_OUT);
});

test("never shows the PC's name or the serial number", async ({ page }) => {
  await page.goto(BASE);
  for (const name of ["en.html", "two-batteries.html", "it.html"]) {
    await drop(page, name);
    await expect(page.locator(".verdict").first()).toBeVisible();
    const text = await page.locator("body").innerText();
    expect(text).not.toContain("TEST-PC");
    expect(text).not.toContain("000000");
  }
});

test("the command and the file name never break, and nothing overflows", async ({
  browser,
}) => {
  for (const width of [320, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 800 },
    });
    const page = await context.newPage();
    await page.goto(BASE);
    const lines = await page
      .locator(".drop-how code")
      .evaluateAll((codes) => codes.map((c) => c.getClientRects().length));
    expect(lines, `code spans on one line at ${width}`).toEqual([1, 1]);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    );
    expect(over, `overflow at ${width}`).toBeLessThanOrEqual(0);
    await page.setInputFiles(".drop input", join(FIXTURES, "en.html"));
    await expect(page.locator(".verdict")).toBeVisible();
    const after = await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    );
    expect(after, `overflow with a result at ${width}`).toBeLessThanOrEqual(0);
    await context.close();
  }
});

test("an example report, labelled, drawn by the same code, never announced", async ({
  page,
}) => {
  const errors = consoleErrors(page);
  await page.goto(BASE);
  const example = page.getByRole("region", { name: copy.example });
  await expect(example).toBeVisible();
  await expect(example.locator("h2")).toHaveText(copy.example);
  // The verdict is a heading one level under the label.
  await expect(example.getByRole("heading", { level: 3 })).toHaveText(WORN_OUT);
  await expect(example.locator(".numbers")).toBeVisible();
  await expect(example.locator(".history svg path.full")).toHaveCount(1);
  // Nothing about this page reading the visitor's report.
  await expect(example.locator(".kept")).toHaveCount(0);
  await expect(page.locator("[data-status]")).toHaveText("");
  // The example's report is a module of the page, never fetched.
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);

  await drop(page, "en.html");
  await expect(page.locator(".answer .verdict")).toHaveText(WORN_OUT);
  // In the answer too.
  await expect(
    page.locator(".pane.yours").getByRole("heading", { level: 3 }),
  ).toHaveText(WORN_OUT);
  await expect(example).toHaveCount(0);
  await expect(page.locator("[data-status]")).toHaveText(WORN_OUT);
  expect(errors).toEqual([]);
});

test("without JavaScript there's no example", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(BASE);
  await expect(page.locator(".example")).toBeHidden();
  await context.close();
});

test("the example arrives without moving anything", async ({ browser }) => {
  for (const viewport of SIZES) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const shift = await layoutShift(page, BASE, ".example .verdict");
    expect(shift, `${viewport.width}×${viewport.height}`).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
      `overflow at ${viewport.width}`,
    ).toBe(0);
    await context.close();
  }
});
