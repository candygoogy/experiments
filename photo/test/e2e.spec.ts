import { expect, test, type Page } from "@playwright/test";
import exifr from "exifr";
import { unzipSync } from "fflate";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { deflateSync } from "node:zlib";
import {
  checkBasics,
  consoleErrors,
  layoutShift,
  serve,
  SIZES,
} from "../../shared/test/e2e";
import { copy } from "../src/copy";
import { ARTIST, box, exifPayload, heic, PICTURES, MARKER, u16 } from "./craft";
import { ascii, pngChunk, riff, segment, webpChunk } from "./forge";
import { image } from "./gradient";
import { picture } from "./picture";
import { crafted, LEAKS } from "./profile";

const PORT = 4423;
const BASE = `http://127.0.0.1:${PORT}/`;
const FIXTURES = join(import.meta.dirname, "fixtures");
const fixture = (name: string) => join(FIXTURES, name);
const GPS =
  "This photo carries the exact place it was taken (51.4769°\u00a0N, 0.0005°\u00a0W). Anyone you send it to can see it.";
let stop: (() => Promise<void>) | undefined;

test.beforeAll(async () => {
  stop = await serve("photo", PORT);
});

test.afterAll(async () => {
  await stop?.();
});

async function downloaded(page: Page, click: () => Promise<void>) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    click(),
  ]);
  const path = await download.path();
  return {
    name: download.suggestedFilename(),
    bytes: new Uint8Array(readFileSync(path)),
  };
}

test("meets the shared basics", async ({ page }) => {
  await checkBasics(page, BASE);
});

test("reading a photo asks nothing of anywhere else", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.addInitScript(() => {
    const w = window as unknown as { violations: string[] };
    w.violations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      w.violations.push(e.blockedURI),
    );
  });
  await page.goto(BASE);
  await page.setInputFiles(".drop input", [
    fixture("gps.jpg"),
    fixture("meta.png"),
  ]);
  await expect(page.locator(".photo")).toHaveCount(2);
  await expect(page.locator(".download")).toBeVisible();
  const elsewhere = requests.filter(
    (u) => /^https?:/.test(u) && new URL(u).origin !== new URL(BASE).origin,
  );
  expect(elsewhere).toEqual([]);
  expect(
    await page.evaluate(
      () => (window as unknown as { violations: string[] }).violations,
    ),
  ).toEqual([]);
});

test("one photo: what it gives away, and a clean copy without it", async ({
  page,
}) => {
  await page.goto(BASE);
  await page.setInputFiles(".drop input", fixture("gps.jpg"));
  await expect(page.locator(".photo .lead")).toHaveText(GPS);
  await expect(page.locator(".photo .line")).toHaveText([
    "It names the camera that took it: Example Cam 1. The lens: Example 35mm.",
    "It records when it was taken: Oct 1, 2026, 12:00.",
    "It names the software that last saved it: Example Editor 2.",
    "It names a person: Test Person.",
    "It carries a comment: Made for a test.",
  ]);
  const summary = page.locator(".all summary");
  await expect(summary).toHaveText("Show everything", { useInnerText: true });
  await summary.click();
  await expect(summary).toHaveText("Hide", { useInnerText: true });
  await expect(page.locator(".all dt").first()).toBeVisible();
  // Grouped by where each value came from, codes in words.
  await expect(page.locator(".all .block")).toHaveText([
    "Exif",
    "GPS",
    "XMP",
    "IPTC",
    "Text",
  ]);
  await expect(
    page
      .locator(".all div", {
        has: page.locator("dt", { hasText: /^Orientation$/ }),
      })
      .locator("dd"),
  ).toHaveText("upright");

  const file = await downloaded(page, () => page.click(".download"));
  expect(file.name).toBe("gps-clean.jpg");
  const meta = await exifr.parse(file.bytes, {
    tiff: true,
    xmp: true,
    iptc: true,
  });
  expect(meta?.latitude).toBeUndefined();
  expect(meta?.Make).toBeUndefined();
  expect(Buffer.from(file.bytes).toString("latin1")).not.toContain(
    "Test Person",
  );
});

test("a PNG named .jpg is read and saved as a PNG", async ({ page }) => {
  await page.goto(BASE);
  await page.setInputFiles(".drop input", {
    name: "photo.jpg",
    mimeType: "image/jpeg",
    buffer: readFileSync(fixture("meta.png")),
  });
  await expect(page.locator(".photo .lead")).toHaveText(GPS);
  const file = await downloaded(page, () => page.click(".download"));
  expect(file.name).toBe("photo-clean.png");
  expect(Array.from(file.bytes.subarray(0, 4))).toEqual([
    0x89, 0x50, 0x4e, 0x47,
  ]);
});

