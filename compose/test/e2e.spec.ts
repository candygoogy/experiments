import { expect, test, type Page } from "@playwright/test";
import { checkBasics, serve } from "../../shared/test/e2e";

const PORT = 4424;
const BASE = `http://127.0.0.1:${PORT}/`;
let stop: (() => Promise<void>) | undefined;

test.beforeAll(async () => {
  stop = await serve("compose", PORT);
});

test.afterAll(async () => {
  await stop?.();
});

// Made-up values that must never reach the page.
const SECRETS = ["s3cret-hunter-2-value", "tok_live_made_up_998877"];
const FILE = `services:
  app:
    image: me/app:1.4
    ports:
      - "3000:3000"
    environment:
      - DB_PASSWORD=${SECRETS[0]}
      - TZ=Etc/UTC
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
  db:
    image: postgres:16
    environment:
      API_TOKEN: ${SECRETS[1]}
    volumes:
      - db:/var/lib/postgresql/data
    restart: unless-stopped
`;

// Console errors and uncaught errors, from the first byte on.
const watch = (page: Page) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
};

const paste = async (page: Page, text: string) => {
  await page.locator("#file").evaluate((el, value) => {
    const area = el as HTMLTextAreaElement;
    area.value = value;
    area.dispatchEvent(
      new InputEvent("input", { inputType: "insertFromPaste", bubbles: true }),
    );
  }, text);
};

test("meets the shared basics", async ({ page }) => {
  await checkBasics(page, BASE);
});

test("the example is on the page, labelled, drawn, and quiet", async ({
  page,
}) => {
  const errors = watch(page);
  await page.goto(BASE);
  const example = page.getByRole("region", { name: "Example: a homelab" });
  await expect(example).toBeVisible();
  await expect(example.locator(".verdict")).toHaveText(
    "One service can take over the whole host, and five more things are worth a look.",
  );
  // The verdict is a heading one level under the pane’s label.
  await expect(example.getByRole("heading", { level: 3 })).toHaveText(
    "One service can take over the whole host, and five more things are worth a look.",
  );
  await expect(example.locator(".svc")).toHaveCount(5);
  // Each network is a heading; each row's ports say where they're open.
  await expect(
    example.getByRole("heading", { name: "The frontend network" }),
  ).toBeVisible();
  // A row by its name (other rows mention it in "Starts after").
  const row = (name: string) =>
    example.locator(".svc").filter({
      has: page.locator(".name", { hasText: new RegExp(`^${name}$`) }),
    });
  await expect(row("jellyfin").locator(".port")).toHaveText(
    "open to your network on port 8096",
  );
  await expect(row("nextcloud").locator(".port")).toHaveText(
    "open to the server only on port 8080 local",
  );
  // The wires are drawn once the page has painted.
  await expect(example.locator("svg.wires path.wire")).toHaveCount(1);
  expect(
    await example.locator("svg.wires path.wire").getAttribute("d"),
  ).toMatch(/^M/);
  await expect(example.locator("svg.wires path.edge-line")).toHaveCount(1);
  // The example's password is in its file, never on the page.
  expect(await page.content()).not.toContain(
    "example-only-not-a-real-password",
  );
  await expect(example).toContainText("POSTGRES_PASSWORD=••••");
  // Nothing is read out for the example.
  await expect(page.locator(".live")).toHaveText("");
  expect(errors).toEqual([]);
});

test("a pasted file takes the example's place, its secrets masked", async ({
  page,
}) => {
  const errors = watch(page);
  await page.goto(BASE);
  await paste(page, FILE);
  const yours = page.getByRole("region", { name: "Your map" });
  await expect(yours).toBeVisible();
  await expect(page.locator(".pane.example")).toBeHidden();
  await expect(yours.locator(".svc")).toHaveCount(2);
  await expect(yours).toContainText("DB_PASSWORD=••••");
  await expect(yours).toContainText("API_TOKEN=••••");
  await expect(yours).toContainText(
    "app waits for db to be healthy, but db has no healthcheck in this file.",
  );
  await expect(page.locator(".live")).toHaveText(
    /^Mapped 2 services\. Nothing can take over the host, but /,
  );
  // No secret value anywhere in the page's markup: text or attributes
  // (the paste area's own value is the visitor's file, not markup).
  const html = await page.content();
  for (const secret of SECRETS) expect(html).not.toContain(secret);
  const attributes = await page.evaluate(() =>
    [...document.querySelectorAll("*")].flatMap((el) =>
      [...el.attributes].map((a) => a.value),
    ),
  );
  for (const secret of SECRETS) {
    expect(attributes.some((v) => v.includes(secret))).toBe(false);
  }
  expect(errors).toEqual([]);
});

