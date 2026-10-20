import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { shellHtml } from "../shell";
import { cspFor, type ExperimentOptions } from "../vite";

const min: ExperimentOptions = {
  name: "x",
  title: "X",
  description: "X.",
  port: 4400,
};

describe("cspFor", () => {
  test("csp has connect-src none by default", () => {
    expect(cspFor({ ...min }, "x")).toContain("connect-src 'none'");
  });

  test("csp lists given hosts", () => {
    const csp = cspFor(
      { ...min, connectSrc: ["https://cloudflare-dns.com"] },
      "x",
    );
    expect(csp).toContain("connect-src https://cloudflare-dns.com");
    expect(csp).not.toContain("connect-src 'none'");
  });

  test("csp allows workers from the page's own files only", () => {
    const csp = cspFor({ ...min }, "x");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).not.toMatch(/worker-src[^;]*blob:/);
  });

  test("csp allows no plugins", () => {
    expect(cspFor({ ...min }, "x")).toContain("object-src 'none'");
  });
});

describe("shellHtml", () => {
  const source = "https://github.com/candygoogy/experiments/tree/main/x";

  test("the title is the name, then the site, as on candygoogy.dev", () => {
    expect(shellHtml({ ...min, source }).head).toContain(
      "<title>X – candygoogy</title>",
    );
    expect(shellHtml({ ...min, title: "Tom & Jerry", source }).head).toContain(
      "<title>Tom &amp; Jerry – candygoogy</title>",
    );
  });

  test("the header starts with the site's skip link, to the tool", () => {
    const { header } = shellHtml({ ...min, source });
    expect(
      header.startsWith('<a class="skip" href="#tool">Skip to content</a>'),
    ).toBe(true);
    expect(header.indexOf('class="skip"')).toBeLessThan(
      header.indexOf('class="brand"'),
    );
  });

  // Only the claim links to how to check it, as on the site.
  const proof = '<a href="https://candygoogy.dev/colophon#privacy">';

  test("footer has the default privacy line, its claim linked", () => {
    expect(shellHtml({ ...min, source }).footer).toContain(
      `<p class="privacy">Runs in your browser. ${proof}Nothing you drop here is uploaded.</a></p>`,
    );
  });

  test("footer has the experiment's own privacy line when given, its claim linked", () => {
    const line = "Runs in your browser. Nothing you type here leaves it.";
    const footer = shellHtml({ ...min, source, privacy: line }).footer;
    expect(footer).toContain(
      `<p class="privacy">Runs in your browser. ${proof}Nothing you type here leaves it.</a></p>`,
    );
    expect(footer).not.toContain("Nothing you drop here");
  });

  test("a privacy line of one sentence is linked whole, escaped", () => {
    const line = "Nothing <here> & nothing sent.";
    expect(shellHtml({ ...min, source, privacy: line }).footer).toContain(
      `<p class="privacy">${proof}Nothing &lt;here&gt; &amp; nothing sent.</a></p>`,
    );
  });
});

describe("defineExperiment build", () => {
  const root = join(import.meta.dirname, "fixture");
  let out = "";
  let html = "";
  let headers = "";

  beforeAll(async () => {
    out = mkdtempSync(join(tmpdir(), "exp-vite-"));
    await build({
      root,
      configFile: join(root, "vite.config.ts"),
      logLevel: "silent",
      build: { outDir: out, emptyOutDir: true },
    });
    html = readFileSync(join(out, "index.html"), "utf8");
    headers = readFileSync(join(out, "_headers"), "utf8");
  });

  afterAll(() => {
    rmSync(out, { recursive: true, force: true });
  });

  test("csp hash matches the inlined script", () => {
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    expect(inline).toHaveLength(1);
    const hash = createHash("sha256")
      .update(inline[0]?.[1] ?? "")
      .digest("base64");
    expect(headers).toContain(`'sha256-${hash}'`);
  });

  test("the headers ask for nothing the tools don't use", () => {
    const block = headers.split("\n\n")[0] ?? "";
    expect(block).toContain(
      "Permissions-Policy: camera=(), microphone=(), geolocation=()",
    );
    expect(block).toContain("Cross-Origin-Opener-Policy: same-origin");
    expect(block).toContain("Strict-Transport-Security: max-age=31536000");
    expect(block).not.toContain("includeSubDomains");
  });

  test("the site's icons ship with every build, linked from the head", () => {
    for (const icon of ["favicon.ico", "apple-touch-icon.png"]) {
      const shipped = readFileSync(join(out, icon));
      const source = readFileSync(
        join(import.meta.dirname, "..", "public", icon),
      );
      expect(shipped.equals(source)).toBe(true);
    }
    expect(html).toContain(
      '<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />',
    );
    expect(html).toContain(
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
    );
    expect(html).not.toContain('href="data:,"');
  });

  test("shell markers are all replaced", () => {
    expect(html).not.toContain("<!-- shell:");
    expect(html).toContain("<title>Fixture – candygoogy</title>");
    expect(html).toContain('class="top');
    expect(html).toContain('<p class="privacy">Runs in your browser. <a ');
  });

  test("404.html is the shell, unindexed, with the way back to the tool", () => {
    const page = readFileSync(join(out, "404.html"), "utf8");
    expect(page).toContain('<header class="top wrap">');
    expect(page).toContain('<meta name="robots" content="noindex" />');
    expect(page).toContain("<title>Page not found – candygoogy</title>");
    expect(page).not.toContain('rel="canonical"');
    expect(page).toContain(
      '<h1 id="nf-title"><span class="rv-mask" data-d="260"><span>Page not found</span></span></h1>',
    );
    expect(page).toContain('<a href="/">Back to Fixture</a>');
    expect(page).toContain('<span class="nf-label">candygoogy.dev</span>');
    // Two scripts: the head's, whose hash the CSP has, and the 404's (the
    // header and the motion), a file of its own ('self'), importing nothing.
    expect(page.match(/<script/g)).toHaveLength(2);
    const inline = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    expect(inline).toHaveLength(1);
    const hash = createHash("sha256")
      .update(inline[0]?.[1] ?? "")
      .digest("base64");
    expect(headers).toContain(`'sha256-${hash}'`);
    const script =
      /<script type="module" crossorigin src="\/(assets\/notfound-[\w-]+\.js)"><\/script>/.exec(
        page,
      )?.[1] ?? "";
    const code = readFileSync(join(out, script), "utf8");
    expect(code).toContain("data-menu-open");
    expect(code).toContain("Tried it. Still a 404.");
    expect(code).not.toMatch(/\bimport\b/);
    // Its own stylesheet ships with it.
    const sheet = /href="\/(assets\/notfound-[\w-]+\.css)"/.exec(page)?.[1];
    expect(sheet && readFileSync(join(out, sheet), "utf8")).toContain(".nf-");
  });
});
