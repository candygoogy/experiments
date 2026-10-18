// Browser checks every experiment must pass, and a helper that serves an
// experiment's dist/ with Wrangler (the _headers file included) for the
// length of a test file.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

const ROOT = join(import.meta.dirname, "..", "..");
const WRANGLER = join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A first start on a cold CI runner is slower than on a desktop.
const START_MS = process.env["CI"] ? 45_000 : 30_000;
// How much of Wrangler's output a failed start reports.
const LOG_BYTES = 4096;

/**
 * Runs `wrangler dev` in `dir` (relative to the repo) on 127.0.0.1:port and
 * resolves once it answers. The returned function stops Wrangler and its
 * workerd child, and resolves once the port is closed.
 *
 * A start that fails is tried once more; if that fails too, the error
 * carries the end of what Wrangler printed each time.
 */
export async function serve(
  dir: string,
  port: number,
): Promise<() => Promise<void>> {
  const url = `http://127.0.0.1:${port}/`;
  const answers = () =>
    fetch(url, { signal: AbortSignal.timeout(1000) }).then(
      () => true,
      () => false,
    );
  if (await answers()) throw new Error(`port ${port} is already in use`);
  const failures: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const server = start(dir, port, answers);
    const deadline = Date.now() + START_MS;
    let up = false;
    while (!server.exited() && Date.now() < deadline) {
      if ((up = await answers())) break;
      await sleep(250);
    }
    if (up) return server.stop;
    const why = server.exited()
      ? `exited (${server.exited()})`
      : `no answer in ${START_MS / 1000} s`;
    await server.stop();
    failures.push(
      `attempt ${attempt}, ${why}:\n${server.log() || "(no output)"}`,
    );
  }
  throw new Error(
    `wrangler dev did not start in ${dir} on ${port}\n\n${failures.join("\n\n")}`,
  );
}