test("details this page can't clean: said so, and no clean copy", async ({
  page,
}) => {
  // The Exif is stored inside another item (iloc's construction method 2).
  const file = heic(
    [
      ...PICTURES,
      {
        id: 3,
        type: "Exif",
        payload: exifPayload([[ARTIST, MARKER]]),
        method: 2,
      },
    ],
    [box("cdsc", u16(3), u16(1), u16(1))],
  );
  await page.goto(BASE);
  await page.setInputFiles(".drop input", {
    name: "inside.heic",
    mimeType: "image/heic",
    buffer: Buffer.from(file),
  });
  await expect(page.locator(".photo .lead")).toHaveText(copy.cantClean);
  await expect(page.locator(".photo")).not.toContainText(copy.nothing);
  await expect(page.locator(".download")).toHaveCount(0);
});

test("two photos that both carry the place: both, not all 2", async ({
  page,
}) => {
  await page.goto(BASE);
  await page.setInputFiles(
    ".drop input",
    ["a.jpg", "b.jpg"].map((name) => ({
      name,
      mimeType: "image/jpeg",
      buffer: readFileSync(fixture("gps.jpg")),
    })),
  );
  await expect(page.locator(".photo")).toHaveCount(2);
  await expect(page.locator(".batch .lead")).toHaveText(
    "Both photos carry the exact place they were taken.",
  );
});

test("three photos: one zip of three clean copies", async ({ page }) => {
  await page.goto(BASE);
  await page.setInputFiles(".drop input", [
    fixture("gps.jpg"),
    fixture("rotated.jpg"),
    fixture("meta.webp"),
  ]);
  await expect(page.locator(".photo")).toHaveCount(3);
  await expect(page.locator(".download")).toHaveCount(1);
  await expect(page.locator(".download")).toHaveText(
    "Download 3 clean copies as one .zip",
  );
  // What they give away together comes first, then the action, then
  // the list. The first line is the heading under the label.
  await expect(page.locator(".batch > *")).toHaveText([
    "2 of 3 photos carry the exact place they were taken.",
    "3 of them give away other details, listed below.",
  ]);
  await expect(page.locator(".batch h3")).toHaveText(
    "2 of 3 photos carry the exact place they were taken.",
  );
  expect(
    await page
      .locator(".answer")
      .evaluate((a) => [...a.children].map((c) => c.className)),
  ).toEqual(["batch", "get get-all", "kept", "photos"]);
  const file = await downloaded(page, () => page.click(".download"));
  expect(file.name).toBe("photos-clean.zip");
  const entries = unzipSync(file.bytes);
  expect(Object.keys(entries).sort()).toEqual([
    "gps-clean.jpg",
    "meta-clean.webp",
    "rotated-clean.jpg",
  ]);
  for (const bytes of Object.values(entries)) {
    expect(Buffer.from(bytes).toString("latin1")).not.toContain("Example");
  }
  expect(
    await exifr.orientation(entries["rotated-clean.jpg"] ?? new Uint8Array()),
  ).toBe(6);
});

test("an iPhone HEIC: what it gives away, and a clean copy", async ({
  page,
}) => {
  await page.goto(BASE);
  await page.setInputFiles(".drop input", {
    name: "IMG_0042.HEIC",
    mimeType: "image/heic",
    buffer: readFileSync(fixture("iphone.heic")),
  });
  await expect(page.locator(".photo .lead")).toHaveText(GPS);
  // This Chromium has no HEVC decoder: the reason takes the picture's place.
  await expect(page.locator(".photo .heic")).toHaveText(
    "This browser can’t show this HEIC photo, so there’s no preview here.",
  );
  await expect(page.locator(".photo canvas")).toHaveCount(0);
  // An empty frame no bigger than a thumbnail, the reason under it.
  const frame = await page.locator(".photo .thumb-none").boundingBox();
  const reason = await page.locator(".photo .heic").boundingBox();
  expect(frame?.width).toBeLessThanOrEqual(192);
  expect(reason?.y).toBeGreaterThanOrEqual(
    (frame?.y ?? 0) + (frame?.height ?? 0),
  );
  const file = await downloaded(page, () => page.click(".download"));
  expect(file.name).toBe("IMG_0042-clean.HEIC");
  expect(file.bytes.length).toBe(readFileSync(fixture("iphone.heic")).length);
  const text = Buffer.from(file.bytes).toString("latin1");
  for (const value of ["Test Person", "Cam 1", "2026:10:01"]) {
    expect(text).not.toContain(value);
  }
});

