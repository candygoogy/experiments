import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { checkBasics, serve } from "../../shared/test/e2e";

const PORT = 4426;
const BASE = `http://127.0.0.1:${PORT}/`;
let stop: (() => Promise<void>) | undefined;

test.beforeAll(async () => {
  stop = await serve("subnet", PORT);
});

test.afterAll(async () => {
  await stop?.();
});

const watch = (page: Page) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
};

const type = async (page: Page, text: string) => {
  await page.locator("#plan").fill(text);
};

test("meets the shared basics", async ({ page }) => {
  await checkBasics(page, BASE);
});

test("the example is on the page, drawn, and says nothing aloud", async ({
  page,
}) => {
  const errors = watch(page);
  await page.goto(BASE);
  const example = page.getByRole("region", { name: "Example: a homelab plan" });
  await expect(example.locator(".verdict")).toHaveText(
    "This plan works, but one thing is worth a look.",
  );
  // The verdict is a heading one level under the pane’s label.
  await expect(example.getByRole("heading", { level: 3 })).toHaveText(
    "This plan works, but one thing is worth a look.",
  );
  await expect(example.locator(".ranges > li")).toHaveCount(5);
  await expect(example.locator(".findings li")).toHaveText([
    "lab is Docker’s default bridge (172.17.0.0/16). A Docker host routes that range to its own bridge, so the host and its containers can’t reach devices in lab.",
    "home, iot, guest, and servers are in 192.168.0.0/16, which Docker also gives compose networks (in /20s) once 172.17 to 172.31 are used up, so on a busy Docker host a compose network can clash with them.",
  ]);
  await expect(example.locator(".findings li.quiet")).toHaveCount(1);
  // Two strips, drawn after the first paint: 172.16/12 (with Docker's
  // bracket) and 192.168/16.
  await expect(example.locator(".strip-head .block")).toHaveText([
    "172.16.0.0/12",
    "192.168.0.0/16",
  ]);
  await expect(example.locator("svg rect.range")).toHaveCount(5);
  await expect(example.locator("svg line.bracket")).toHaveCount(3);
  await expect(example.locator(".split")).toHaveCount(0);
  await expect(page.locator(".live")).toHaveText("");
  expect(errors).toEqual([]);
});

test("typing draws the plan and its text; an empty box brings the example back", async ({
  page,
}) => {
  const errors = watch(page);
  await page.goto(BASE);
  await type(
    page,
    "home 192.168.1.0/24\ncameras 192.168.1.128/25\nlab 10.10.0.5/16\noops 192.168.300.1/24\nv6 2001:db8:1::/48",
  );
  const yours = page.getByRole("region", { name: "Your plan" });
  await expect(yours.locator(".verdict")).toHaveText(
    "One range sits inside home.",
  );
  await expect(yours.getByRole("heading", { level: 3 })).toHaveText(
    "One range sits inside home.",
  );
  await expect(page.locator(".pane.example")).toBeHidden();
  await expect(yours.locator(".ranges > li")).toHaveCount(4);
  await expect(yours.locator(".findings li")).toHaveText([
    "Line 4: 300 isn’t a valid octet (0 to 255).",
    "10.10.0.5/16 is a host address; treated as network 10.10.0.0/16.",
    "cameras sits inside home. Fine if home is the parent block; a conflict if they’re separate networks.",
    "v6 is kept for documentation (2001:db8::/32): it’s for examples, never a real network.",
    "home and cameras are in 192.168.0.0/16, which Docker also gives compose networks (in /20s) once 172.17 to 172.31 are used up, so on a busy Docker host a compose network can clash with them.",
  ]);
  await expect(yours).toContainText("v6 is a /48: 65,536 /64 networks.");
  // cameras is drawn in the lane under home, not hatched over it.
  await expect(yours.locator("svg rect.clash")).toHaveCount(0);
  await expect(yours.locator("svg rect.range")).toHaveCount(3);
  await expect(page.locator(".live")).toHaveText("One range sits inside home.");
  await type(page, "");
  await expect(page.locator(".pane.example")).toBeVisible();
  await expect(page.locator(".pane.yours")).toBeHidden();
  expect(errors).toEqual([]);
});

