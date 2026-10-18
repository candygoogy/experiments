import { expect, type Page, test } from "@playwright/test";
import { checkBasics, serve } from "../../shared/test/e2e";

const PORT = 4422;
const BASE = `http://127.0.0.1:${PORT}/`;
let stop: (() => Promise<void>) | undefined;

test.beforeAll(async () => {
  stop = await serve("keyboard", PORT);
});

test.afterAll(async () => {
  await stop?.();
});

const key = (page: Page, code: string) =>
  page.locator(`.key[data-code="${code}"]`);

// Key events made in the page, for timings Playwright can't hold to the
// millisecond (a double press, Alt Gr's two presses at once).
const send = (page: Page, events: [string, string][]) =>
  page.evaluate((list) => {
    for (const [type, code] of list) {
      dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    }
  }, events);

// The page opens on the layout the browser reports (ANSI on a US
// machine); the tests count ISO's 105 keys, so they choose it.
async function startTesting(page: Page) {
  await page.goto(BASE);
  await expect(key(page, "KeyQ")).toBeAttached();
  // A computer: no keyboard note, the controls straight away.
  await expect(page.locator(".phone")).toBeHidden();
  await page.click('[data-layout="iso"]');
  await expect(key(page, "IntlBackslash")).toBeAttached();
  await page.click(".start");
  await expect(page.locator(".hint")).toBeVisible();
  await expect(page.locator(".start")).toBeHidden();
}

test("meets the shared basics", async ({ page }) => {
  await checkBasics(page, BASE);
});

test("a key is down while held, then seen", async ({ page }) => {
  await startTesting(page);
  await page.keyboard.down("KeyQ");
  await expect(key(page, "KeyQ")).toHaveAttribute("data-state", "down");
  await page.keyboard.up("KeyQ");
  await expect(key(page, "KeyQ")).toHaveAttribute("data-state", "seen");
  await expect(page.locator(".progress")).toHaveText("1 of 105 keys pressed.");
});

test("Tab stays on the page while testing; Esc lets go", async ({ page }) => {
  await startTesting(page);
  const focused = () =>
    page.evaluate(() => document.activeElement?.className ?? "");
  const before = await focused();
  await page.keyboard.press("Tab");
  expect(await focused()).toBe(before);
  await expect(key(page, "Tab")).toHaveAttribute("data-state", "seen");
  await page.keyboard.press("Escape");
  await expect(page.locator(".hint")).toBeHidden();
  await expect(page.locator(".start")).toBeVisible();
  await expect(page.locator(".start")).toBeFocused();
  await expect(key(page, "Escape")).toHaveAttribute("data-state", "seen");
  await page.keyboard.press("Tab");
  await expect(page.locator(".start")).not.toBeFocused();
});

test("progress is read out at most once a second", async ({ page }) => {
  await startTesting(page);
  await page.evaluate(() => {
    const w = window as unknown as { changes: number[] };
    w.changes = [];
    new MutationObserver(() => w.changes.push(performance.now())).observe(
      document.querySelector(".live") as Node,
      { childList: true, characterData: true, subtree: true },
    );
  });
  const letters = "ASDFGHJKLZXCVBNMWERT";
  for (const l of letters) {
    await page.keyboard.press(`Key${l}`);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(1200);
  const changes = await page.evaluate(
    () => (window as unknown as { changes: number[] }).changes,
  );
  expect(changes.length).toBeGreaterThan(0);
  expect(changes.length).toBeLessThanOrEqual(4);
  for (let i = 1; i < changes.length; i++) {
    expect((changes[i] ?? 0) - (changes[i - 1] ?? 0)).toBeGreaterThanOrEqual(
      990,
    );
  }
  await expect(page.locator(".live")).toHaveText("20 of 105 keys pressed.");
});

test("a phone asks for a keyboard first, until one types", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto(BASE);
  const note = page.locator(".phone");
  await expect(note).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(
    "This needs a physical keyboard",
  );
  // Seen without scrolling, in place of the controls.
  const box = await note.boundingBox();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(844);
  await expect(page.locator(".start")).toBeHidden();
  await expect(page.locator(".readout")).toBeHidden();
  // The first key press only shows the controls, with Start focused.
  await page.keyboard.press("KeyA");
  await expect(note).toBeHidden();
  await expect(page.locator(".start")).toBeFocused();
  await expect(key(page, "KeyA")).toHaveAttribute("data-state", "idle");
  await page.locator('[data-layout="iso"]').click();
  await page.locator(".start").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".hint")).toBeVisible();
  await page.keyboard.press("KeyB");
  await expect(key(page, "KeyB")).toHaveAttribute("data-state", "seen");
  await expect(page.locator(".progress")).toHaveText("1 of 88 keys pressed.");
  await context.close();
});

