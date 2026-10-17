import { expect, test, type Page, type Route } from "@playwright/test";
import { checkBasics, serve } from "../../shared/test/e2e";
import { answerFor, type Table } from "../src/table";

const PORT = 4425;
const BASE = `http://127.0.0.1:${PORT}/`;
const DNS = "https://cloudflare-dns.com/dns-query";
let stop: (() => Promise<void>) | undefined;

test.beforeAll(async () => {
  stop = await serve("mail", PORT);
});

test.afterAll(async () => {
  await stop?.();
});

const q = (s: string) => `"${s}"`;
const ans = (type: number, ...data: string[]) => ({
  Status: 0,
  AD: false,
  Answer: data.map((d) => ({ type, data: d })),
});

// A made-up shop whose SPF breaks the lookup limit and which has no DMARC.
const SHOP: Table = {
  "shop.example.net MX": ans(15, "10 mail.example.net."),
  "mail.example.net CNAME": ans(5, "host.example.net."),
  "shop.example.net TXT": ans(
    16,
    q(
      "v=spf1 a mx include:one.example include:two.example include:three.example ?all",
    ),
  ),
  ...Object.fromEntries(
    ["one", "two", "three"].map((n) => [
      `${n}.example TXT`,
      ans(16, q("v=spf1 a mx exists:x.example -all")),
    ]),
  ),
};

// Every question to Cloudflare's DNS is answered from `table` (nothing
// reaches the real network), after `delay` ms; the questions are kept.
async function fakeDns(page: Page, table: Table, delay = 0) {
  const asked: { url: string; accept: string | undefined }[] = [];
  await page.route(`${DNS}**`, async (route: Route) => {
    const request = route.request();
    asked.push({ url: request.url(), accept: request.headers()["accept"] });
    if (delay) await new Promise((r) => setTimeout(r, delay));
    await route.fulfill({
      contentType: "application/dns-json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(answerFor(table, request.url())),
    });
  });
  return asked;
}

const watch = (page: Page) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
};

const ask = async (page: Page, text: string) => {
  await page.locator("#domain").fill(text);
  await page.getByRole("button", { name: "Check" }).click();
};

test("meets the shared basics, with Cloudflare's DNS as its one host", async ({
  page,
}) => {
  await checkBasics(page, BASE, { connectSrc: ["https://cloudflare-dns.com"] });
});

test("the example is on the page, asks no DNS, and says nothing aloud", async ({
  page,
}) => {
  const errors = watch(page);
  const asked = await fakeDns(page, {});
  await page.goto(BASE);
  const example = page.getByRole("region", {
    name: "Example: shop.example, a made-up domain",
  });
  await expect(example.locator(".verdict")).toHaveText(
    "Mail from this domain is well protected.",
  );
  // The verdict is a heading one level under the pane’s label, each check one under it.
  await expect(example.getByRole("heading", { level: 3 })).toHaveText(
    "Mail from this domain is well protected.",
  );
  await expect(example.getByRole("heading", { level: 4 })).toHaveCount(5);
  await expect(example.locator(".check")).toHaveCount(5);
  await expect(
    example.getByRole("heading", { name: "Signatures (DKIM)" }),
  ).toBeVisible();
  await expect(example.locator(".check").nth(2)).toContainText(
    "s1: RSA, 2048 bits",
  );
  await page.waitForTimeout(500);
  expect(asked).toEqual([]);
  await expect(page.locator(".live")).toHaveText("");
  expect(errors).toEqual([]);
});