test("typing waits for a pause, and an empty file brings the example back", async ({
  page,
}) => {
  await page.goto(BASE);
  const area = page.locator("#file");
  await area.click();
  await area.pressSequentially("services:\n  web:\n    image: nginx:1.27\n", {
    delay: 5,
  });
  await expect(page.getByRole("region", { name: "Your map" })).toBeVisible();
  await expect(page.locator(".pane.yours .svc")).toHaveCount(1);
  await area.fill("");
  await expect(page.locator(".pane.example")).toBeVisible();
  await expect(page.locator(".pane.yours")).toBeHidden();
});

test("a dropped file is read, shown in the paste area, and mapped", async ({
  page,
}) => {
  await page.goto(BASE);
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.items.add(
      new File([text], "docker-compose.yml", { type: "application/yaml" }),
    );
    for (const type of ["dragenter", "dragover", "drop"]) {
      document.body.dispatchEvent(
        new DragEvent(type, {
          dataTransfer: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  }, FILE);
  await expect(page.locator(".pane.yours .svc")).toHaveCount(2);
  expect(await page.locator("#file").inputValue()).toBe(FILE);
});

test("a chosen file too", async ({ page }) => {
  await page.goto(BASE);
  await page.locator(".drop input").setInputFiles({
    name: "compose.yaml",
    mimeType: "application/yaml",
    buffer: Buffer.from(FILE),
  });
  await expect(page.locator(".pane.yours .svc")).toHaveCount(2);
});

test("a file still being read never replaces one chosen after it", async ({
  page,
}) => {
  // The first file's text takes a while to arrive, as a big one's does.
  await page.addInitScript(() => {
    const text = File.prototype.text;
    File.prototype.text = function (this: File) {
      const read = text.call(this);
      return this.name === "slow.yaml"
        ? read.then((t) => new Promise((r) => setTimeout(() => r(t), 500)))
        : read;
    };
  });
  await page.goto(BASE);
  const input = page.locator(".drop input");
  await input.setInputFiles({
    name: "slow.yaml",
    mimeType: "application/yaml",
    buffer: Buffer.from("services:\n  slow:\n    image: nginx\n"),
  });
  await input.setInputFiles({
    name: "compose.yaml",
    mimeType: "application/yaml",
    buffer: Buffer.from(FILE),
  });
  await expect(page.locator(".pane.yours .svc")).toHaveCount(2);
  await page.waitForTimeout(800);
  await expect(page.locator(".pane.yours .svc")).toHaveCount(2);
  await expect(page.locator("textarea")).toHaveValue(FILE);
});

test("broken YAML names its line; the last map stays", async ({ page }) => {
  await page.goto(BASE);
  const broken =
    "services:\n  web:\n    image: nginx\n   ports:\n      - 8080:80\n";
  await paste(page, broken);
  await expect(page.locator("#problem")).toHaveText(
    "This doesn’t read as YAML (line 4). Check the indentation there.",
  );
  await expect(page.locator(".pane.example")).toBeVisible();
  await paste(page, FILE);
  await expect(page.locator("#problem")).toBeHidden();
  await paste(page, `${FILE}  broken: [\n`);
  await expect(page.locator("#problem")).toContainText(
    "This doesn’t read as YAML",
  );
  await expect(page.locator(".pane.yours .svc")).toHaveCount(2);
});

test("a broken edit dims the last map, marks the field, and is read out once typing pauses", async ({
  page,
}) => {
  await page.goto(BASE);
  const area = page.locator("#file");
  const yours = page.locator(".pane.yours");
  const live = page.locator(".live");
  await paste(page, FILE);
  await expect(live).toHaveText(/^Mapped 2 services\./);
  await expect(area).not.toHaveAttribute("aria-invalid", /.*/);

  // Typed, not pasted: nothing is read out while typing goes on.
  await area.focus();
  await area.press("Control+End");
  await page.keyboard.type("  broken: [", { delay: 20 });
  const line =
    /^This doesn’t read as YAML \(line \d+\)\. Check the indentation there\. The map still shows the last version that read correctly\.$/;
  await expect(page.locator("#problem")).toHaveText(line);
  // Not yet: typing has only just paused.
  await expect(live).toHaveText(/^Mapped 2 services\./);
  await expect(area).toHaveAttribute("aria-invalid", "true");
  await expect(yours).toHaveClass(/is-stale/);
  await expect
    .poll(() =>
      yours.locator(".out").evaluate((n) => getComputedStyle(n).opacity),
    )
    .toBe("0.5");
  await expect(yours.locator(".svc")).toHaveCount(2);
  // Then, a second after the last key, it is.
  await expect(live).toHaveText(line, { timeout: 3000 });

  // Mended: the map is current again, and so is everything else.
  await paste(page, FILE);
  await expect(page.locator("#problem")).toBeHidden();
  await expect(area).not.toHaveAttribute("aria-invalid", /.*/);
  await expect(yours).not.toHaveClass(/is-stale/);
  await expect(live).toHaveText(/^Mapped 2 services\./);
});

test("a paste that breaks the file is read out at once", async ({ page }) => {
  await page.goto(BASE);
  await paste(page, FILE);
  await expect(page.locator(".live")).toHaveText(/^Mapped/);
  await paste(page, `${FILE}  broken: [\n`);
  await expect(page.locator(".live")).toHaveText(
    /^This doesn’t read as YAML .* The map still shows the last version that read correctly\.$/,
  );
});

test("a paste too big to read is never parsed", async ({ page }) => {
  await page.goto(BASE);
  const huge = `services:\n  a:\n    image: a:1\n${"# padding\n".repeat(210_000)}`;
  await paste(page, huge);
  await expect(page.locator("#problem")).toHaveText(
    "This file is too big to read here.",
  );
  await expect(page.locator(".pane.example")).toBeVisible();
  await expect(page.locator(".pane.yours")).toBeHidden();
});

test("the cap counts bytes: a paste under it in characters but over it in bytes is too big too", async ({
  page,
}) => {
  await page.goto(BASE);
  // 1.1 million characters, 2.2 million bytes once written out.
  const wide = `services:\n  a:\n    image: a:1\n# ${"é".repeat(1_100_000)}\n`;
  await paste(page, wide);
  await expect(page.locator("#problem")).toHaveText(
    "This file is too big to read here.",
  );
});

test("a file the map can't be drawn from says so, and the last map stays", async ({
  page,
}) => {
  const errors = watch(page);
  await page.goto(BASE);
  await paste(page, FILE);
  const yours = page.getByRole("region", { name: "Your map" });
  await expect(yours.locator(".svc")).toHaveCount(2);
  // The drawing breaks on the next file, as a fault in it would.
  await page.evaluate(() => {
    const make = Document.prototype.createElement;
    Document.prototype.createElement = function (
      this: Document,
      ...args: Parameters<Document["createElement"]>
    ) {
      if ((window as unknown as { broken?: boolean }).broken) {
        throw new Error("drawing broke");
      }
      return make.apply(this, args);
    } as Document["createElement"];
    (window as unknown as { broken?: boolean }).broken = true;
  });
  await paste(page, FILE.replace("app:", "web:"));
  await expect(page.locator("#problem")).toHaveText(
    "Something in this file stopped the map from being drawn. The map still shows the last version that read correctly.",
  );
  await expect(yours).toHaveClass(/is-stale/);
  await expect(yours.locator(".svc")).toHaveCount(2);
  await expect(page.locator(".live")).toHaveText(
    "Something in this file stopped the map from being drawn. The map still shows the last version that read correctly.",
  );
  expect(errors).toEqual([]);
});

test("map code that's gone since the page opened: it says to reload, and never reloads itself", async ({
  page,
}) => {
  const errors = watch(page);
  await page.route("**/assets/answer-*.js", (route) => route.abort());
  await page.goto(BASE);
  let loads = 0;
  page.on("load", () => loads++);
  await paste(page, FILE);
  await expect(page.locator("#problem")).toHaveText(
    "This page has changed since it opened. Reload it, then paste or drop your file again.",
  );
  await expect(page.locator(".live")).toHaveText(
    "This page has changed since it opened. Reload it, then paste or drop your file again.",
  );
  // Nothing reloaded: the pasted text is still there, and no flag was set.
  expect(loads).toBe(0);
  await expect(page.locator("#file")).toHaveValue(FILE);
  expect(
    await page.evaluate(() => sessionStorage.getItem("stale-reload")),
  ).toBeNull();
  // The text itself is fine: the field isn't marked.
  await expect(page.locator("#file")).not.toHaveAttribute("aria-invalid");
  await expect(page.locator(".pane.example")).toBeVisible();
  expect(errors.filter((e) => !/^Failed to load resource/.test(e))).toEqual([]);
});

test("map code that loads but breaks: the page says something went wrong", async ({
  page,
}) => {
  await page.route("**/assets/answer-*.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: 'throw new Error("broke");',
    }),
  );
  await page.goto(BASE);
  await paste(page, FILE);
  await expect(page.locator("#problem")).toHaveText(
    "Something went wrong while reading this. Try again.",
  );
});