test("with the menu open, the keys are the menu's", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto(BASE);
  const menuButton = page.locator("[data-menu-open]");
  const menu = page.locator("[data-menu]");
  const inMenu = () =>
    page.evaluate(() => !!document.activeElement?.closest("dialog[open]"));

  // The first key on a phone, pressed in the menu: one Esc closes it, the
  // controls show, and focus goes back to Menu, not to Start behind it.
  await menuButton.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.locator(".phone")).toBeHidden();
  await expect(page.locator(".start")).toBeVisible();
  await expect(menuButton).toBeFocused();

  // Mid-test: Tab moves round the menu and one Esc closes it, and neither
  // counts as a tested key nor stops the test.
  await page.locator('[data-layout="iso"]').click();
  await page.locator(".start").click();
  await expect(page.locator(".hint")).toBeVisible();
  await menuButton.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Tab");
  expect(await inMenu()).toBe(true);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(menuButton).toBeFocused();
  await expect(page.locator(".hint")).toBeVisible();
  await expect(page.locator(".start")).toBeHidden();
  await expect(key(page, "Tab")).toHaveAttribute("data-state", "idle");
  await expect(key(page, "Escape")).toHaveAttribute("data-state", "idle");
  // The menu closed, the keys are the test's again.
  await page.keyboard.press("KeyB");
  await expect(key(page, "KeyB")).toHaveAttribute("data-state", "seen");
  await expect(page.locator(".progress")).toHaveText("1 of 88 keys pressed.");
  await context.close();
});

test("losing focus releases held keys, with no stuck warning", async ({
  page,
}) => {
  await startTesting(page);
  await page.keyboard.down("KeyQ");
  await expect(key(page, "KeyQ")).toHaveAttribute("data-state", "down");
  await page.evaluate(() => dispatchEvent(new Event("blur")));
  await expect(key(page, "KeyQ")).toHaveAttribute("data-state", "seen");
  await page.waitForTimeout(3500);
  await expect(page.locator(".findings li")).toHaveCount(0);
});

test("a key held 3 seconds is flagged, and cleared when let go", async ({
  page,
}) => {
  await startTesting(page);
  await page.keyboard.down("KeyQ");
  await expect(page.locator(".findings li")).toHaveText(
    "Q has been held for 3 seconds. If you’re not pressing it, it may be stuck.",
    { timeout: 4000 },
  );
  await expect(key(page, "KeyQ")).toHaveAttribute("data-finding", "");
  await page.keyboard.up("KeyQ");
  await expect(page.locator(".findings li")).toHaveCount(0);
  await expect(key(page, "KeyQ")).not.toHaveAttribute("data-finding");
});

test("a double press is a finding", async ({ page }) => {
  await startTesting(page);
  await send(page, [
    ["keydown", "KeyE"],
    ["keyup", "KeyE"],
    ["keydown", "KeyE"],
    ["keyup", "KeyE"],
  ]);
  await expect(page.locator(".findings li")).toContainText(
    /^E registered twice in a row, \d+ ms apart\./,
  );
  await expect(key(page, "KeyE")).toHaveAttribute("data-finding", "");
  await expect(page.locator(".live")).toContainText("E registered twice");
});