test("a domain's answer takes the example's place, worst first in each row", async ({
  page,
}) => {
  const errors = watch(page);
  const asked = await fakeDns(page, SHOP);
  await page.goto(BASE);
  await ask(page, "orders@Shop.Example.NET");
  const yours = page.getByRole("region", { name: "shop.example.net" });
  await expect(yours.locator(".verdict")).toHaveText(
    "Mail from this domain can be faked.",
  );
  await expect(yours.getByRole("heading", { level: 3 })).toHaveText(
    "Mail from this domain can be faked.",
  );
  await expect(page.locator(".pane.example")).toBeHidden();
  const row = (name: string) =>
    yours
      .locator(".check")
      .filter({ has: page.getByRole("heading", { name }) });
  await expect(row("Who may send (SPF)").locator(".level")).toHaveText(
    "Broken",
  );
  await expect(row("Who may send (SPF)").locator(".says")).toHaveText(
    "It takes 14 DNS lookups, more than 10, so it breaks, and receivers may ignore it.",
  );
  await expect(row("Who may send (SPF)").locator(".details")).toContainText(
    "says nothing about anyone else (?all)",
  );
  await expect(row("Receiving (MX)").locator(".level")).toHaveText("Weak");
  await expect(row("Receiving (MX)").locator(".says")).toContainText(
    "alias (CNAME)",
  );
  await expect(row("Policy (DMARC)").locator(".level")).toHaveText("Missing");
  await expect(row("Signatures (DKIM)").locator(".level")).toHaveCount(0);
  await expect(page.locator(".live")).toHaveText(
    "shop.example.net: Mail from this domain can be faked.",
  );
  await expect(page.locator("#problem")).toHaveText(
    "Checked shop.example.net.",
  );
  // Only Cloudflare was asked, in JSON, about this domain and what its
  // SPF pulls in.
  expect(asked.length).toBeGreaterThan(20);
  for (const a of asked) {
    expect(a.url.startsWith(`${DNS}?name=`)).toBe(true);
    expect(a.accept).toBe("application/dns-json");
  }
  expect(
    asked.some((a) => a.url.includes("name=shop.example.net&type=MX")),
  ).toBe(true);
  expect(asked.some((a) => a.url.includes("name=one.example&type=TXT"))).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

// The built CSS has the token minified (200ms becomes .2s); the answer
// must still take the full 200ms to arrive, not 0.2ms.
test("the answer fades in over 200ms, as built", async ({ page }) => {
  await fakeDns(page, SHOP);
  await page.addInitScript(() => {
    const seen: number[] = [];
    (window as unknown as { seen: number[] }).seen = seen;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      if (this.classList.contains("yours") && typeof options === "object") {
        seen.push(Number(options.duration));
      }
      return animate.call(this, keyframes, options);
    };
  });
  await page.goto(BASE);
  await ask(page, "shop.example.net");
  await expect(page.locator(".pane.yours")).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { seen: number[] }).seen),
  ).toEqual([200]);
});

test("not a domain: one calm line, and no question asked", async ({ page }) => {
  const asked = await fakeDns(page, {});
  await page.goto(BASE);
  await ask(page, "not a domain!");
  await expect(page.locator("#problem")).toHaveText(
    "That doesn’t look like a domain. Try something like example.com.",
  );
  await expect(page.locator(".pane.example")).toBeVisible();
  expect(asked).toEqual([]);
});

test("a name kept for tests or examples: one calm line, and nothing sent to Cloudflare", async ({
  page,
}) => {
  const errors = watch(page);
  const asked = await fakeDns(page, {});
  await page.goto(BASE);
  for (const name of ["shop.example", "a.localhost", "me@foo.invalid"]) {
    await ask(page, name);
    await expect(page.locator("#problem")).toHaveText(
      "That name is kept for tests, examples or local networks, so it has no mail records to check.",
    );
    await expect(page.locator(".live")).toHaveText(
      "That name is kept for tests, examples or local networks, so it has no mail records to check.",
    );
    await expect(page.locator(".pane.example")).toBeVisible();
  }
  await page.waitForTimeout(300);
  expect(asked).toEqual([]);
  expect(errors).toEqual([]);
});