test("split: try 4, see it on the map, add it under its range", async ({
  page,
}) => {
  const errors = watch(page);
  await page.goto(BASE);
  await type(
    page,
    "home 192.168.1.0/24\niot 192.168.20.0/24\nguest 192.168.30.0/24",
  );
  const yours = page.locator(".pane.yours");
  const iot = yours.locator(".ranges > li").filter({
    has: page.getByRole("heading", { name: "iot", exact: true }),
  });
  await iot.getByRole("button", { name: "Split" }).click();
  await expect(iot.getByRole("button", { name: "Split" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await iot.getByRole("button", { name: "4", exact: true }).click();
  await expect(iot.locator(".split-list li")).toHaveText([
    "192.168.20.0/26: 62 devices",
    "192.168.20.64/26: 62 devices",
    "192.168.20.128/26: 62 devices",
    "192.168.20.192/26: 62 devices",
  ]);
  await expect(yours.locator("svg line.preview")).toHaveCount(3);
  await iot.getByRole("button", { name: "Add these 4 to the plan" }).click();
  expect(await page.locator("#plan").inputValue()).toBe(
    "home 192.168.1.0/24\niot 192.168.20.0/24\n  iot-1 192.168.20.0/26\n  iot-2 192.168.20.64/26\n  iot-3 192.168.20.128/26\n  iot-4 192.168.20.192/26\nguest 192.168.30.0/24",
  );
  await expect(yours.locator(".ranges > li")).toHaveCount(7);
  await expect(yours.locator(".ranges > li.part")).toHaveCount(4);
  await expect(yours.locator(".verdict")).toHaveText("This plan works.");
  await expect(yours.locator("svg rect.clash")).toHaveCount(0);
  await expect(page.locator(".live")).toHaveText("Added 4 parts under iot.");
  await expect(page.locator(":focus")).toHaveText("iot");
  expect(errors).toEqual([]);
});

test("split to fit devices, and what can't be done", async ({ page }) => {
  await page.goto(BASE);
  await type(page, "iot 192.168.20.0/24");
  const iot = page.locator(".pane.yours .ranges > li").first();
  await iot.getByRole("button", { name: "Split" }).click();
  const fit = iot.getByLabel(/Fit/);
  await fit.fill("50");
  await expect(iot.locator(".split-list li")).toHaveCount(4);
  await fit.fill("300");
  await expect(iot.locator(".split-problem")).toHaveText(
    "No part of this range fits that many devices.",
  );
  await expect(iot.getByRole("button", { name: /^Add/ })).toHaveCount(0);
});

test(
  "a 500-line plan: no main-thread task over 200 ms",
  { tag: "@perf" },
  async ({ page }) => {
    await page.goto(BASE);
    await page.evaluate(() => {
      const w = window as unknown as { long: number[] };
      w.long = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.long.push(Math.round(e.duration));
      }).observe({ type: "longtask" });
    });
    const lines = Array.from(
      { length: 500 },
      (_, i) => `net${i} 10.${Math.floor(i / 250)}.${i % 250}.0/24`,
    );
    // A few clashes too.
    lines.push("big 10.0.0.0/16", "dup 10.1.5.0/24");
    await type(page, lines.join("\n"));
    await expect(page.locator(".pane.yours .ranges > li")).toHaveCount(502);
    await page.waitForTimeout(500);
    const long = await page.evaluate(
      () => (window as unknown as { long: number[] }).long,
    );
    expect(Math.max(0, ...long)).toBeLessThan(200);
  },
);

test("down the page on phones, Docker's label along its bracket", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto(BASE);
  const svg = page.locator(".pane.example svg").first();
  await expect(svg.locator("rect.range")).toHaveCount(1);
  // Drawn down the page: the free stretch, the range and the next free
  // stretch stack in one column, top to bottom, once the strip has its
  // final size.
  await expect
    .poll(async () =>
      svg.locator("rect.range, rect.gap").evaluateAll((rs) => {
        const boxes = rs
          .map((r) => r.getBoundingClientRect())
          .sort((a, b) => a.top - b.top);
        return (
          boxes.length >= 3 &&
          boxes.every((b, i) => {
            const prev = boxes[i - 1];
            return (
              b.height > 0 &&
              (!prev ||
                (b.top >= prev.bottom - 1 && Math.abs(b.left - prev.left) < 3))
            );
          })
        );
      }),
    )
    .toBe(true);
  await expect(svg.locator("text.note")).toHaveAttribute(
    "transform",
    /rotate\(-90/,
  );
  await context.close();
});

test("nothing shifts, from 320 to 1920 wide, loading or typing", async ({
  browser,
}) => {
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const w = window as unknown as { cls: number };
      w.cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        })[]) {
          if (!e.hadRecentInput) w.cls += e.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(BASE);
    await page.waitForTimeout(600);
    await page
      .locator("#plan")
      .pressSequentially("home 192.168.1.0/24\nlab 172.17.0.0/16", {
        delay: 20,
      });
    await page.waitForTimeout(800);
    const cls = await page.evaluate(
      () => (window as unknown as { cls: number }).cls,
    );
    expect(cls, `CLS at ${width}`).toBe(0);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    );
    expect(over, `overflow at ${width}`).toBeLessThanOrEqual(0);
    await context.close();
  }
});