// Stands in for the browser's HEVC decoder, which this Chromium lacks:
// each tile comes out as a frame of one colour, chosen by the tile's
// number (its data's fifth byte), and every codec string asked about is
// kept.
function fakeDecoder() {
  const w = window as unknown as { asked: string[] };
  w.asked = [];
  const COLOURS = ["#888", "#f00", "#0f0", "#00f", "#ff0"];
  class FakeDecoder {
    state = "unconfigured";
    decodeQueueSize = 0;
    size = { w: 1, h: 1 };
    output: (frame: VideoFrame) => void;
    constructor(init: VideoDecoderInit) {
      this.output = init.output;
    }
    static isConfigSupported(config: VideoDecoderConfig) {
      w.asked.push(config.codec);
      return Promise.resolve({ supported: true, config });
    }
    configure(config: VideoDecoderConfig) {
      this.size = { w: config.codedWidth ?? 1, h: config.codedHeight ?? 1 };
      this.state = "configured";
    }
    decode(chunk: EncodedVideoChunk) {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const canvas = new OffscreenCanvas(this.size.w, this.size.h);
      const g = canvas.getContext("2d");
      if (!g) return;
      g.fillStyle = COLOURS[data[4] ?? 0] ?? "#888";
      g.fillRect(0, 0, this.size.w, this.size.h);
      const frame = new VideoFrame(canvas, { timestamp: chunk.timestamp });
      setTimeout(() => this.output(frame));
    }
    flush() {
      return new Promise((go) => setTimeout(go, 20));
    }
    close() {
      this.state = "closed";
    }
    addEventListener() {}
  }
  Object.assign(window, { VideoDecoder: FakeDecoder });
}

test("a HEIC this browser can't show itself: drawn by its video decoder, turned, then sharpened", async ({
  page,
}) => {
  const errors = consoleErrors(page);
  await page.addInitScript(fakeDecoder);
  await page.goto(BASE);
  // A 2 × 2 grid of 40 × 30 tiles, stored a quarter turn clockwise (as an
  // iPhone held upright stores it), and its thumbnail, all grey.
  await page.setInputFiles(".drop input", {
    name: "IMG_0043.HEIC",
    mimeType: "image/heic",
    buffer: Buffer.from(
      picture({
        rows: 2,
        columns: 2,
        tile: [40, 30],
        turn: 3,
        thumbnail: [40, 30],
      }),
    ),
  });
  const canvas = page.locator(".photo canvas.thumb");
  await expect(canvas).toBeVisible();
  await expect(page.locator(".photo .heic")).toHaveCount(0);
  expect(
    await canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height]),
  ).toEqual([60, 80]);
  // The row has settled from its arrival (shared/arrive.ts) before the
  // thumbnail's place is taken, so the rise isn't read as a shift.
  await canvas.evaluate((c) =>
    Promise.all(
      c
        .closest(".photo")
        ?.getAnimations()
        .map((a) => a.finished) ?? [],
    ),
  );
  const box = await canvas.boundingBox();

  // Each tile's colour, read at the middle of each quarter of the canvas.
  const quarters = () =>
    canvas.evaluate((c: HTMLCanvasElement) => {
      const g = c.getContext("2d");
      const name = (x: number, y: number) => {
        const [r = 0, gr = 0, b = 0] =
          g?.getImageData(x, y, 1, 1, { colorSpace: "srgb" }).data ?? [];
        const hi = (v: number) => v > 160;
        if (hi(r) && hi(gr) && !hi(b)) return "yellow";
        if (hi(r) && !hi(gr) && !hi(b)) return "red";
        if (!hi(r) && hi(gr) && !hi(b)) return "green";
        if (!hi(r) && !hi(gr) && hi(b)) return "blue";
        return "grey";
      };
      return [name(15, 20), name(45, 20), name(15, 60), name(45, 60)];
    });
  // The full picture replaces the thumbnail: turned, the top-left tile
  // (red) is at the top right, and so on round.
  await expect.poll(quarters).toEqual(["blue", "red", "yellow", "green"]);
  expect(await canvas.boundingBox()).toEqual(box);
  const asked = await page.evaluate(
    () => (window as unknown as { asked: string[] }).asked,
  );
  expect(asked).toContain("hvc1.3.E.L90.B0");
  expect(asked).toContain("hvc1.3.E.L93.B0");
  expect(errors).toEqual([]);
});

test("not a photo", async ({ page }) => {
  await page.goto(BASE);
  await page.setInputFiles(".drop input", fixture("note.txt"));
  await expect(page.locator(".photo .lead")).toHaveText(
    "This isn’t a photo this page can read. It reads JPEG, PNG, WebP and HEIC.",
  );
  await expect(page.locator(".download")).toHaveCount(0);
});