test("Alt Gr's own Left Ctrl press isn't counted", async ({ page }) => {
  await startTesting(page);
  await send(page, [
    ["keydown", "ControlLeft"],
    ["keydown", "AltRight"],
  ]);
  await expect(key(page, "AltRight")).toHaveAttribute("data-state", "down");
  await expect(key(page, "ControlLeft")).toHaveAttribute("data-state", "idle");
  await send(page, [
    ["keyup", "ControlLeft"],
    ["keyup", "AltRight"],
  ]);
  await expect(key(page, "ControlLeft")).toHaveAttribute("data-state", "idle");
  await expect(page.locator(".rollover")).toHaveText(
    "Most keys held at once: 1.",
  );
});

test("Start over clears everything", async ({ page }) => {
  await startTesting(page);
  await page.keyboard.press("KeyW");
  await send(page, [
    ["keydown", "KeyE"],
    ["keyup", "KeyE"],
    ["keydown", "KeyE"],
    ["keyup", "KeyE"],
  ]);
  await page.locator(".over").click();
  await expect(key(page, "KeyW")).toHaveAttribute("data-state", "idle");
  await expect(page.locator(".findings li")).toHaveCount(0);
  await expect(page.locator(".progress")).toHaveText("0 of 105 keys pressed.");
});

test("ANSI has no key beside the left Shift, and 104 keys", async ({
  page,
}) => {
  await page.goto(BASE);
  await page.click('[data-layout="ansi"]');
  await expect(page.locator('[data-layout="ansi"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(key(page, "IntlBackslash")).toHaveCount(0);
  await expect(page.locator(".progress")).toHaveText("0 of 104 keys pressed.");
});

test("the press is instant under reduced motion", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await startTesting(page);
  const duration = await key(page, "KeyJ")
    .locator(".cap")
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(duration.split(",").every((d) => parseFloat(d) <= 0.001)).toBe(true);
  await context.close();
});

const capFill = (page: Page, code: string) =>
  key(page, code)
    .locator(".cap")
    .evaluate((el) => getComputedStyle(el).fill);

test("Win and Print Screen light up like any key once pressed", async ({
  page,
}) => {
  await startTesting(page);
  expect(await capFill(page, "MetaLeft")).toContain("#hatch");
  await page.keyboard.down("KeyQ");
  await page.waitForTimeout(150); // past the 70 ms press
  const down = await capFill(page, "KeyQ");
  await page.keyboard.up("KeyQ");
  await expect(key(page, "KeyQ")).toHaveAttribute("data-state", "seen");
  await page.waitForTimeout(400);
  const seen = await capFill(page, "KeyQ");
  await send(page, [["keydown", "MetaLeft"]]);
  await page.waitForTimeout(150);
  expect(await capFill(page, "MetaLeft")).toBe(down);
  await send(page, [["keyup", "MetaLeft"]]);
  await page.waitForTimeout(400);
  expect(await capFill(page, "MetaLeft")).toBe(seen);
  await send(page, [["keyup", "PrintScreen"]]);
  await page.waitForTimeout(400);
  expect(await capFill(page, "PrintScreen")).toBe(seen);
});

test("tested, untested and pressed keys tell apart, in both themes", async ({
  browser,
}) => {
  for (const colorScheme of ["light", "dark"] as const) {
    const context = await browser.newContext({ colorScheme });
    const page = await context.newPage();
    await startTesting(page);
    await send(page, [
      ["keydown", "KeyQ"],
      ["keyup", "KeyQ"],
      ["keydown", "KeyE"],
      ["keyup", "KeyE"],
      ["keydown", "KeyE"],
      ["keyup", "KeyE"],
      ["keydown", "KeyM"],
    ]);
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const rgb = (color: string) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const c = canvas.getContext("2d") as CanvasRenderingContext2D;
        c.fillStyle = color;
        c.fillRect(0, 0, 1, 1);
        return [...c.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      };
      const lum = (v: number[]) =>
        v
          .map((x) => x / 255)
          .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
          .reduce((s, x, i) => s + x * ([0.2126, 0.7152, 0.0722][i] ?? 0), 0);
      const ratio = (a: number[], b: number[]) => {
        const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m) as [
          number,
          number,
        ];
        return (x + 0.05) / (y + 0.05);
      };
      const css = (code: string, part: string, prop: "fill" | "stroke") =>
        rgb(
          getComputedStyle(
            document.querySelector(`[data-code="${code}"] ${part}`) as Element,
          )[prop],
        );
      const seen = css("KeyQ", ".cap", "fill");
      return {
        seenIdle: ratio(seen, css("KeyW", ".cap", "fill")),
        seenDown: ratio(seen, css("KeyM", ".cap", "fill")),
        legend: ratio(css("KeyQ", "text", "fill"), seen),
        ring: ratio(css("KeyE", ".cap", "stroke"), css("KeyE", ".cap", "fill")),
      };
    });
    expect(
      r.seenIdle,
      `${colorScheme}: seen vs untested`,
    ).toBeGreaterThanOrEqual(3);
    expect(
      r.seenDown,
      `${colorScheme}: seen vs pressed`,
    ).toBeGreaterThanOrEqual(3);
    expect(r.legend, `${colorScheme}: legend on seen`).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(r.ring, `${colorScheme}: double-press ring`).toBeGreaterThanOrEqual(
      3,
    );
    await context.close();
  }
});