// Plans that once went wrong, in the browser.

const sized = async (
  browser: Browser,
  width = 390,
  colorScheme: "light" | "dark" = "light",
) => {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    colorScheme,
  });
  return { context, page: await context.newPage() };
};

test("many lanes over the same addresses: drawn, banded past 12, no errors", async ({
  page,
}) => {
  const errors = watch(page);
  await page.goto(BASE);
  const yours = page.locator(".pane.yours");
  for (const n of [31, 500]) {
    const lines = Array.from({ length: n }, (_, i) => `n${i} 10.0.0.0/24`);
    await type(page, lines.join("\n"));
    await expect(yours.locator(".ranges > li")).toHaveCount(n);
    await page.waitForTimeout(300);
    // Twelve lanes drawn, the rest one hatched band.
    await expect(yours.locator("svg rect.range")).toHaveCount(12);
    const depths = await yours
      .locator("svg rect.range, svg rect.clash")
      .evaluateAll((rs) => rs.map((r) => Number(r.getAttribute("height"))));
    expect(Math.min(...depths), `${n} lines`).toBeGreaterThan(0);
    await expect(yours.locator(".findings li")).toHaveText([
      `n0 and ${n - 1} others are the same range, 10.0.0.0/24.`,
    ]);
  }
  expect(errors).toEqual([]);
});

test(
  "500 identical lines: within the long-task budget",
  { tag: "@perf" },
  async ({ page }) => {
    const errors = watch(page);
    await page.goto(BASE);
    await page.evaluate(() => {
      const w = window as unknown as { long: number[] };
      w.long = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.long.push(Math.round(e.duration));
      }).observe({ type: "longtask" });
    });
    const lines = Array.from({ length: 500 }, (_, i) => `n${i} 10.0.0.0/24`);
    await type(page, lines.join("\n"));
    await expect(page.locator(".pane.yours .ranges > li")).toHaveCount(500);
    await page.waitForTimeout(1500);
    const long = await page.evaluate(
      () => (window as unknown as { long: number[] }).long,
    );
    expect(Math.max(0, ...long)).toBeLessThan(200);
    expect(errors).toEqual([]);
  },
);

test("the verdict notices public, loopback and multicast space", async ({
  page,
}) => {
  await page.goto(BASE);
  for (const line of ["mc 224.0.0.0/24", "lo 127.0.0.0/8", "pub 8.8.8.0/24"]) {
    await type(page, line);
    await expect(page.locator(".pane.yours .verdict")).toHaveText(
      "This plan works, but one thing is worth a look.",
    );
  }
});

test("the largest free block can be read out; only the drawing is hidden", async ({
  page,
}) => {
  await page.goto(BASE);
  const example = page.getByRole("region", { name: "Example: a homelab plan" });
  await expect(
    example
      .getByRole("paragraph")
      .filter({ hasText: "Free: 192.168.128.0/17" }),
  ).toHaveCount(1);
  await expect(example.locator(".track").first()).toHaveAttribute(
    "aria-hidden",
    "true",
  );
});