test(
  "twenty at once, one of them damaged: every one answers, none blocks",
  { tag: "@perf" },
  async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { longest: number };
      w.longest = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          w.longest = Math.max(w.longest, entry.duration);
      }).observe({ type: "longtask", buffered: true });
    });
    await page.goto(BASE);
    const names = [
      "gps.jpg",
      "rotated.jpg",
      "clean.jpg",
      "xmp-gps.jpg",
      "meta.png",
      "meta.webp",
    ];
    const files = Array.from({ length: 19 }, (_, i) => {
      const name = names[i % names.length] ?? "gps.jpg";
      return {
        name: `${i + 1}-${name}`,
        mimeType: "application/octet-stream",
        buffer: readFileSync(fixture(name)),
      };
    });
    files.splice(7, 0, {
      name: "damaged.jpg",
      mimeType: "image/jpeg",
      buffer: readFileSync(fixture("damaged.jpg")),
    });
    // The longest task counts from here, not from the page's own load.
    await page.evaluate(() => {
      (window as unknown as { longest: number }).longest = 0;
    });
    await page.setInputFiles(".drop input", files);
    await expect(page.locator(".photo")).toHaveCount(20);
    await expect(page.locator(".download")).toHaveText(
      "Download 19 clean copies as one .zip",
    );
    const damaged = page.locator(".photo").nth(7);
    await expect(damaged.locator(".lead")).toHaveText(
      "This page couldn’t read this photo’s details.",
    );
    await expect(damaged.locator(".line")).toHaveText(copy.damaged);
    await expect(damaged.locator(".num")).toHaveText("22 bytes");
    await expect(page.locator(".batch .line").last()).toHaveText(
      "1 file has no clean copy; its row says why.",
    );
    const longest = await page.evaluate(
      () => (window as unknown as { longest: number }).longest,
    );
    expect(longest).toBeLessThanOrEqual(200);
  },
);

test(
  "a full-size camera photo: read and cleaned with no task over 200 ms",
  { tag: "@perf" },
  async ({ page }) => {
    // A 48-megapixel JPEG, as a phone's main camera saves at full size,
    // with Exif naming the camera: made here, by sharp, from noise, so it
    // compresses about as little as a real photo.
    const [width, height] = [8000, 6000];
    const buffer = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 120, g: 140, b: 160 },
        noise: { type: "gaussian", mean: 128, sigma: 12 },
      },
    })
      .withExif({ IFD0: { Make: "Example", Model: "Phone 15" } })
      .jpeg({ quality: 90 })
      .toBuffer();
    await page.addInitScript(() => {
      const w = window as unknown as { tasks: number[] };
      w.tasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.tasks.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
    });
    await page.goto(BASE);
    await page.evaluate(() => {
      (window as unknown as { tasks: number[] }).tasks = [];
    });
    // From the disk, as a person's photo comes: handed over as bytes,
    // Playwright would build the file in the page, one long task of its
    // own.
    const path = test.info().outputPath("big.jpg");
    writeFileSync(path, buffer);
    await page.setInputFiles(".drop input", path);
    await expect(page.locator(".download")).toBeVisible({ timeout: 60_000 });
    const tasks = await page.evaluate(
      () => (window as unknown as { tasks: number[] }).tasks,
    );
    const longest = Math.max(0, ...tasks);
    test.info().annotations.push({
      type: "long tasks",
      description: `${(buffer.length / 1024 / 1024).toFixed(1)} MB JPEG: ${tasks.map((t) => Math.round(t)).join(", ")} ms`,
    });
    expect(longest).toBeLessThanOrEqual(200);
  },
);

test("an example photo, labelled, drawn by the same code, never announced", async ({
  page,
}) => {
  const errors = consoleErrors(page);
  const scripts: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "script") scripts.push(r.url());
  });
  await page.goto(BASE);
  const example = page.getByRole("region", { name: copy.example });
  await expect(example).toBeVisible();
  await expect(example.locator("h2")).toHaveText(copy.example);
  await expect(example.getByRole("heading", { level: 3 })).toHaveText(GPS);
  await expect(example.locator(".line")).toHaveText([
    "It names the camera that took it: Example Phone 1.",
    "It records when it was taken: Oct 1, 2026, 18:42.",
    "It names a person: Your Name.",
  ]);
  await expect(example.locator("img.thumb")).toHaveJSProperty("complete", true);
  await expect(example.locator(".download")).toHaveCount(0);
  await expect(page.locator("[data-status]")).toHaveText("");
  await page.waitForLoadState("networkidle");
  // Its details were read when the page was built: the reader's library
  // isn't loaded for it.
  expect(scripts.filter((url) => /full\.esm/.test(url))).toEqual([]);
  expect(errors).toEqual([]);

  await page.setInputFiles(".drop input", fixture("gps.jpg"));
  await expect(page.locator(".answer .photo .lead")).toHaveText(GPS);
  // A heading one level under the pane’s label, as in the example.
  await expect(
    page.locator(".pane.yours").getByRole("heading", { level: 3 }),
  ).toHaveText(GPS);
  await expect(example).toHaveCount(0);
  await expect(page.locator("[data-status]")).toHaveText(GPS);
  expect(errors).toEqual([]);
});

test("without JavaScript there's no example", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(BASE);
  await expect(page.locator(".example")).toBeHidden();
  await context.close();
});

// One column with the picture beside the text: where the space held for
// the example steps down.
const ONE_COLUMN = [
  { width: 534, height: 900 },
  { width: 560, height: 900 },
  { width: 748, height: 1000 },
  { width: 800, height: 1100 },
  { width: 860, height: 1000 },
];