/** One `wrangler dev`, the end of its output, and a way to stop it. */
function start(dir: string, port: number, answers: () => Promise<boolean>) {
  const child = spawn(
    process.execPath,
    [
      WRANGLER,
      "dev",
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
      // Otherwise each Wrangler looks for a free port from 9229 up and
      // binds it later. Two started at once (two test workers) can pick
      // the same one; on Linux the second can't bind it and exits, while
      // Windows lets both listen. Port 0 has the OS pick, atomically.
      "--inspector-port",
      "0",
    ],
    {
      cwd: join(ROOT, dir),
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group, so the whole tree can be stopped (POSIX).
      detached: process.platform !== "win32",
    },
  );
  let log = "";
  const keep = (chunk: Buffer | string) => {
    log = (log + String(chunk)).slice(-LOG_BYTES);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  let exit = "";
  const gone = new Promise<void>((resolve) => {
    child.on("error", (e) => {
      keep(`\n${e.stack ?? e.message}\n`);
      exit ||= e.message;
      resolve();
    });
    child.on("exit", (code, signal) => {
      exit ||= signal ? `signal ${signal}` : `code ${code}`;
      resolve();
    });
  });
  // Its output is complete once the pipes close, which can be after exit.
  const closed = new Promise<void>((resolve) => child.on("close", resolve));
  const stop = async () => {
    if (child.pid === undefined) return;
    if (process.platform === "win32") {
      try {
        execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } catch {
        // Already gone.
      }
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
    await Promise.race([gone, sleep(5000)]);
    for (let i = 0; i < 50 && (await answers()); i++) await sleep(100);
    await Promise.race([closed, sleep(1000)]);
  };
  return {
    stop,
    exited: () => exit,
    log: () => stripVTControlCharacters(log).trim(),
  };
}

export interface BasicsOptions {
  /** The hosts the experiment may connect to (its CSP connect-src). */
  connectSrc?: string[];
}

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The checks every experiment passes, run against a served build. */
export async function checkBasics(
  page: Page,
  base: string,
  options: BasicsOptions = {},
): Promise<void> {
  const browser = page.context().browser();
  if (!browser) throw new Error("checkBasics needs a launched browser");
  const origin = new URL(base).origin;
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  // Every policy violation from the first byte on: a page (or a
  // dependency) that tries to call out is caught here, not just blocked.
  await page.addInitScript(() => {
    const w = window as unknown as { violations: string[] };
    w.violations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      w.violations.push(`${e.effectiveDirective} ${e.blockedURI}`),
    );
  });

  // (a) The policy arrives as a header and allows no network calls, or
  // only the experiment's own hosts.
  const response = await page.goto(base);
  const csp = response?.headers()["content-security-policy"] ?? "";
  const connect = options.connectSrc?.length
    ? options.connectSrc.join(" ")
    : "'none'";
  expect(csp, "CSP header").toContain(`connect-src ${connect}`);

  // The tab reads "<the h1> – candygoogy", as the site's pages do.
  const h1 = (await page.locator("h1").first().textContent())?.trim() ?? "";
  expect(h1, "h1").not.toBe("");
  await expect(page, "title").toHaveTitle(`${h1} – candygoogy`);

  // The page itself broke no rule while loading.
  await page.waitForLoadState("networkidle");
  const own = await page.evaluate(
    () => (window as unknown as { violations: string[] }).violations,
  );
  expect(own, "CSP violations while loading").toEqual([]);

  // (b) The browser blocks a call to anywhere else, and says so.
  const call = await page.evaluate(async () => {
    let violation = false;
    document.addEventListener("securitypolicyviolation", () => {
      violation = true;
    });
    const result = await fetch("https://example.com").then(
      () => "sent",
      () => "blocked",
    );
    await new Promise((r) => setTimeout(r, 100));
    return { result, violation };
  });
  expect(call, "fetch to another origin").toEqual({
    result: "blocked",
    violation: true,
  });

  // (f) Light, then Dark, and a reload keeps the choice.
  const html = page.locator("html");
  await page.click('[data-theme-switch] button[data-value="light"]');
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.click('[data-theme-switch] button[data-value="dark"]');
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");

  // (c) Nothing was asked of any other origin.
  const elsewhere = requests.filter(
    (u) => /^https?:/.test(u) && new URL(u).origin !== origin,
  );
  expect(elsewhere, "requests to other origins").toEqual([]);

  // (d) axe in both themes; (e) no sideways scrolling on phones; (h) no
  // layout shift, at each width.
  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [320, 390, 1440]) {
      const context = await browser.newContext({
        colorScheme,
        viewport: { width, height: 800 },
      });
      await context.addInitScript(() => {
        const w = window as unknown as { cls: number };
        w.cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as unknown as {
            value: number;
            hadRecentInput: boolean;
          }[]) {
            if (!entry.hadRecentInput) w.cls += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      const p = await context.newPage();
      await p.goto(base, { waitUntil: "networkidle" });
      await p.waitForTimeout(500);
      const at = `${colorScheme} ${width}`;
      if (width === 1440) {
        const axe = await new AxeBuilder({ page: p })
          .withTags(AXE_TAGS)
          .analyze();
        expect(
          axe.violations.map((v) => `${v.id}: ${v.nodes.length}`),
          `axe ${at}`,
        ).toEqual([]);
      } else {
        const over = await p.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        );
        expect(over, `sideways overflow ${at}`).toBeLessThanOrEqual(0);
      }
      const cls = await p.evaluate(
        () => (window as unknown as { cls: number }).cls,
      );
      expect(cls, `CLS ${at}`).toBe(0);
      await context.close();
    }
  }

  // (g) Reduced motion: nothing is still moving half a second in.
  {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const p = await context.newPage();
    await p.goto(base);
    await p.waitForTimeout(500);
    const running = await p.evaluate(
      () =>
        document.getAnimations().filter((a) => a.playState === "running")
          .length,
    );
    expect(running, "running animations under reduced motion").toBe(0);
    await context.close();
  }

  // (j) The first Tab stop is the site's skip link, shown once focused;
  // following it, the next Tab goes past the header.
  {
    const context = await browser.newContext();
    const p = await context.newPage();
    await p.goto(base);
    await p.keyboard.press("Tab");
    const skip = p.locator("a.skip");
    await expect(skip, "skip link focused first").toBeFocused();
    await expect(skip).toHaveText("Skip to content");
    await expect(skip, "skip link shown when focused").toBeInViewport();
    await p.keyboard.press("Enter");
    await expect(p).toHaveURL(/#tool$/);
    await p.keyboard.press("Tab");
    const inHeader = await p.evaluate(
      () => !!document.activeElement?.closest(".top, .skip"),
    );
    expect(inHeader, "Tab after the skip link").toBe(false);
    await context.close();
  }

  // (k) Phones: the header is the wordmark and Menu. Menu opens the site's
  // route with Experiments as the current stop, the page behind can't
  // scroll, both theme switches agree, and Esc closes it with focus back
  // on Menu. Scrolling down takes the header away; scrolling up brings it
  // back.
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 640 },
    });
    const p = await context.newPage();
    await p.goto(base);
    const menuButton = p.locator("[data-menu-open]");
    const menu = p.locator("[data-menu]");
    await expect(menuButton, "Menu on phones").toBeVisible();
    await expect(
      p.locator("header.top > .nav"),
      "nav in the menu",
    ).toBeHidden();
    await menuButton.focus();
    await p.keyboard.press("Enter");
    await expect(menu, "menu open").toBeVisible();
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");
    await expect(p.locator("[data-menu-close]"), "Close focused").toBeFocused();
    await expect(menu.locator(".route a")).toHaveText([
      "Projects",
      "Experiments",
      "About",
      "Contact",
    ]);
    await expect(menu.locator(".route a[aria-current]")).toHaveText(
      "Experiments",
    );
    expect(
      await p.evaluate(
        () => getComputedStyle(document.documentElement).overflow,
      ),
      "page behind locked",
    ).toBe("hidden");
    await menu.locator('button[data-value="light"]').click();
    await expect(p.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(
      p.locator('header.top > .tools button[data-value="light"]'),
      "both switches agree",
    ).toHaveAttribute("aria-pressed", "true");
    await p.keyboard.press("Escape");
    await expect(menu, "Esc closes").toBeHidden();
    await expect(menuButton, "focus back on Menu").toBeFocused();
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");
    await menuButton.blur();
    const header = p.locator("header.top");
    const tall = await p.evaluate(
      () => document.documentElement.scrollHeight > innerHeight + 300,
    );
    if (tall) {
      await p.mouse.move(195, 400);
      await p.mouse.wheel(0, 300);
      await expect(header, "away on scroll down").toHaveClass(/\baway\b/);
      await p.mouse.wheel(0, -60);
      await expect(header, "back on scroll up").not.toHaveClass(/\baway\b/);
    }
    await context.close();
  }

  // (i) Without JavaScript: the heading, and a plain word that the tool
  // needs it.
  {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const p = await context.newPage();
    await p.goto(base);
    await expect(p.locator("h1")).toBeVisible();
    // getByText skips <noscript>, so the paragraph is found by tag.
    const note = p.locator("noscript p");
    await expect(note).toBeVisible();
    await expect(note).toHaveText(
      "This tool needs JavaScript. It runs entirely in your browser.",
    );
    await context.close();
  }
}

