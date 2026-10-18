import { test } from "@playwright/test";
import { checkBasics, serve } from "../../shared/test/e2e";

const PORT = 4420;
const BASE = `http://127.0.0.1:${PORT}/`;
let stop: (() => Promise<void>) | undefined;

test.beforeAll(async () => {
  stop = await serve("template", PORT);
});

test.afterAll(async () => {
  await stop?.();
});

test("meets the shared basics", async ({ page }) => {
  await checkBasics(page, BASE);
});

// The shared page (shared/): what every tool has, checked once, here.
// scripts/new.mjs leaves this part out of a new tool's copy.
import { expect } from "@playwright/test";

test("in forced colors the theme switch shows its setting", async ({
  browser,
}) => {
  const context = await browser.newContext({ forcedColors: "active" });
  const page = await context.newPage();
  await page.goto(BASE);
  const look = await page.evaluate(() => {
    const css = (selector: string) => {
      const node = document.querySelector(selector);
      if (!node) throw new Error(`no ${selector}`);
      return getComputedStyle(node);
    };
    return {
      track: css(".themes").backgroundColor,
      pill: css(".themes .pill").backgroundColor,
      label: css(".themes button").color,
      chosen: css(".themes .ink").color,
    };
  });
  expect(look.pill).not.toBe(look.track);
  expect(look.chosen).not.toBe(look.label);
  await context.close();
});

// Tab past the last link wraps round to "Skip to content", which must show
// in the window where the reader is, without the page jumping to its top.
test("Tab past the last link wraps to the skip link, and it shows in the window", async ({
  page,
}) => {
  // A short window, so the page scrolls and the top is out of sight.
  await page.setViewportSize({ width: 390, height: 400 });
  await page.goto(BASE);
  // The empty template is short: made taller here, so it scrolls as far
  // as a tool's page does.
  await page.evaluate(() => {
    (document.querySelector("main") as HTMLElement).style.minHeight = "250vh";
  });
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  const bottom = await page.evaluate(() => scrollY);
  expect(bottom).toBeGreaterThan(200);
  await page.locator("footer a").last().focus();
  const skip = page.locator(".skip");
  // Past the last link focus may stop on the document itself first.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    if (await skip.evaluate((a) => a === document.activeElement)) break;
  }
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport({ ratio: 1 });
  // It comes to the reader; the page doesn't jump back to its top.
  expect(await page.evaluate(() => scrollY)).toBe(bottom);
});