test("the example arrives without moving anything", async ({ browser }) => {
  for (const viewport of [...SIZES, ...ONE_COLUMN]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const shift = await layoutShift(page, BASE, ".example .lead");
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

test("the example is in the page itself: no script draws it, no space is held", async ({
  page,
}) => {
  const html = await (await page.request.get(BASE)).text();
  expect(html).toContain('<h3 class="lead">This photo carries the exact place');
  // The picture is a file of the build's, never a script's bytes.
  expect(html).toMatch(
    /<img class="thumb" alt="" src="\/assets\/example-[\w-]+\.jpg"/,
  );
  await page.goto(BASE);
  expect(
    await page
      .locator(".example")
      .evaluate((e) => getComputedStyle(e).minHeight),
  ).toBe("0px");
  // Show everything opens without a script too.
  const summary = page.locator(".example .all summary");
  await summary.click();
  await expect(summary).toHaveText(copy.hide, { useInnerText: true });
});

test("several photos: the action stays in reach on a phone, and the list doesn't move when the lines arrive", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const w = window as unknown as { shifts: string[] };
    w.shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        sources: { node?: Node }[];
      }[]) {
        for (const s of entry.sources) {
          const node = s.node as Element | undefined;
          // Only the answer: the drop zone steps back to one line once
          // there's an answer (shared/dropzone.css), and the footer moves
          // down as rows arrive below the fold.
          if (node?.parentElement?.closest(".answer")) {
            w.shifts.push(`${node.nodeName}.${node.className} ${entry.value}`);
          }
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(BASE);
  const names = [
    "gps.jpg",
    "rotated.jpg",
    "clean.jpg",
    "meta.png",
    "meta.webp",
  ];
  await page.setInputFiles(
    ".drop input",
    [...names, ...names].map((name, i) => ({
      name: `${i}-${name}`,
      mimeType: "application/octet-stream",
      buffer: readFileSync(fixture(name)),
    })),
  );
  await expect(page.locator(".get-all .download")).toHaveText(
    "Download 10 clean copies as one .zip",
  );
  await expect(page.locator(".batch .lead")).toHaveText(
    "6 of 10 photos carry the exact place they were taken.",
  );
  // What they say together is the heading under the label; each photo's
  // own verdict is one under it.
  const yours = page.locator(".pane.yours");
  await expect(yours.getByRole("heading", { level: 3 })).toHaveText(
    "6 of 10 photos carry the exact place they were taken.",
  );
  await expect(yours.getByRole("heading", { level: 4 })).toHaveCount(10);
  // The batch's lines arrived above the list without moving it.
  expect(
    await page.evaluate(
      () => (window as unknown as { shifts: string[] }).shifts,
    ),
  ).toEqual([]);
  // Scrolled to the last photo, the action is still on screen.
  await page.locator(".photo").last().scrollIntoViewIfNeeded();
  const button = await page.locator(".get-all .download").boundingBox();
  expect(button?.y).toBeGreaterThanOrEqual(0);
  expect((button?.y ?? 0) + (button?.height ?? 0)).toBeLessThanOrEqual(844);
  await context.close();
});

test("a JPEG cut short: still read, still cleaned; a broken one says why it has no copy", async ({
  page,
}) => {
  await page.goto(BASE);
  const whole = readFileSync(fixture("gps.jpg"));
  await page.setInputFiles(".drop input", [
    {
      name: "cut.jpg",
      mimeType: "image/jpeg",
      buffer: whole.subarray(0, whole.length - 200),
    },
    {
      name: "note.txt",
      mimeType: "text/plain",
      buffer: readFileSync(fixture("note.txt")),
    },
  ]);
  const cut = page.locator(".photo").first();
  await expect(cut.locator(".lead")).toHaveText(GPS);
  await expect(page.locator(".download")).toHaveText(copy.cleanOne);
  const file = await downloaded(page, () => page.click(".download"));
  expect(file.name).toBe("cut-clean.jpg");
  expect(Array.from(file.bytes.subarray(-2))).toEqual([0xff, 0xd9]);
  expect(Buffer.from(file.bytes).toString("latin1")).not.toContain(
    "Test Person",
  );
  // Sizes under a kilobyte, in bytes.
  await expect(page.locator(".photo").nth(1).locator(".num")).toHaveText(
    "13 bytes",
  );
});

test("the answer reads first, under its column's label; the picture sits beside it, its own shape", async ({
  browser,
}) => {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(BASE);
    // A portrait photo, drawn here: 3 × 4, upright.
    const portrait = await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(600, 800);
      const g = canvas.getContext("2d");
      if (!g) throw new Error("no 2d");
      g.fillStyle = "#678";
      g.fillRect(0, 0, 600, 800);
      const blob = await canvas.convertToBlob({ type: "image/jpeg" });
      return [...new Uint8Array(await blob.arrayBuffer())];
    });
    await page.setInputFiles(".drop input", {
      name: "portrait.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from(portrait),
    });
    const row = page.locator(".answer .photo");
    await expect(row.locator(".download")).toBeVisible();
    // The row rises into place as it arrives: measure it once it's there.
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished)),
    );
    // The verdict, then the picture with its name: the order it reads in.
    expect(
      await row.evaluate((r) => [...r.children].map((c) => c.className)),
    ).toEqual(["what", "who"]);
    const box = async (selector: string) => {
      const b = await page.locator(selector).first().boundingBox();
      if (!b) throw new Error(`${selector} isn't drawn`);
      return b;
    };
    // The answer's column (shared/work.css), labelled with the name.
    await expect(page.locator("#yours-label")).toHaveText("portrait.jpg");
    const label = await box("#yours-label");
    const drop = await box(".drop");
    const what = await box(".answer .what");
    const picture = await box(".answer .who .thumb");
    const file = await box(".answer .who .file");
    const at = `${width}`;
    expect(picture.width / picture.height, at).toBeCloseTo(0.75, 2);
    expect(what.x, at).toBeCloseTo(label.x, 0);
    expect(what.y, at).toBeGreaterThan(label.y + label.height);
    expect(file.x, at).toBeCloseTo(picture.x, 0);
    expect(file.y, at).toBeGreaterThan(picture.y + picture.height - 1);
    if (width > 860) {
      // Side by side: the picture starts its column, level with the
      // verdict, and the drop zone stays in the verdict's column.
      expect(picture.x, at).toBeGreaterThan(what.x + what.width);
      expect(picture.y, at).toBeCloseTo(what.y, 0);
      expect(drop.x + drop.width, at).toBeLessThanOrEqual(picture.x);
    } else {
      // One column: the verdict, then the picture under it.
      expect(picture.x, at).toBeCloseTo(what.x, 0);
      expect(picture.y, at).toBeGreaterThanOrEqual(what.y + what.height);
    }
    await context.close();
  }
});