/** Collects the page's console errors and uncaught exceptions from now
 * on. */
export function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

/** Window sizes from the smallest phone to a wide desktop. */
export const SIZES = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 600, height: 960 },
  { width: 768, height: 1024 },
  { width: 861, height: 900 },
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

/** The layout shift from the first paint until `ready` is visible, with no
 * input at all. */
export async function layoutShift(
  page: Page,
  url: string,
  ready: string,
): Promise<number> {
  await page.addInitScript(() => {
    const w = window as unknown as { shift: number; moved: string[] };
    w.shift = 0;
    w.moved = [];
    // What moved, and from where to where, so a failure names it.
    const rect = (r: DOMRectReadOnly) =>
      `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}`;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
        sources: {
          node: Node | null;
          previousRect: DOMRectReadOnly;
          currentRect: DOMRectReadOnly;
        }[];
      }[]) {
        if (entry.hadRecentInput) continue;
        w.shift += entry.value;
        for (const s of entry.sources) {
          const el = s.node instanceof Element ? s.node : s.node?.parentElement;
          const name = el
            ? `${el.localName}${el.className ? `.${String(el.className).split(" ").join(".")}` : ""}`
            : "?";
          w.moved.push(
            `${name} ${rect(s.previousRect)} → ${rect(s.currentRect)}`,
          );
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator(ready).first().waitFor();
  // Two frames, so a shift caused by the last change is recorded.
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const { shift, moved } = await page.evaluate(() => {
    const w = window as unknown as { shift: number; moved: string[] };
    return { shift: w.shift, moved: w.moved };
  });
  if (shift > 0)
    console.log(`layout shift ${shift} at ${url}:\n${moved.join("\n")}`);
  return shift;
}