test("starting with Enter doesn't count Enter", async ({ page }) => {
  await page.goto(BASE);
  await page.click('[data-layout="iso"]');
  await page.focus(".start");
  await page.keyboard.press("Enter");
  await expect(page.locator(".hint")).toBeVisible();
  await expect(key(page, "Enter")).toHaveAttribute("data-state", "idle");
  await expect(page.locator(".progress")).toHaveText("0 of 105 keys pressed.");
});

test("switching layout mid-test keeps what both share", async ({ page }) => {
  await startTesting(page);
  await page.keyboard.press("KeyA");
  await page.keyboard.press("KeyS");
  await send(page, [
    ["keydown", "IntlBackslash"],
    ["keyup", "IntlBackslash"],
    ["keydown", "KeyE"],
    ["keyup", "KeyE"],
    ["keydown", "KeyE"],
    ["keyup", "KeyE"],
  ]);
  await expect(page.locator(".progress")).toHaveText("4 of 105 keys pressed.");
  await page.click('[data-layout="ansi"]');
  await expect(page.locator(".progress")).toHaveText("3 of 104 keys pressed.");
  await expect(key(page, "KeyA")).toHaveAttribute("data-state", "seen");
  await expect(key(page, "KeyE")).toHaveAttribute("data-finding", "");
  await expect(page.locator(".findings li")).toContainText(
    /^E registered twice/,
  );
  await page.click('[data-layout="iso"]');
  await expect(page.locator(".progress")).toHaveText("3 of 105 keys pressed.");
  await expect(key(page, "IntlBackslash")).toHaveAttribute(
    "data-state",
    "idle",
  );
});

test("Alt Gr held while the window loses focus leaves no phantom Ctrl", async ({
  page,
}) => {
  await startTesting(page);
  await send(page, [
    ["keydown", "ControlLeft"],
    ["keydown", "AltRight"],
  ]);
  await page.evaluate(() => dispatchEvent(new Event("blur")));
  await send(page, [
    ["keyup", "ControlLeft"],
    ["keyup", "AltRight"],
  ]);
  await expect(key(page, "ControlLeft")).toHaveAttribute("data-state", "idle");
  await expect(page.locator(".progress")).toHaveText("1 of 105 keys pressed.");
});

test("nothing is read out before the first test press", async ({ page }) => {
  await startTesting(page);
  await page.waitForTimeout(1200);
  await expect(page.locator(".live")).toHaveText("");
  await page.keyboard.press("KeyA");
  await expect(page.locator(".live")).toHaveText("1 of 105 keys pressed.");
});