test("a drop with a file that isn't a photo counts only the photos", async ({
  page,
}) => {
  await page.goto(BASE);
  await page.setInputFiles(".drop input", [
    fixture("gps.jpg"),
    fixture("clean.jpg"),
    fixture("meta.png"),
    fixture("rotated.jpg"),
    fixture("note.txt"),
  ]);
  await expect(page.locator(".photo")).toHaveCount(5);
  await expect(page.locator("#yours-label")).toHaveText("4 photos");
  await expect(page.locator(".batch .lead")).toHaveText(
    "2 of 4 photos carry the exact place they were taken.",
  );
  // The file that isn't a photo still says why it has no clean copy.
  await expect(page.locator(".batch .line").last()).toHaveText(
    "1 file has no clean copy; its row says why.",
  );
  // One photo and a note: one photo.
  await page.setInputFiles(".drop input", [
    fixture("gps.jpg"),
    fixture("note.txt"),
  ]);
  await expect(page.locator("#yours-label")).toHaveText("1 photo");
});

/** Each file's size as this browser draws it, turn applied, and its
 * pixels drawn on a canvas, colour profile applied. */
async function drawn(page: Page, files: Record<string, Uint8Array>) {
  const sent = Object.entries(files).map(
    ([name, b]) => [name, Buffer.from(b).toString("base64")] as const,
  );
  return page.evaluate(async (list) => {
    const out: Record<string, { size: string; pixels: number[] }> = {};
    for (const [name, b64] of list) {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes]));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      context?.drawImage(bitmap, 0, 0);
      const data = context?.getImageData(0, 0, bitmap.width, bitmap.height);
      out[name] = {
        size: `${bitmap.width}x${bitmap.height}`,
        pixels: Array.from(data?.data ?? []),
      };
    }
    return out;
  }, sent);
}

/** Drops the files, and gives back each clean copy by its name. */
async function cleaned(page: Page, files: Record<string, Uint8Array>) {
  await page.goto(BASE);
  await page.setInputFiles(
    ".drop input",
    Object.entries(files).map(([name, b]) => ({
      name,
      mimeType: "application/octet-stream",
      buffer: Buffer.from(b),
    })),
  );
  await expect(page.locator(".photo")).toHaveCount(Object.keys(files).length);
  const zip = await downloaded(page, () => page.click(".download"));
  const entries = unzipSync(zip.bytes);
  const out: Record<string, Uint8Array> = {};
  for (const name of Object.keys(files)) {
    const dot = name.lastIndexOf(".");
    const copied = entries[`${name.slice(0, dot)}-clean${name.slice(dot)}`];
    if (!copied) throw new Error(`no clean copy of ${name}`);
    out[name] = copied;
  }
  return out;
}