test("typing two lines: the verdict is read out once, after the pause", async ({
  page,
}) => {
  await page.goto(BASE);
  await page.evaluate(() => {
    const w = window as unknown as { said: string[] };
    w.said = [];
    const live = document.querySelector(".live");
    if (!live) return;
    new MutationObserver(() => w.said.push(live.textContent ?? "")).observe(
      live,
      { childList: true, characterData: true, subtree: true },
    );
  });
  await page
    .locator("#plan")
    .pressSequentially("home 192.168.1.0/24\niot 192.168.1.0/25", {
      delay: 180,
    });
  await page.waitForTimeout(1500);
  const said = await page.evaluate(
    () => (window as unknown as { said: string[] }).said,
  );
  expect(said).toEqual(["One range sits inside home."]);
});

test("clearing the box, and typing the same verdict again, are both read out", async ({
  page,
}) => {
  await page.goto(BASE);
  await page.evaluate(() => {
    const w = window as unknown as { said: string[] };
    w.said = [];
    const live = document.querySelector(".live");
    if (!live) return;
    new MutationObserver(() => w.said.push(live.textContent ?? "")).observe(
      live,
      { childList: true, characterData: true, subtree: true },
    );
  });
  const area = page.locator("#plan");
  const live = page.locator(".live");
  await area.fill("home 192.168.1.0/24");
  await expect(live).toHaveText("This plan works.", { timeout: 3000 });
  await area.fill("");
  await expect(live).toHaveText(
    "This plan works, but one thing is worth a look.",
    { timeout: 3000 },
  );
  await area.fill("home 192.168.1.0/24");
  await expect(live).toHaveText("This plan works.", { timeout: 3000 });
  const said = await page.evaluate(
    () => (window as unknown as { said: string[] }).said,
  );
  expect(said.filter((t) => t === "This plan works.")).toHaveLength(2);
});

test("split → add keeps comments and parts after a blank line out of the plan", async ({
  page,
}) => {
  await page.goto(BASE);
  await type(
    page,
    "home 10.0.0.0/24\n  # keep me\n  mine 10.0.0.0/25\n\n  late 10.0.0.128/25\nz 10.1.0.0/24",
  );
  const yours = page.locator(".pane.yours");
  const home = yours.locator(".ranges > li").first();
  await home.getByRole("button", { name: "Split" }).click();
  await home.getByRole("button", { name: "2", exact: true }).click();
  await home.getByRole("button", { name: "Add these 2 to the plan" }).click();
  expect(await page.locator("#plan").inputValue()).toBe(
    "home 10.0.0.0/24\n  home-1 10.0.0.0/25\n  home-2 10.0.0.128/25\n  # keep me\n\nz 10.1.0.0/24",
  );
  await expect(yours.locator(".verdict")).toHaveText("This plan works.");
});

test("a half-typed line isn't a bad line until the caret leaves it", async ({
  page,
}) => {
  await page.goto(BASE);
  const area = page.locator("#plan");
  await area.pressSequentially("home 192.168.1.0/24\niot 192.168", {
    delay: 20,
  });
  const yours = page.locator(".pane.yours");
  await page.waitForTimeout(300);
  await expect(yours.locator(".verdict")).toHaveText("This plan works.");
  // Up a line: the half-typed one counts now.
  await area.press("ArrowUp");
  await expect(yours.locator(".verdict")).toHaveText(
    "This plan works, but one thing is worth a look.",
  );
});