test("a failed check after an answer: the answer stays, dimmed and labelled as the last one", async ({
  page,
}) => {
  const errors = watch(page);
  await fakeDns(page, {
    ...SHOP,
    "gone.example.net MX": { Status: 3, AD: false },
    "gone.example.net TXT": { Status: 3, AD: false },
  });
  await page.goto(BASE);
  const field = page.locator("#domain");
  const yours = page.locator(".pane.yours");
  await ask(page, "shop.example.net");
  await expect(yours.locator(".verdict")).toBeVisible();
  await expect(yours).not.toHaveClass(/is-stale/);

  // A domain that doesn't exist.
  await ask(page, "gone.example.net");
  await expect(page.locator("#problem")).toHaveText(
    "gone.example.net doesn’t exist in DNS.",
  );
  await expect(yours).toHaveClass(/is-stale/);
  await expect(
    page.getByRole("region", { name: "Last checked: shop.example.net" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      yours.locator(".out").evaluate((n) => getComputedStyle(n).opacity),
    )
    .toBe("0.5");
  await expect(field).not.toHaveAttribute("aria-invalid", /.*/);

  // Not a domain: the field is marked invalid as well.
  await ask(page, "localhost");
  await expect(page.locator("#problem")).toHaveText(
    "That doesn’t look like a domain. Try something like example.com.",
  );
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(yours).toHaveClass(/is-stale/);

  // A good answer clears both.
  await ask(page, "shop.example.net");
  await expect(page.locator("#problem")).toHaveText(
    "Checked shop.example.net.",
  );
  await expect(field).not.toHaveAttribute("aria-invalid", /.*/);
  await expect(yours).not.toHaveClass(/is-stale/);
  await expect(
    page.getByRole("region", { name: "shop.example.net" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("a domain that doesn't exist", async ({ page }) => {
  await fakeDns(page, {
    "gone.example.net MX": { Status: 3, AD: false },
    "gone.example.net TXT": { Status: 3, AD: false },
  });
  await page.goto(BASE);
  await ask(page, "gone.example.net");
  await expect(page.locator("#problem")).toHaveText(
    "gone.example.net doesn’t exist in DNS.",
  );
  await expect(page.locator(".pane.example")).toBeVisible();
});

test("when the DNS doesn't answer, it says so and the example stays", async ({
  page,
}) => {
  const errors = watch(page);
  await page.route(`${DNS}**`, (route) => route.abort("failed"));
  await page.goto(BASE);
  await ask(page, "example.net");
  await expect(page.locator("#problem")).toHaveText(
    "Cloudflare’s DNS didn’t answer. Check your connection and try again.",
  );
  await expect(page.locator(".pane.example")).toBeVisible();
  // The browser logs the failed requests themselves; the page adds none.
  expect(errors.filter((e) => !e.includes("Failed to load resource"))).toEqual(
    [],
  );
});

test("nothing shifts, from 320 to 1920 wide, loading or answering slowly", async ({
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
    await fakeDns(page, SHOP, 700);
    await page.goto(BASE);
    await page.waitForTimeout(600);
    await ask(page, "shop.example.net");
    await expect(page.locator(".pane.yours")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(300);
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

test("a domain with a 63-character label wraps, with no sideways scroll at 320 or 390", async ({
  browser,
}) => {
  // The longest label DNS allows, with no hyphen to break at, and an
  // include whose name is as long, for the sentences under the verdict.
  const label = "a".repeat(63);
  const domain = `${label}.example.net`;
  const include = `${"b".repeat(63)}.example.net`;
  for (const width of [320, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    const page = await context.newPage();
    await fakeDns(page, {
      [`${domain} MX`]: ans(15, "10 mail.example.net."),
      [`${domain} TXT`]: ans(16, q(`v=spf1 include:${include} -all`)),
    });
    await page.goto(BASE);
    await ask(page, domain);
    await expect(page.locator("#problem")).toHaveText(`Checked ${domain}.`);
    await expect(page.locator(".pane.yours .says").nth(1)).toContainText(
      include,
    );
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    );
    expect(over, `overflow at ${width}`).toBeLessThanOrEqual(0);
    await context.close();
  }
});

test("a DMARC lookup that fails: couldn't check, never can be faked", async ({
  page,
}) => {
  const errors = watch(page);
  await page.goto(BASE);
  await page.route(`${DNS}**`, async (route: Route) => {
    const url = new URL(route.request().url());
    const failed = url.searchParams.get("name") === "_dmarc.safe.example.net";
    await route.fulfill({
      contentType: "application/dns-json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(
        failed
          ? { Status: 2 }
          : answerFor(
              {
                "safe.example.net MX": ans(15, "10 mail.example.net."),
                "safe.example.net TXT": ans(16, q("v=spf1 -all")),
              },
              route.request().url(),
            ),
      ),
    });
  });
  await ask(page, "safe.example.net");
  const answer = page.locator(".pane.yours");
  await expect(answer.locator(".verdict")).toHaveText(
    "Couldn’t check everything: the DMARC policy didn’t answer, so this can’t say how well mail from this domain is protected.",
  );
  await expect(answer.locator(".check.is-unchecked .level")).toHaveText(
    "Couldn’t check",
  );
  await expect(page.locator(".live")).toContainText(
    "Couldn’t check everything",
  );
  expect(errors).toEqual([]);
});

test("the check's code fails to load: one calm line, and the button works again", async ({
  page,
}) => {
  await fakeDns(page, SHOP);
  await page.goto(BASE);
  await page.route("**/assets/check-*.js", (route) =>
    route.abort("internetdisconnected"),
  );
  await ask(page, "shop.example.net");
  await expect(page.locator("#problem")).toHaveText(
    "Something went wrong while checking. Try again.",
  );
  await expect(page.locator(".live")).toHaveText(
    "Something went wrong while checking. Try again.",
  );
  const check = page.getByRole("button", { name: "Check" });
  await expect(check).toBeEnabled();
  // Once the code can load, the same button checks the domain.
  await page.unroute("**/assets/check-*.js");
  await check.click();
  await expect(page.locator(".pane.yours .verdict")).toBeVisible();
});