// A main file and its override, dropped together, as netbox-docker ships
// them: the main file has no restart policy and no published port; the
// override adds both.
const MAIN = `services:
  app:
    image: me/app:2.1
    depends_on: [db]
  db:
    image: postgres:16
`;
const OVERRIDE = `services:
  app:
    restart: unless-stopped
    ports:
      - "8000:8080"
  db:
    restart: unless-stopped
`;

const drop = async (page: Page, files: [string, string][]) => {
  await page.evaluate((files) => {
    const data = new DataTransfer();
    for (const [name, text] of files) {
      data.items.add(new File([text], name, { type: "application/yaml" }));
    }
    for (const type of ["dragenter", "dragover", "drop"]) {
      document.body.dispatchEvent(
        new DragEvent(type, {
          dataTransfer: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  }, files);
};

test("a main file and its override, dropped together, are read as one", async ({
  page,
}) => {
  const errors = watch(page);
  await page.goto(BASE);
  // Dropped override first: they're still read main file first.
  await drop(page, [
    ["docker-compose.override.yml", OVERRIDE],
    ["docker-compose.yml", MAIN],
  ]);
  const yours = page.locator(".pane.yours");
  await expect(yours.locator(".note")).toHaveText(
    "Read as one, the way Docker Compose merges them when you don’t pass -f: docker-compose.yml, then docker-compose.override.yml.",
  );
  await expect(yours.locator(".verdict")).toHaveText(
    "Nothing can take over the host, but one thing is worth a look.",
  );
  await expect(yours.getByRole("heading", { level: 3 })).toHaveText(
    "Nothing can take over the host, but one thing is worth a look.",
  );
  await expect(yours.locator(".findings li")).toHaveCount(1);
  await expect(yours.locator(".findings li")).toContainText(
    "app is open to every device on your network on port 8000",
  );
  await expect(yours.locator(".svc .image").first()).toHaveText("postgres:16");
  expect(await page.locator("#file").inputValue()).toBe(
    `# docker-compose.yml\n${MAIN}---\n# docker-compose.override.yml\n${OVERRIDE}`,
  );
  expect(errors).toEqual([]);
});

test("several files chosen at once too", async ({ page }) => {
  await page.goto(BASE);
  await page.locator(".drop input").setInputFiles([
    {
      name: "compose.yaml",
      mimeType: "application/yaml",
      buffer: Buffer.from(MAIN),
    },
    {
      name: "compose.override.yaml",
      mimeType: "application/yaml",
      buffer: Buffer.from(OVERRIDE),
    },
  ]);
  await expect(page.locator(".pane.yours .note")).toHaveText(
    "Read as one, the way Docker Compose merges them when you don’t pass -f: compose.yaml, then compose.override.yaml.",
  );
});

test("an override on its own, and a main file on its own, each say what's missing", async ({
  page,
}) => {
  await page.goto(BASE);
  await paste(page, OVERRIDE);
  await expect(page.locator(".pane.yours .note")).toHaveText(
    "No service here names an image, so this looks like an override file. Docker Compose merges it into the main file: drop both together, or paste the main file first, then a line with ---, then this one.",
  );
  await drop(page, [["docker-compose.yml", MAIN]]);
  await expect(page.locator(".pane.yours .note")).toHaveText(
    "If there’s a docker-compose.override.yml next to this file, Docker Compose merges it in: drop both together to see them as one.",
  );
  // Pasted, the same text has no name, so nothing is said.
  await paste(page, MAIN);
  await expect(page.locator(".pane.yours .note")).toHaveCount(0);
});

test("not a compose file", async ({ page }) => {
  await page.goto(BASE);
  await paste(page, "just: words\n");
  await expect(page.locator("#problem")).toHaveText(
    "This file has no services to map.",
  );
});

test(
  "300 services: no main-thread task over 200 ms",
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
    let big = "x-base: &base\n  restart: unless-stopped\nservices:\n";
    for (let i = 0; i < 300; i++) {
      big +=
        `  s${i}:\n    <<: *base\n    image: app/s${i}:1.${i}\n` +
        `    ports:\n      - "${10000 + i}:80"\n` +
        `    volumes:\n      - data${i}:/data\n      - ./c${i}:/config\n` +
        `    environment:\n      DB_PASSWORD: made-up-${i}\n` +
        `    networks: [net${i % 7}]\n` +
        (i ? `    depends_on: [s${Math.floor(i / 2)}]\n` : "");
    }
    await paste(page, big);
    await expect(page.locator(".pane.yours .svc")).toHaveCount(300);
    // However many wires there are, every row keeps its width.
    const widths = await page
      .locator(".pane.yours .svc .line")
      .evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().width));
    expect(Math.min(...widths)).toBeGreaterThan(300);
    await page.waitForTimeout(500);
    const long = await page.evaluate(
      () => (window as unknown as { long: number[] }).long,
    );
    expect(Math.max(0, ...long)).toBeLessThan(200);
  },
);

test("nothing shifts as the page loads, from 320 to 1920 wide", async ({
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
    await page.waitForTimeout(800);
    // Down the page and back, past the sticky paste area.
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(300);
    await page.mouse.wheel(0, -1500);
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

test("a value written into a key never reaches the page", async ({ page }) => {
  const errors = watch(page);
  await page.goto(BASE);
  // A file that once leaked a value through its key, with every other
  // place a value could hide.
  const secrets = [
    "hunter2",
    "s3cr3t-db",
    "sk-live",
    "tok-999",
    "pw-in-cmd",
    "argsecret",
    "label-secret",
  ];
  await paste(
    page,
    `x-env: &env
  SHARED_PASSWORD: s3cr3t-db
services:
  app:
    image: app:1
    restart: always
    environment:
      <<: *env
    command: ["--password", "pw-in-cmd"]
    labels:
      - traefik.http.middlewares.auth.basicauth.users=admin:label-secret
  db:
    image: postgres:16
    restart: always
    environment:
      - POSTGRES_PASSWORD=\${DB:-hunter2}
      - "API_TOKEN: tok-999"
    build:
      context: .
      args:
        NPM_TOKEN: argsecret
  weird:
    image: w:1
    restart: always
    environment:
      "API_KEY=sk-live-123": "x"
`,
  );
  const yours = page.locator(".pane.yours");
  await expect(yours.locator(".svc")).toHaveCount(3);
  await expect(yours).toContainText(
    "weird has API_KEY=•••• written in the file",
  );
  await expect(yours).toContainText("POSTGRES_PASSWORD=••••");
  // Every element's own text and every attribute, the live region and
  // the problem line included; only the paste area holds the file.
  const hits = await page.evaluate((secrets) => {
    const area = document.querySelector("#file");
    const out: string[] = [];
    for (const el of document.querySelectorAll("*")) {
      if (el === area) continue;
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join("");
      const attrs = [...el.attributes].map((a) => a.value).join(" ");
      for (const s of secrets) {
        if (own.includes(s) || attrs.includes(s))
          out.push(`${s} in ${el.tagName}`);
      }
    }
    return out;
  }, secrets);
  expect(hits).toEqual([]);
  expect(errors).toEqual([]);
});

test("150 services waiting for one share a single trunk", async ({ page }) => {
  await page.goto(BASE);
  let star = "services:\n  db:\n    image: db:1\n    restart: always\n";
  for (let i = 0; i < 150; i++) {
    star += `  s${i}:\n    image: s:1\n    restart: always\n    depends_on: [db]\n`;
  }
  await paste(page, star);
  const map = page.locator(".pane.yours .map");
  await expect(map.locator(".svc")).toHaveCount(151);
  await expect(map).toHaveAttribute("data-lanes", "1");
  const wire = map.locator("svg.wires path.wire");
  await expect(wire).toHaveAttribute("d", /^M/);
  // Every wire runs down the same x: one trunk, a tap into each row.
  const d = (await wire.getAttribute("d")) ?? "";
  const xs = new Set([...d.matchAll(/V[\d.]+Q([\d.]+)/g)].map((m) => m[1]));
  expect(xs.size).toBe(1);
});

test("on a short window the file column scrolls with the page", async ({
  browser,
}) => {
  let long = "services:\n";
  for (let i = 0; i < 40; i++) {
    long += `  s${i}:\n    image: s:1\n    restart: always\n    ports: ["${8000 + i}:80"]\n`;
  }
  const seen = async (page: Page, selector: string) =>
    page.locator(selector).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight;
    });
  for (const [width, height] of [
    [900, 420],
    [1024, 500],
  ] as const) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await page.goto(BASE);
    await paste(page, long);
    await expect(page.locator(".pane.yours .svc")).toHaveCount(40);
    // A broken file's line shows under the paste area; the last map stays.
    await paste(page, `${long}  broken: [\n`);
    await expect(page.locator("#problem")).toBeVisible();
    const input = page.locator(".input");
    expect(
      await input.evaluate((el) => getComputedStyle(el).position),
      `${width}×${height}`,
    ).toBe("static");
    // The drop zone and the problem line come into view as soon as the
    // page is scrolled to them, not at the end of the map.
    const page_ = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    let first = -1;
    for (let y = 0; y < page_ && first === -1; y += 50) {
      await page.evaluate((y) => scrollTo(0, y), y);
      if ((await seen(page, ".input .drop")) && (await seen(page, "#problem")))
        first = y;
    }
    expect(first, `${width}×${height}`).toBeGreaterThanOrEqual(0);
    expect(first, `${width}×${height}`).toBeLessThan(800);
    await context.close();
  }
  // A tall enough window keeps the file in view beside the map.
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(BASE);
  expect(
    await page
      .locator(".input")
      .evaluate((el) => getComputedStyle(el).position),
  ).toBe("sticky");
  await context.close();
});

test("a gateway waiting for 30 services draws one trunk into it", async ({
  page,
}) => {
  await page.goto(BASE);
  let yml = "services:\n";
  for (let i = 0; i < 30; i++) {
    yml += `  d${i}:\n    image: d:1\n    restart: always\n`;
  }
  yml += `  gw:\n    image: g:1\n    restart: always\n    depends_on: [${Array.from({ length: 30 }, (_, i) => `d${i}`).join(", ")}]\n`;
  await paste(page, yml);
  const map = page.locator(".pane.yours .map");
  await expect(map.locator(".svc")).toHaveCount(31);
  await expect(map).toHaveAttribute("data-lanes", "1");
  const wire = map.locator("svg.wires path.wire");
  await expect(wire).toHaveAttribute("d", /^M/);
  // Every wire runs along the same x: one trunk, a tap out of each row.
  const d = (await wire.getAttribute("d")) ?? "";
  const xs = new Set([...d.matchAll(/V[\d.]+Q([\d.]+)/g)].map((m) => m[1]));
  expect(xs.size).toBe(1);
});

test("the drop line says “or” once, as the other tools do", async ({
  page,
}) => {
  await page.goto(BASE);
  await expect(page.locator(".drop-main")).toHaveText(
    "Drop it here, or choose the file",
  );
});

test("a long service name with no breaks wraps on a phone", async ({
  browser,
}) => {
  const name = "averyveryverylongservicenamewithoutanybreaksatallforoverflow";
  for (const width of [390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 800 },
    });
    const page = await context.newPage();
    const errors = watch(page);
    await page.goto(BASE);
    await paste(
      page,
      `services:\n  ${name}:\n    image: a:1\n    ports:\n      - "8080:80"\n`,
    );
    const yours = page.locator(".pane.yours");
    await expect(yours.locator(".svc .name")).toHaveText(name);
    await expect(yours.locator(".findings b").first()).toHaveText(name);
    for (const box of [
      await yours.locator(".svc .name").boundingBox(),
      await yours.locator(".findings b").first().boundingBox(),
    ]) {
      expect((box?.x ?? 0) + (box?.width ?? 0), `at ${width}`).toBeLessThan(
        width,
      );
    }
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    );
    expect(over, `overflow at ${width}`).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    await context.close();
  }
});