test("ranges across blocks share a strip; copies are hatched; many public ranges stay short", async ({
  page,
}) => {
  await page.goto(BASE);
  const yours = page.locator(".pane.yours");
  await type(page, "a 8.8.0.0/16\nb 8.8.8.0/24");
  await expect(yours.locator(".track")).toHaveCount(1);
  await expect(yours.locator("svg rect.range")).toHaveCount(2);
  await expect(yours.locator("svg rect.clash")).toHaveCount(0);
  await type(page, "a 8.8.0.0/16\nb 8.8.8.0/24\nc 8.8.8.0/24");
  await expect(yours.locator("svg rect.clash")).toHaveCount(1);
  const lines = Array.from(
    { length: 500 },
    (_, i) => `p${i} ${20 + (i >> 8)}.${i & 255}.0.0/24`,
  );
  await type(page, lines.join("\n"));
  await expect(yours.locator(".ranges > li")).toHaveCount(500);
  await expect(yours.locator(".track")).toHaveCount(2);
  const spread = Array.from(
    { length: 20 },
    (_, i) => `p${i} ${20 + i}.0.0.0/24`,
  );
  await type(page, spread.join("\n"));
  await expect(yours.locator(".track")).toHaveCount(12);
  await expect(yours.locator(".strip-more")).toHaveText(
    "8 more ranges aren’t drawn; they’re all listed below.",
  );
});

test("a dozen strips drawn with a handful of layouts, not two per strip", async ({
  page,
}) => {
  await page.goto(BASE);
  await page.waitForTimeout(300);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const layouts = async () =>
    (await cdp.send("Performance.getMetrics")).metrics.find(
      (m) => m.name === "LayoutCount",
    )?.value ?? 0;
  const spread = Array.from(
    { length: 12 },
    (_, i) => `p${i} ${20 + i}.0.0.0/24`,
  );
  const before = await layouts();
  await page.evaluate((text) => {
    const area = document.querySelector<HTMLTextAreaElement>("#plan");
    if (!area) return;
    area.value = text;
    area.dispatchEvent(new Event("input"));
  }, spread.join("\n"));
  await expect(page.locator(".pane.yours svg rect.range")).toHaveCount(12);
  await page.waitForTimeout(1300);
  expect(await layouts()).toBeLessThan(before + 8);
});

test("every control keeps the website's sizes: 44px target, 32px pill", async ({
  browser,
}) => {
  for (const width of [320, 390, 1440]) {
    const { context, page } = await sized(browser, width);
    await page.goto(BASE);
    await type(page, "iot 192.168.20.0/24");
    const row = page.locator(".pane.yours .ranges > li").first();
    await row.getByRole("button", { name: "Split" }).click();
    await row.getByRole("button", { name: "4", exact: true }).click();
    const sizes = await row
      .locator(
        ".split, .split-ways button, .split-ways input, .split-add, summary",
      )
      .evaluateAll((els) =>
        els
          .filter((e) => e.getClientRects().length)
          .map((e) => {
            const box = e.getBoundingClientRect();
            // The overlay is the touch target; inputs have none. The
            // shared disclosure's summary lays it under ::before (its
            // ::after is the chevron).
            const overlay = getComputedStyle(
              e,
              e.tagName === "SUMMARY" ? "::before" : "::after",
            );
            return {
              name: e.className || e.tagName,
              height: box.height,
              target:
                overlay.content === "none"
                  ? box.height
                  : Number.parseFloat(overlay.height),
            };
          }),
      );
    expect(sizes.length).toBeGreaterThanOrEqual(7);
    for (const { name, height, target } of sizes) {
      expect(height, `${name} at ${width}`).toBeGreaterThanOrEqual(24);
      if (name !== "INPUT") {
        expect(target, `${name} target at ${width}`).toBeGreaterThanOrEqual(44);
      }
    }
    await context.close();
  }
});

test("split twice: the second split replaces the first", async ({ page }) => {
  await page.goto(BASE);
  await type(page, "home 192.168.1.0/24\niot 192.168.20.0/24");
  const yours = page.locator(".pane.yours");
  const iot = yours.locator(".ranges > li").filter({
    has: page.getByRole("heading", { name: "iot", exact: true }),
  });
  await iot.getByRole("button", { name: "Split" }).click();
  await iot.getByRole("button", { name: "4", exact: true }).click();
  await iot.getByRole("button", { name: "Add these 4 to the plan" }).click();
  await iot.getByRole("button", { name: "Split" }).click();
  await iot.getByRole("button", { name: "2", exact: true }).click();
  await iot.getByRole("button", { name: "Add these 2 to the plan" }).click();
  expect(await page.locator("#plan").inputValue()).toBe(
    "home 192.168.1.0/24\niot 192.168.20.0/24\n  iot-1 192.168.20.0/25\n  iot-2 192.168.20.128/25",
  );
  await expect(yours.locator(".verdict")).toHaveText("This plan works.");
});