test("a clean copy is shown the same way up as the photo", async ({ page }) => {
  // A TIFF holding only Orientation 6, as a SHORT or (not read) a LONG.
  const tiff = (long = false) => [
    ...[0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, long ? 4 : 3],
    ...[0, 0, 0, 1, ...(long ? [0, 0, 0, 6] : [0, 6, 0, 0]), 0, 0, 0, 0],
  ];
  const xmp = ascii(
    `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:tiff="http://ns.adobe.com/tiff/1.0/" tiff:Orientation="6"/></rdf:RDF></x:xmpmeta>`,
  );
  const exif = (long = false) =>
    segment(0xe1, [...ascii("Exif\0\0"), ...tiff(long)]);
  const jpg = new Uint8Array(await image().jpeg().toBuffer());
  const png = new Uint8Array(await image().png().toBuffer());
  const jpeg = (head: number[], tail: number[] = []) =>
    new Uint8Array([
      ...jpg.subarray(0, 2),
      ...head,
      ...jpg.subarray(2, -2),
      ...tail,
      0xff,
      0xd9,
    ]);
  const ihdr = 33;
  const withChunks = (head: number[], tail: number[] = []) =>
    new Uint8Array([
      ...png.subarray(0, ihdr),
      ...head,
      ...png.subarray(ihdr, -12),
      ...tail,
      ...png.subarray(-12),
    ]);
  const files = {
    "exif-turn.jpg": jpeg(exif()),
    "xmp-turn.jpg": jpeg(
      segment(0xe1, [...ascii("http://ns.adobe.com/xap/1.0/\0"), ...xmp]),
    ),
    "late-exif.jpg": jpeg([], exif()),
    "long-turn.jpg": jpeg(exif(true)),
    "exif-turn.png": withChunks(pngChunk("eXIf", tiff())),
    "xmp-turn.png": withChunks(
      pngChunk("iTXt", [...ascii("XML:com.adobe.xmp\0"), 0, 0, 0, 0, ...xmp]),
    ),
    "late-exif.png": withChunks([], pngChunk("eXIf", tiff())),
  };
  const out = await cleaned(page, files);
  const before = await drawn(page, files);
  const after = await drawn(page, out);
  for (const name of Object.keys(files)) {
    expect(after[name]?.size, name).toBe(before[name]?.size);
  }
  // The turned ones really are turned, so the check means something.
  expect(before["exif-turn.jpg"]?.size).toBe("48x64");
  expect(before["exif-turn.png"]?.size).toBe("48x64");
});

test("a clean copy's colours are drawn exactly as the photo's", async ({
  page,
}) => {
  const profile = await crafted();
  const jpg = new Uint8Array(await image().jpeg().toBuffer());
  const png = new Uint8Array(await image().png().toBuffer());
  const webp = new Uint8Array(await image().webp().toBuffer());
  const files = {
    "p3.jpg": new Uint8Array([
      ...jpg.subarray(0, 2),
      ...segment(0xe2, [...ascii("ICC_PROFILE\0"), 1, 1, ...profile]),
      ...jpg.subarray(2),
    ]),
    "p3.png": new Uint8Array([
      ...png.subarray(0, 33),
      ...pngChunk("iCCP", [
        ...ascii("LEAK-NAME\0"),
        0,
        ...deflateSync(profile),
      ]),
      ...png.subarray(33),
    ]),
    "p3.webp": new Uint8Array(
      riff([
        ...webpChunk("VP8X", [0x20, 0, 0, 0, 63, 0, 0, 47, 0, 0]),
        ...webpChunk("ICCP", profile),
        ...webp.subarray(12),
      ]),
    ),
  };
  const out = await cleaned(page, files);
  const before = await drawn(page, files);
  const after = await drawn(page, out);
  const plain = await drawn(page, { "p3.jpg": jpg });
  // The profile changes how the picture is drawn here.
  expect(before["p3.jpg"]?.pixels).not.toEqual(plain["p3.jpg"]?.pixels);
  for (const name of Object.keys(files)) {
    expect(LEAKS(out[name] ?? new Uint8Array()), name).toBe(false);
    expect(after[name]?.pixels, name).toEqual(before[name]?.pixels);
  }
});

test("a long unbroken key or value wraps: no sideways scroll at 390, and every value keeps its room at 1440", async ({
  browser,
}) => {
  const base = new Uint8Array(await image().png().toBuffer());
  // A PNG's header chunk always ends 33 bytes in.
  const text = (key: string, value: string) =>
    pngChunk("tEXt", ascii(`${key}\0${value}`));
  const buffer = Buffer.from([
    ...base.subarray(0, 33),
    ...text(
      "Description",
      "https://example.com/a/very/long/path/without/any/spaces/that/must/break/somewhere/abcdefghijklmnopqrstuvwxyz0123456789",
    ),
    ...text(
      "AVeryLongTextKeywordThatGoesOnAndOnWithoutSpacesToTestLabelWidthX",
      "short",
    ),
    ...base.subarray(33),
  ]);
  for (const width of [390, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(BASE);
    await page.setInputFiles(".drop input", {
      name: "long-text.png",
      mimeType: "image/png",
      buffer,
    });
    await page.locator(".all summary").first().click();
    const short = page.locator(".all dd", { hasText: /^short$/ });
    await expect(short).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
      `sideways scroll at ${width}`,
    ).toBe(0);
    // Every value keeps its room: none is cut short inside its box, and
    // none runs into its name (beside it, or over it on a phone).
    const rows = await page
      .locator(".all")
      .first()
      .locator("dl > div")
      .evaluateAll((divs) =>
        divs.map((div) => {
          const [dt, dd] = [div.firstElementChild, div.lastElementChild];
          if (!dt || !dd) return { name: "", clipped: true, overlap: true };
          const a = dt.getBoundingClientRect();
          const b = dd.getBoundingClientRect();
          return {
            name: dt.textContent ?? "",
            clipped:
              b.width === 0 ||
              dd.scrollWidth > dd.clientWidth ||
              dt.scrollWidth > dt.clientWidth,
            overlap:
              a.left < b.right - 0.5 &&
              b.left < a.right - 0.5 &&
              a.top < b.bottom - 0.5 &&
              b.top < a.bottom - 0.5,
          };
        }),
      );
    expect(rows.length, `rows at ${width}`).toBe(2);
    for (const row of rows) {
      expect(row.clipped, `${row.name} cut short at ${width}`).toBe(false);
      expect(row.overlap, `${row.name} over its value at ${width}`).toBe(false);
    }
    await context.close();
  }
});