test("an unidentified key isn't counted as an extra key", async ({ page }) => {
  await startTesting(page);
  await send(page, [
    ["keydown", "Unidentified"],
    ["keyup", "Unidentified"],
    ["keydown", ""],
    ["keyup", ""],
  ]);
  await page.keyboard.press("KeyA");
  await expect(page.locator(".progress")).toHaveText("1 of 105 keys pressed.");
  await expect(page.locator(".extra")).toBeHidden();
});

test("Start over waits until there's something to start over from", async ({
  page,
}) => {
  await startTesting(page);
  const over = page.locator(".over");
  await expect(over).toBeHidden();
  await page.keyboard.press("KeyQ");
  await expect(over).toBeVisible();
  await over.click();
  await expect(over).toBeHidden();
  // Focus doesn't fall off the page with it: still testing, it's back on
  // the board.
  await expect(page.locator(".test")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(over).toBeVisible();
  await over.focus();
  await page.keyboard.press("Enter");
  await expect(over).toBeHidden();
  await expect(page.locator(".start")).toBeFocused();
});

test("ANSI's Right Alt reads Alt, and the ISO-only key suggests ISO", async ({
  page,
}) => {
  await page.goto(BASE);
  await page.click('[data-layout="ansi"]');
  await expect(key(page, "AltRight").locator("text")).toHaveText("Alt");
  await page.click(".start");
  const hint = page.locator(".try-iso");
  await expect(hint).toBeHidden();
  await send(page, [
    ["keydown", "IntlBackslash"],
    ["keyup", "IntlBackslash"],
  ]);
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText(
    "Your keyboard has the extra key next to left Shift, so it’s probably ISO: try that layout.",
  );
  await expect(page.locator(".live")).toContainText("probably ISO", {
    timeout: 2000,
  });
  await page.click('[data-layout="iso"]');
  await expect(hint).toBeHidden();
  await expect(key(page, "AltRight").locator("text")).toHaveText("Alt Gr");
});

test("a narrow window drops the number pad, so the legends stay readable", async ({
  browser,
}) => {
  for (const [width, keys, compact] of [
    [768, 88, true],
    [1024, 88, true],
    [1280, 105, false],
  ] as const) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(BASE);
    await page.click('[data-layout="iso"]');
    await expect(page.locator(".key")).toHaveCount(keys);
    await expect(page.locator(".progress")).toHaveText(
      `0 of ${keys} keys pressed.`,
    );
    const note = page.locator(".narrow-note");
    if (compact) {
      await expect(note).toHaveText(
        "Widen the window to test the number pad too.",
      );
      await expect(key(page, "Numpad5")).toHaveCount(0);
    } else {
      await expect(note).toBeHidden();
    }
    const q = await key(page, "KeyQ").evaluate((g) => {
      const text = g.querySelector("text") as SVGTextElement;
      // The board is scaled to fit: the legend's size as drawn on screen.
      const scale = text.getBoundingClientRect().height / text.getBBox().height;
      return {
        legend: scale * parseFloat(getComputedStyle(text).fontSize),
        cap: (g.querySelector(".cap") as Element).getBoundingClientRect().width,
      };
    });
    // The legends' size on screen: about 7px at 768 when the whole board
    // was squeezed in.
    expect(q.legend, `legend at ${width}`).toBeGreaterThanOrEqual(
      width < 1000 ? 8.25 : 11,
    );
    expect(q.cap, `key at ${width}`).toBeGreaterThanOrEqual(32);
    await context.close();
  }
});

test("the board keeps its space through a resize past the number pad's width", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.click('[data-layout="iso"]');
  await page.click(".start");
  await page.keyboard.press("KeyA");
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.locator(".key")).toHaveCount(88);
  // What both drawings share carries over.
  await expect(key(page, "KeyA")).toHaveAttribute("data-state", "seen");
  const ratio = await page
    .locator(".board")
    .evaluate(
      (b) => b.getBoundingClientRect().width / b.getBoundingClientRect().height,
    );
  expect(Math.abs(ratio - 1001 / 353)).toBeLessThan(0.02);
  await context.close();
});