test("fit: a number that isn't one, and an emptied field", async ({ page }) => {
  await page.goto(BASE);
  await type(page, "iot 192.168.20.0/24");
  const iot = page.locator(".pane.yours .ranges > li").first();
  await iot.getByRole("button", { name: "Split" }).click();
  const fit = iot.getByLabel(/Fit/);
  for (const value of ["0", "-5", "abc", "2.5"]) {
    await fit.fill(value);
    await expect(iot.locator(".split-problem"), value).toHaveText(
      "Type how many devices each part needs: a whole number, 1 or more.",
    );
  }
  await fit.fill("50");
  await expect(iot.locator(".split-list li")).toHaveCount(4);
  await fit.fill("");
  await expect(iot.locator(".split-list li")).toHaveCount(0);
  await expect(iot.getByRole("button", { name: /^Add/ })).toHaveCount(0);
  await expect(page.locator(".pane.yours svg line.preview")).toHaveCount(0);
});

test("Escape closes Split and goes back to its button", async ({ page }) => {
  await page.goto(BASE);
  await type(page, "iot 192.168.20.0/24");
  const iot = page.locator(".pane.yours .ranges > li").first();
  const split = iot.getByRole("button", { name: "Split" });
  await split.click();
  await iot.getByRole("button", { name: "4", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(iot.locator(".split-panel")).toHaveCount(0);
  await expect(split).toHaveAttribute("aria-expanded", "false");
  await expect(split).toBeFocused();
  await expect(page.locator(".pane.yours svg line.preview")).toHaveCount(0);
});

test("phones: compact rows, the numbers folded; desktop rows as they were", async ({
  browser,
}) => {
  {
    const { context, page } = await sized(browser);
    await page.goto(BASE);
    await type(page, "home 192.168.1.0/24");
    const row = page.locator(".pane.yours .ranges > li").first();
    await expect(row.locator(".says")).toBeVisible();
    await expect(row.getByText("Mask 255.255.255.0")).toBeHidden();
    // Name, range and Split share the first line.
    const middles: number[] = [];
    for (const s of [".name", ".cidr", ".split"]) {
      const b = await row.locator(s).boundingBox();
      middles.push(b ? b.y + b.height / 2 : -100);
    }
    expect(Math.max(...middles) - Math.min(...middles)).toBeLessThan(4);
    await row.getByText("Mask and counts").click();
    await expect(row.getByText("Mask 255.255.255.0")).toBeVisible();
    await context.close();
  }
  {
    const { context, page } = await sized(browser, 1440);
    await page.goto(BASE);
    const row = page.locator(".pane.example .ranges > li").first();
    await expect(row.getByText("Mask 255.255.255.0")).toBeVisible();
    await expect(row.getByText("Mask and counts")).toBeHidden();
    await context.close();
  }
});

test("phones: a strip is as tall as its labels", async ({ browser }) => {
  const { context, page } = await sized(browser);
  await page.goto(BASE);
  const tracks = await page
    .locator(".pane.example .track")
    .evaluateAll((ts) => ts.map((t) => t.getBoundingClientRect().height));
  // 172.16/12 with Docker's bracket: 10rem. 192.168/16: 9 labels.
  expect(tracks).toEqual([160, 9 * 28 + 32]);
  await context.close();
});

test("phones: a row is about 150px, and names slide apart instead of dropping off", async ({
  browser,
}) => {
  const { context, page } = await sized(browser);
  await page.goto(BASE);
  const plan = [
    "home 192.168.1.0/24",
    "iot 192.168.20.0/24",
    "guest 192.168.30.0/24",
    "vpn 10.8.0.0/24",
    "wg 10.6.0.0/24",
    "storage 10.20.0.0/24",
    "k8s-pods 10.244.0.0/16",
    "k8s-svc 10.96.0.0/12",
    "lab 10.10.0.0/16",
    "  lab-1 10.10.0.0/18",
    "  lab-2 10.10.64.0/18",
    "  lab-3 10.10.128.0/18",
    "  lab-4 10.10.192.0/18",
  ];
  await type(page, plan.join("\n"));
  const yours = page.locator(".pane.yours");
  // Rows out of view keep a placeholder size: this one is brought into view
  // and drawn first.
  const row = yours.locator(".ranges > li").first();
  await row.scrollIntoViewIfNeeded();
  await expect(row.locator(".says")).toBeVisible();
  const first = await row.boundingBox();
  expect(first?.height).toBeGreaterThan(120);
  expect(first?.height).toBeLessThanOrEqual(160);
  await page.evaluate(() => window.scrollTo(0, 0));
  // The 10.0.0.0/8 strip: ten ranges, at least nine named, none on another.
  const names = await yours
    .locator(".track svg")
    .first()
    .locator("text.range-name")
    .evaluateAll((ts) =>
      ts.map((t) => {
        const b = t.getBoundingClientRect();
        return [b.top, b.bottom];
      }),
    );
  expect(names.length).toBeGreaterThanOrEqual(9);
  names.sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
  names.forEach(([top], i) => {
    const prev = names[i - 1];
    if (prev) expect(top ?? 0).toBeGreaterThanOrEqual((prev[1] ?? 0) - 1);
  });
  await context.close();
});

test("axe: a typed plan with Split open, light and dark, 1440 and 390", async ({
  browser,
}) => {
  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [1440, 390]) {
      const { context, page } = await sized(browser, width, colorScheme);
      await page.goto(BASE);
      await type(
        page,
        "home 192.168.1.0/24\ncams 192.168.1.128/25\nlab 172.17.0.0/16\npub 8.8.8.0/24\nbad line\nv6 fd00::/48",
      );
      const row = page.locator(".pane.yours .ranges > li").first();
      await row.getByRole("button", { name: "Split" }).click();
      await row.getByRole("button", { name: "4", exact: true }).click();
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        axe.violations.map((v) => `${v.id}: ${v.nodes.length}`),
        `${colorScheme} ${width}`,
      ).toEqual([]);
      await context.close();
    }
  }
});