// Between the widths where the shared list drops its leaders and where
// this one does (photo.css, 18.5rem), each field's name stands over its
// value with no leader. Checked again with the shared rule made as strong
// as it once was, so the list holds whatever its weight.
test("where the fields' list is narrow, each name stands over its value, with no leader", async ({
  browser,
}) => {
  for (const width of [630, 1160]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      bypassCSP: true,
    });
    const page = await context.newPage();
    await page.goto(BASE);
    await page.setInputFiles(".drop input", fixture("gps.jpg"));
    await page.locator(".all summary").first().click();
    const labels = () =>
      page
        .locator(".all dt")
        .evaluateAll((dts) =>
          dts.map(
            (dt) =>
              `${getComputedStyle(dt).display} ${getComputedStyle(dt, "::after").display}`,
          ),
        );
    const listWidth = await page
      .locator(".all dl")
      .first()
      .evaluate((dl) => dl.getBoundingClientRect().width);
    expect(listWidth, `list width at ${width}`).toBeLessThan(18.5 * 16);
    expect(listWidth, `list width at ${width}`).toBeGreaterThan(16.5 * 16);
    const plain = await labels();
    expect(plain.length).toBeGreaterThan(2);
    expect(new Set(plain), `at ${width}`).toEqual(new Set(["block none"]));
    await page.addStyleTag({
      content:
        ".leaders > * > :first-child { display: flex } .leaders > * > :first-child::after { display: block }",
    });
    expect(new Set(await labels()), `at ${width}, strong`).toEqual(
      new Set(["block none"]),
    );
    await context.close();
  }
});

test("a file over 100 MB is said so in its own row, and not read", async ({
  page,
}) => {
  await page.goto(BASE);
  // Made in the page: the file only has to be that big.
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(".drop input");
    if (!input) return;
    const files = new DataTransfer();
    files.items.add(
      new File([new Uint8Array(100 * 1024 * 1024 + 1)], "huge.jpg", {
        type: "image/jpeg",
      }),
    );
    input.files = files.files;
    input.dispatchEvent(new Event("change"));
  });
  const row = page.locator(".photo");
  await expect(row.locator(".lead")).toHaveText(
    "This file is too big for this page to read. It reads photos up to 100 MB.",
  );
  await expect(row.locator(".num")).toHaveText("100.0 MB");
  await expect(row.locator(".thumb")).toHaveCount(0);
  await expect(page.locator(".download")).toHaveCount(0);
  await expect(page.locator("[data-status]")).toHaveText(
    "This file is too big for this page to read. It reads photos up to 100 MB.",
  );
});

test("a reader that doesn't load: the page reloads once for the current one, then says so, and the next drop tries again", async ({
  page,
}) => {
  const errors = consoleErrors(page);
  let fail = true;
  await page.route("**/assets/answer-*.js", (route) =>
    fail ? route.abort() : route.continue(),
  );
  await page.goto(BASE);
  // The first failure reloads the page.
  await Promise.all([
    page.waitForEvent("load"),
    page.setInputFiles(".drop input", fixture("gps.jpg")),
  ]);
  expect(
    await page.evaluate(() => sessionStorage.getItem("stale-reload")),
  ).toBe("1");
  // After that, a failure is said, in the answer's place.
  await page.setInputFiles(".drop input", fixture("gps.jpg"));
  await expect(page.locator(".answer .wrong")).toHaveText(copy.wrong);
  await expect(page.locator("#yours-label")).toHaveText(copy.fileLabel);
  await expect(page.locator("[data-status]")).toHaveText(copy.wrong);
  // Once the file is there again, the next drop reads.
  fail = false;
  await page.setInputFiles(".drop input", fixture("gps.jpg"));
  await expect(page.locator(".photo .lead")).toHaveText(GPS);
  await expect(page.locator(".answer .wrong")).toHaveCount(0);
  expect(errors.filter((e) => !/^Failed to load resource/.test(e))).toEqual([]);
});
