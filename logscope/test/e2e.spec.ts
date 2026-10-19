import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkBasics,
  consoleErrors,
  layoutShift,
  serve,
  SIZES,
} from "../../shared/test/e2e";
import { copy } from "../src/copy.ts";

const PORT = 4427;
const BASE = `http://127.0.0.1:${PORT}/`;
const FIXTURES = join(import.meta.dirname, "fixtures");
const fixture = (name: string) => join(FIXTURES, name);
const RESTARTS =
  "This PC restarted without shutting down 3 times, once after a blue screen.";
let stop: (() => Promise<void>) | undefined;

test.beforeAll(async () => {
  stop = await serve("logscope", PORT);
});

test.afterAll(async () => {
  await stop?.();
});

/** Every policy violation from the first byte on. */
async function watchPolicy(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { violations: string[] };
    w.violations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      w.violations.push(`${e.effectiveDirective} ${e.blockedURI}`),
    );
  });
  return () =>
    page.evaluate(
      () => (window as unknown as { violations: string[] }).violations,
    );
}

test("meets the shared basics", async ({ page }) => {
  await checkBasics(page, BASE);
});

test("an example log on the page from the first paint, labelled, never announced", async ({
  page,
}) => {
  const errors = consoleErrors(page);
  const scripts: string[] = [];
  page.on("request", (r) => {
    if (["script", "other"].includes(r.resourceType())) scripts.push(r.url());
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  const example = page.getByRole("region", { name: copy.example });
  await expect(example).toBeVisible();
  await expect(example.getByRole("heading", { level: 3 })).toHaveText(
    "This PC restarted without shutting down 3 times.",
  );
  await expect(example.getByRole("heading", { level: 4 })).toHaveText([
    "Critical Kernel-Power 41",
    "Error EventLog 6008",
    "Warning DNS Client Events 1014",
    "Error DistributedCOM 10016",
  ]);
  await expect(page.locator("[data-status]")).toHaveText("");
  // The reading code (the worker) loads only for a dropped log.
  expect(scripts.filter((url) => /worker/.test(url))).toEqual([]);
  expect(errors).toEqual([]);
});

test("without JavaScript there's no example", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(BASE);
  await expect(page.locator(".example")).toBeHidden();
  await context.close();
});

test("the page doesn't move as it loads", async ({ browser }) => {
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

test.describe("every format gives its verdict", () => {
  for (const [name, verdict] of [
    ["en-system.csv", RESTARTS],
    ["it-system.csv", RESTARTS],
    ["pl-system.csv", RESTARTS],
    ["en-system.txt", RESTARTS],
    ["system.xml", RESTARTS],
    ["wevtutil.xml", RESTARTS],
    ["system.evtx", RESTARTS],
    [
      "syslog-3164.log",
      "The most frequent error is “Failed password for invalid user admin from … port … ssh2”, 40 times.",
    ],
    [
      "syslog-5424.log",
      "The most frequent error is “EXT4-fs error (device sda1): ext4_find_entry:…: inode #…: comm example-app: rea…”, 20 times.",
    ],
    [
      "access.log",
      "Your server failed 31 requests in one burst on Oct 14, between 03:10 and 03:24 UTC.",
    ],
    [
      "nginx-error.log",
      "The most frequent error is “connect() failed (…: Connection refused) while connecting to upstream”, 31 times.",
    ],
  ] as const) {
    test(name, async ({ page }) => {
      const errors = consoleErrors(page);
      const violations = await watchPolicy(page);
      await page.goto(BASE);
      await page.setInputFiles(".drop input", fixture(name));
      await expect(page.locator(".answer .verdict")).toHaveText(verdict);
      // A heading one level under the pane’s label, as in the example.
      await expect(
        page.locator(".pane.yours").getByRole("heading", { level: 3 }),
      ).toHaveText(verdict);
      await expect(page.locator(".example")).toHaveCount(0);
      await expect(page.locator("[data-status]")).toHaveText(verdict);
      expect(errors).toEqual([]);
      expect(await violations()).toEqual([]);
    });
  }
});

test("two files at once: the first is read, and the page says so", async ({
  page,
}) => {
  await page.goto(BASE);
  const files = ["en-system.csv", "access.log"].map(
    (name) => [name, readFileSync(fixture(name), "utf8")] as const,
  );
  const transfer = await page.evaluateHandle((all) => {
    const dt = new DataTransfer();
    for (const [name, body] of all) {
      dt.items.add(new File([body], name, { type: "text/plain" }));
    }
    return dt;
  }, files);
  const zone = page.locator(".drop");
  await zone.dispatchEvent("dragenter", { dataTransfer: transfer });
  await zone.dispatchEvent("dragover", { dataTransfer: transfer });
  await zone.dispatchEvent("drop", { dataTransfer: transfer });
  const line = "One file at a time: showing en-system.csv.";
  // Above the answer, in the answer's column, labelled with the name.
  await expect(page.locator(".answer > :first-child")).toHaveText(line);
  await expect(page.locator(".answer .verdict")).toHaveText(RESTARTS);
  await expect(page.locator("#yours-label")).toHaveText("en-system.csv");
  await expect(page.locator("[data-status]")).toHaveText(`${line} ${RESTARTS}`);
  // One file: no such line.
  await page.setInputFiles(".drop input", fixture("en-system.csv"));
  await expect(page.locator(".answer .verdict")).toHaveText(RESTARTS);
  await expect(page.locator(".one-file")).toHaveCount(0);
  await expect(page.locator("[data-status]")).toHaveText(RESTARTS);
});

test("the filters: levels, source, search", async ({ page }) => {
  await page.goto(BASE);
  await page.setInputFiles(".drop input", fixture("en-system.csv"));
  const rows = page.locator('.answer [data-list="main"] > li');
  const shown = page.locator(".answer .shown");
  await expect(shown).toHaveText("7 groups of 9");
  await expect(rows).toHaveCount(6);
  await expect(page.locator('.answer [data-list="noise"] > li')).toHaveCount(1);

  const information = page.locator('.level-toggle[data-level="information"]');
  await expect(information).toHaveAttribute("aria-pressed", "false");
  await information.click();
  await expect(information).toHaveAttribute("aria-pressed", "true");
  await expect(shown).toHaveText("9 groups of 9");

  await page.selectOption(".answer select", "kernel-power");
  await expect(shown).toHaveText("1 group of 9");
  await expect(rows.locator(".name")).toHaveText("Critical Kernel-Power 41");

  await page.selectOption(".answer select", "");
  await page.fill(".answer input[type=search]", "Example Sync");
  await expect(shown).toHaveText("1 group of 9");
  await page.fill(".answer input[type=search]", "nothing like this");
  await expect(page.locator(".answer .no-match")).toBeVisible();
  await expect(page.locator(".answer .noise-head")).toBeHidden();
});

/** A file written for the test in a folder of its own. */
async function withFile(
  name: string,
  content: string | Uint8Array,
  run: (path: string) => Promise<void>,
) {
  const dir = mkdtempSync(join(tmpdir(), "logscope-"));
  try {
    const file = join(dir, name);
    writeFileSync(file, content);
    await run(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a CSV saved again in a Windows code page (Polish)", async ({ page }) => {
  // Each character as windows-1250 writes it; any it has no byte for as "?".
  const decoder = new TextDecoder("windows-1250");
  const bytes = new Map<string, number>();
  for (let b = 0x80; b <= 0xff; b++) {
    bytes.set(decoder.decode(new Uint8Array([b])), b);
  }
  const text = readFileSync(fixture("pl-system.csv"), "utf8");
  const ansi = Uint8Array.from([...text], (c) =>
    c.charCodeAt(0) < 0x80 ? c.charCodeAt(0) : (bytes.get(c) ?? 0x3f),
  );
  await withFile("pl-ansi.csv", ansi, async (file) => {
    await page.goto(BASE);
    await page.setInputFiles(".drop input", file);
    await expect(page.locator(".answer .verdict")).toHaveText(RESTARTS);
    await expect(page.locator(".answer .about")).not.toContainText(
      copy.levelsUnknown,
    );
  });
});

test("wevtutil's XML with no line breaks at all", async ({ page }) => {
  const text = readFileSync(fixture("wevtutil.xml"), "utf8").replace(
    /\r?\n/g,
    "",
  );
  await withFile("one-line.xml", text, async (file) => {
    await page.goto(BASE);
    await page.setInputFiles(".drop input", file);
    await expect(page.locator(".answer .verdict")).toHaveText(RESTARTS);
  });
});

test("the filter fields have an edge you can see; chips say what they stand for", async ({
  page,
}) => {
  await page.goto(BASE);
  await page.setInputFiles(".drop input", fixture("syslog-3164.log"));
  const field = page.locator(".answer input[type=search]");
  // Every field in the family has the shared field line (3:1 or more).
  const line = await page.evaluate(() => {
    const probe = document.createElement("i");
    probe.style.setProperty("color", "var(--field-line)");
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  for (const el of [field, page.locator(".answer select")]) {
    expect(
      await el.evaluate((node) => getComputedStyle(node).borderTopColor),
    ).toBe(line);
  }
  const chip = page.locator(".answer .message .slot").first();
  await expect(chip).toHaveAttribute("title", copy.slotTitle);
  expect(Object.values(copy.slots)).toContain(await chip.textContent());
});

test("an .evtx file dropped on the page, again, then chosen", async ({
  page,
}) => {
  const errors = consoleErrors(page);
  await page.goto(BASE);
  const body = [...readFileSync(fixture("system.evtx"))];
  const drop = async (name: string) => {
    const transfer = await page.evaluateHandle(
      ([name, bytes]) => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(bytes)], name));
        return dt;
      },
      [name, body] as const,
    );
    const zone = page.locator(".drop");
    for (const type of ["dragenter", "dragover", "drop"]) {
      await zone.dispatchEvent(type, { dataTransfer: transfer });
    }
  };
  const about = page.locator(".answer .about");
  await drop("System.evtx");
  await expect(page.locator(".answer .verdict")).toHaveText(RESTARTS);
  await expect(about).toContainText("436 events in the System log");
  await expect(about).toContainText("exported as .evtx");
  await expect(page.locator("#yours-label")).toHaveText("System.evtx");
  // Another drop reads again.
  await page.setInputFiles(".drop input", fixture("access.log"));
  await expect(page.locator(".answer .verdict")).not.toHaveText(RESTARTS);
  await drop("Again.evtx");
  await expect(page.locator(".answer .verdict")).toHaveText(RESTARTS);
  await expect(page.locator("#yours-label")).toHaveText("Again.evtx");
  await page.setInputFiles(".drop input", fixture("system.evtx"));
  await expect(page.locator("#yours-label")).toHaveText("system.evtx");
  await expect(page.locator(".answer .verdict")).toHaveText(RESTARTS);
  expect(errors).toEqual([]);
});

test("a six-digit count fits its column, at 390 and 1440", async ({
  browser,
}) => {
  // 100,000 failed requests, then a dozen missing pages: one list, a
  // six-digit count and a two-digit one.
  const lines: string[] = [];
  for (let i = 0; i < 100_000; i++) {
    lines.push(
      `203.0.113.9 - - [08/Oct/2026:00:${String(i % 60).padStart(2, "0")}:22 +0000] "GET /api/orders HTTP/1.1" 500 12 "-" "Mozilla/5.0"`,
    );
  }
  for (let i = 0; i < 12; i++) {
    lines.push(
      `198.51.100.23 - - [08/Oct/2026:01:00:${String(i).padStart(2, "0")} +0000] "GET /missing HTTP/1.1" 404 12 "-" "Mozilla/5.0"`,
    );
  }
  const buffer = Buffer.from(lines.join("\n") + "\n");
  for (const width of [390, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(BASE);
    await page.setInputFiles(".drop input", {
      name: "access.log",
      mimeType: "text/plain",
      buffer,
    });
    const counts = page.locator(".answer .groups[data-list=main] .count");
    await expect(counts).toHaveText(["100,000", "12"]);
    const fit = await counts.evaluateAll((all) =>
      all.map((count) => {
        const text = document.createRange();
        text.selectNodeContents(count);
        const what = count.nextElementSibling as HTMLElement;
        const digits = text.getBoundingClientRect();
        const box = count.getBoundingClientRect();
        const name = what.getBoundingClientRect().left;
        return {
          // The digits inside their box, and both the box and the digits
          // themselves clear of the group's name (digits too wide for the
          // box spill out of it, so the box alone can't tell).
          inside: digits.left >= box.left - 0.5,
          clear: box.right <= name,
          textClear: digits.right <= name + 0.5,
          right: box.right,
        };
      }),
    );
    for (const f of fit) {
      expect(f.inside, `count inside its box at ${width}`).toBe(true);
      expect(f.clear, `count clear of the name at ${width}`).toBe(true);
      expect(f.textClear, `digits clear of the name at ${width}`).toBe(true);
    }
    // One column: the counts end on one line.
    expect(fit[0]?.right).toBeCloseTo(fit[1]?.right ?? 0, 0);
    await context.close();
  }
});

test("an .evtx header with no events after it", async ({ page }) => {
  await page.goto(BASE);
  await page.setInputFiles(".drop input", fixture("fake.evtx"));
  await expect(page.locator(".answer .problem")).toHaveText(copy.unreadable);
});

test("not a log", async ({ page }) => {
  await page.goto(BASE);
  await page.setInputFiles(".drop input", fixture("not-a-log.txt"));
  await expect(page.locator(".answer .problem")).toHaveText(copy.notALog);
});

test("a reader that doesn't start: the page reloads once for the current one, then says so, and the next drop tries again", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/assets/worker-*.js", (route) =>
    fail ? route.fulfill({ status: 404 }) : route.continue(),
  );
  await page.goto(BASE);
  // The first failure reloads the page.
  await Promise.all([
    page.waitForEvent("load"),
    page.setInputFiles(".drop input", fixture("not-a-log.txt")),
  ]);
  expect(
    await page.evaluate(() => sessionStorage.getItem("stale-reload")),
  ).toBe("1");
  // After that, it's said, without blaming the file.
  await page.setInputFiles(".drop input", fixture("not-a-log.txt"));
  await expect(page.locator(".answer .problem")).toHaveText(copy.wrong);
  // Once the file is there again, the next drop reads.
  fail = false;
  await page.setInputFiles(".drop input", fixture("not-a-log.txt"));
  await expect(page.locator(".answer .problem")).toHaveText(copy.notALog);
});

test(
  "a 50 MB log: progress, a verdict, and the page never stalls",
  { tag: "@perf" },
  async ({ page }) => {
    // The English CSV's events over and over, past 50 MB.
    const dir = mkdtempSync(join(tmpdir(), "logscope-big-"));
    try {
      const csv = readFileSync(fixture("en-system.csv"), "utf8");
      const header = csv.slice(0, csv.indexOf("\n") + 1);
      const body = csv.slice(header.length);
      const times = Math.ceil((50 * 1024 * 1024) / body.length);
      const file = join(dir, "big.csv");
      writeFileSync(file, header + body.repeat(times));

      await page.addInitScript(() => {
        const w = window as unknown as { longest: number };
        w.longest = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            w.longest = Math.max(w.longest, entry.duration);
          }
        }).observe({ type: "longtask", buffered: true });
      });
      await page.goto(BASE, { waitUntil: "networkidle" });
      // Only what happens from the drop on counts.
      await page.evaluate(() => {
        (window as unknown as { longest: number }).longest = 0;
      });
      await page.setInputFiles(".drop input", file);
      await expect(page.locator(".answer .reading")).toBeVisible();
      await expect(page.locator(".answer .verdict")).toHaveText(
        `This PC restarted without shutting down ${(3 * times).toLocaleString("en")} times, ${times.toLocaleString("en")} times after a blue screen.`,
        { timeout: 60_000 },
      );
      const longest = await page.evaluate(
        () => (window as unknown as { longest: number }).longest,
      );
      expect(longest, "the longest task on the page's thread, ms").toBeLessThan(
        200,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("the main list and the quiet list share one count column", async ({
  browser,
}) => {
  // A disk error 123,456 times and a warning 42 times; the quiet list
  // holds a DCOM 10016 seven times.
  const rows = ["Level,Date and Time,Source,Event ID,Task Category"];
  const push = (
    level: string,
    source: string,
    id: number,
    message: string,
    n: number,
  ) => {
    for (let i = 0; i < n; i++)
      rows.push(
        `${level},10/14/2026 ${1 + (i % 11)}:${String(i % 60).padStart(2, "0")}:44 PM,${source},${id},None,"${message}"`,
      );
  };
  push("Error", "disk", 7, "The device has a bad block.", 123_456);
  push(
    "Warning",
    "Microsoft-Windows-Time-Service",
    129,
    "NtpClient was unable to set a domain peer to use as a time source.",
    42,
  );
  push(
    "Error",
    "DistributedCOM",
    10016,
    "The application-specific permission settings do not grant Local Activation permission.",
    7,
  );
  const buffer = Buffer.from(rows.join("\r\n") + "\r\n");
  for (const width of [390, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(BASE);
    await page.setInputFiles(".drop input", {
      name: "system.csv",
      mimeType: "text/plain",
      buffer,
    });
    await expect(
      page.locator(".answer .groups[data-list=main] .count"),
    ).toHaveText(["123,456", "42"]);
    await expect(
      page.locator(".answer .groups[data-list=noise] .count"),
    ).toHaveText(["7"]);
    const rows = await page.locator(".answer .group").evaluateAll((all) =>
      all.map((g) => {
        const count = g.querySelector(".count") as HTMLElement;
        const text = document.createRange();
        text.selectNodeContents(count);
        const box = count.getBoundingClientRect();
        return {
          edges: [
            Math.round(box.right),
            Math.round(
              g.querySelector(".what")?.getBoundingClientRect().left ?? 0,
            ),
          ],
          column: box.width,
          digits: text.getBoundingClientRect().width,
        };
      }),
    );
    expect(rows).toHaveLength(3);
    for (const row of rows)
      expect(row.edges, `count and name edges at ${width}`).toEqual(
        rows[0]?.edges,
      );
    // The shared column is as wide as the widest count's digits, so lining
    // up never comes from every count spilling out of one narrow column.
    const widest = Math.max(...rows.map((row) => row.digits));
    expect(
      rows[0]?.column ?? 0,
      `count column holds 123,456 at ${width}`,
    ).toBeGreaterThanOrEqual(widest - 0.5);
    await context.close();
  }
});

// The theme switch in forced colours is checked once, in template/test.
test("in forced colors the drop zone's link is underlined", async ({
  browser,
}) => {
  const context = await browser.newContext({ forcedColors: "active" });
  const page = await context.newPage();
  await page.goto(BASE);
  const underline = await page
    .locator(".pick")
    .evaluate((node) => getComputedStyle(node).textDecorationLine);
  expect(underline).toBe("underline");
  await context.close();
});