// A messy plan: Docker ranges, a chain of nested ranges, a host
// address and a typo.
const MESSY = [
  "home 192.168.1.0/24",
  "lab 172.17.0.0/16",
  "docker-custom 172.18.0.0/16",
  "wide 10.0.0.0/8",
  "p2p 10.0.0.0/31",
  "nas 192.168.1.300/32",
  "loopback 10.0.0.1/32",
  "misaligned 192.168.1.10/24",
].join("\n");

test("a messy plan: honest free space, nested lanes, findings in order", async ({
  browser,
}) => {
  for (const width of [1440, 390]) {
    const { context, page } = await sized(browser, width);
    const errors = watch(page);
    await page.goto(BASE);
    await type(page, MESSY);
    const yours = page.locator(".pane.yours");
    await expect(yours.locator(".verdict")).toHaveText(
      "Two ranges overlap, so some devices won’t reach each other.",
    );
    await expect(yours.locator(".findings li")).toHaveText([
      "Line 6: 300 isn’t a valid octet (0 to 255).",
      "192.168.1.10/24 is a host address; treated as network 192.168.1.0/24.",
      "home and misaligned are the same range, 192.168.1.0/24.",
      "Two ranges sit inside wide: p2p, and loopback inside p2p. Fine if wide is their parent block; a conflict if they’re separate networks.",
      "lab is Docker’s default bridge (172.17.0.0/16). A Docker host routes that range to its own bridge, so the host and its containers can’t reach devices in lab.",
      "docker-custom is in the range Docker gives compose networks (172.18.0.0 to 172.31.255.255). If docker-custom is a network outside Docker, a new compose network can clash with it.",
      "home is in 192.168.0.0/16, which Docker also gives compose networks (in /20s) once 172.17 to 172.31 are used up, so on a busy Docker host a compose network can clash with it.",
    ]);
    const [wide, docker, home] = [0, 1, 2].map((i) =>
      yours.locator(".track svg").nth(i),
    );
    if (!wide || !docker || !home) throw new Error("strips");
    // 10.0.0.0/8: wide, p2p and loopback each drawn, in its own lane, and
    // nothing hatched; the strip says it isn't to scale.
    await expect(wide.locator("rect.range")).toHaveCount(3);
    await expect(wide.locator("rect.clash")).toHaveCount(0);
    const rows = await wide.locator("rect.range").evaluateAll((rs) =>
      rs.map((r) => {
        const b = r.getBoundingClientRect();
        return {
          x: Math.round(b.x),
          y: Math.round(b.y),
          w: b.width,
          h: b.height,
        };
      }),
    );
    for (const r of rows) expect(Math.min(r.w, r.h)).toBeGreaterThan(4);
    // Lanes run across the strip: down on wide screens, side by side on
    // phones.
    const across = rows.map((r) => (width > 640 ? r.y : r.x));
    expect(new Set(across).size).toBe(3);
    // The names are on the map, loopback's too (desktop has room for all).
    if (width > 640) {
      // In the row under the strip, left to right.
      await expect(wide.locator("text.range-name")).toHaveText([
        "p2p",
        "loopback",
        "wide",
      ]);
    }
    const scale = yours.locator(".strip-scale");
    await expect(scale).toHaveCount(2);
    await expect(scale.first()).toHaveText(
      "Not to scale: small ranges and gaps are drawn larger so they show.",
    );
    // 172.16.0.0/12: lab and docker-custom at their true 1/16, and no one
    // label claims 172.19.0.0 to 172.31.255.255.
    // Along the strip: across on wide screens, down on phones.
    const down = width <= 640;
    const labs = await docker.locator("rect.range").evaluateAll(
      (rs, d) =>
        rs.map((r) => {
          const b = r.getBoundingClientRect();
          return d ? b.height : b.width;
        }),
      down,
    );
    const length = await docker.evaluate((svg, d) => {
      const b = svg.getBoundingClientRect();
      return d ? b.height : b.width;
    }, down);
    for (const l of labs)
      expect(Math.abs(l / length - 1 / 16)).toBeLessThan(0.01);
    // "free /13" only ever names the 172.24.0.0/13 block, drawn as one of
    // the stretch's three blocks (four free boxes in all).
    const free = await docker.locator("text.gap-label").allTextContents();
    for (const t of free) {
      expect(["free /16", "free /14", "free /13", "851,968 free"]).toContain(t);
    }
    if (free.includes("free /13")) {
      await expect(docker.locator("rect.gap")).toHaveCount(4);
    }
    // 192.168.0.0/16: 192.168.2.0 onward isn't a /17.
    await expect(
      home.locator("text.gap-label", { hasText: "/17" }),
    ).toHaveCount(0);
    await expect(
      home.locator("text.gap-label", { hasText: "65,024 free" }),
    ).toHaveCount(1);
    // The copy is hatched over both lanes.
    await expect(home.locator("rect.clash")).toHaveCount(1);
    expect(errors).toEqual([]);
    await context.close();
  }
});

test("long names on a phone's map end in “…” inside the map, and read in full in the rows", async ({
  browser,
}) => {
  const long = "averyveryverylongnetworknamewithoutanyspacesatall";
  const child = "child-with-long-name-also-no-spaces-at-all";
  for (const width of [390, 320]) {
    const { context, page } = await sized(browser, width);
    const errors = watch(page);
    await page.goto(BASE);
    await type(page, `${long} 10.0.0.0/16\n${child} 10.0.1.0/24`);
    const yours = page.locator(".pane.yours");
    const svg = yours.locator(".track svg").first();
    const labels = svg.locator("text.range-name");
    await expect(labels).toHaveCount(2);
    const edge = await svg.boundingBox();
    const right = (edge?.x ?? 0) + (edge?.width ?? 0);
    await expect(labels.first()).toHaveText(/^averyvery[a-z]*…$/);
    for (const text of await labels.all()) {
      const box = await text.boundingBox();
      expect(
        (box?.x ?? 0) + (box?.width ?? 0),
        `at ${width}`,
      ).toBeLessThanOrEqual(right + 0.5);
    }
    await expect(yours.locator(".ranges .name")).toHaveText([long, child]);
    expect(errors).toEqual([]);
    await context.close();
  }
});
