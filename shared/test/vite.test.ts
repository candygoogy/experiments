import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildStamp, type Build } from "../build";
import { notFoundHtml, shellHtml } from "../shell";
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

describe("buildStamp", () => {
  const ENV = "A".repeat(40);
  const GIT = "b".repeat(40);
  const at = new Date("2026-12-31T23:30:00Z");
  const fails = (message: string) => () => {
    throw new Error(message);
  };

  test("the date is the build's, in UTC", () => {
    const b = buildStamp(at, { env: ENV, git: fails("x"), status: fails("x") });
    expect(b).toMatchObject({
      year: 2026,
      iso: "2026-12-31",
      label: "Dec 31, 2026",
    });
  });

  test("Workers Builds' commit first, never marked dirty", () => {
    const b = buildStamp(at, {
      env: ` ${ENV}\n`,
      git: fails("unused"),
      status: () => " M x",
    });
    expect(b).toMatchObject({ commit: ENV.toLowerCase(), dirty: false });
  });

  test("then git's, marked dirty with uncommitted changes", () => {
    const git = () => `${GIT}\n`;
    expect(buildStamp(at, { env: "", git, status: () => "" })).toMatchObject({
      commit: GIT,
      dirty: false,
    });
    expect(
      buildStamp(at, {
        env: "main",
        git,
        status: () => " M shared/shell.ts\n",
      }),
    ).toMatchObject({ commit: GIT, dirty: true });
  });

  test("with no commit, just the date; the build goes on", () => {
    const b = buildStamp(at, {
      env: undefined,
      git: fails("not a git repository"),
      status: fails("x"),
    });
    expect(b.commit).toBeUndefined();
    expect(b.note).toContain("no commit");
  });
});

describe("shellHtml", () => {
  const source = "https://github.com/candygoogy/experiments/tree/main/x";
  const build: Build = {
    year: 2026,
    iso: "2026-10-23",
    label: "Oct 23, 2026",
    commit: "0123456789abcdef0123456789abcdef01234567",
    dirty: false,
    note: "",
  };

  // The stamp link's name holds the text it shows (axe's
  // label-content-name-mismatch), dirty or not.
  test("the stamp's link name holds its text, -dirty too", () => {
    const footer = (dirty: boolean) =>
      shellHtml({ ...min, source, build: { ...build, dirty } }).footer;
    expect(footer(false)).toContain('aria-label="commit 0123456">0123456</a>');
    expect(footer(true)).toContain(
      'aria-label="commit 0123456-dirty, with uncommitted changes">0123456-dirty</a>',
    );
  });

  test("the title is the name, then the site, as on candygoogy.dev", () => {
    expect(shellHtml({ ...min, source, build }).head).toContain(
      "<title>X – candygoogy</title>",
    );
    expect(
      shellHtml({ ...min, title: "Tom & Jerry", source, build }).head,
    ).toContain("<title>Tom &amp; Jerry – candygoogy</title>");
  });

  // The link preview, as candygoogy.dev's pages send it, in its order,
  // right after the canonical. The 404 keeps the tool's card but, as on
  // the site's 404, sends no address.
  test("the link-preview tags, in the site's order; the 404 has no og:url", () => {
    const o = {
      ...min,
      name: "mail",
      title: "Mail <check>",
      description: "Checks a domain. Then says what's missing.",
      source,
      build,
    };
    const preview = [
      '<link rel="canonical" href="https://mail.candygoogy.dev/" />',
      '<meta property="og:type" content="website" />',
      '<meta property="og:site_name" content="candygoogy" />',
      '<meta property="og:title" content="Mail &lt;check&gt; – candygoogy" />',
      `<meta property="og:description" content="Checks a domain. Then says what's missing." />`,
      '<meta property="og:url" content="https://mail.candygoogy.dev/" />',
      '<meta property="og:image" content="https://mail.candygoogy.dev/og.png" />',
      '<meta property="og:image:width" content="1200" />',
      '<meta property="og:image:height" content="630" />',
      '<meta property="og:image:alt" content="Mail &lt;check&gt;: Checks a domain." />',
      '<meta name="twitter:card" content="summary_large_image" />',
    ];
    const lines = shellHtml(o)
      .head.split("\n")
      .map((l) => l.trim());
    const at = lines.indexOf(preview[0] ?? "");
    expect(lines.slice(at, at + preview.length)).toEqual(preview);
    // A description of one sentence is the card's line as it is.
    expect(shellHtml({ ...o, description: "One line." }).head).toContain(
      '<meta property="og:image:alt" content="Mail &lt;check&gt;: One line." />',
    );
    // A card with its own line is described by that line.
    expect(shellHtml({ ...o, cardLine: "Short." }).head).toContain(
      '<meta property="og:image:alt" content="Mail &lt;check&gt;: Short." />',
    );

    const page = notFoundHtml(o, { css: [], fonts: [] });
    expect(page).not.toContain('property="og:url"');
    expect(page).not.toContain('rel="canonical"');
    const rest = preview.filter((l) => !/canonical|og:url/.test(l));
    rest[2] =
      '<meta property="og:title" content="Page not found – candygoogy" />';
    rest[3] =
      '<meta property="og:description" content="There’s nothing at this address." />';
    const notFound = page.split("\n").map((l) => l.trim());
    const from = notFound.indexOf(rest[0] ?? "");
    expect(notFound.slice(from, from + rest.length)).toEqual(rest);
  });

  test("the header starts with the site's skip link, to the tool", () => {
    const { header } = shellHtml({ ...min, source, build });
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
    expect(shellHtml({ ...min, source, build }).footer).toContain(
      `<span class="privacy">Runs in your browser. ${proof}Nothing you drop here is uploaded.</a></span>`,
    );
  });

  test("footer has the experiment's own privacy line when given, its claim linked", () => {
    const line = "Runs in your browser. Nothing you type here leaves it.";
    const footer = shellHtml({ ...min, source, build, privacy: line }).footer;
    expect(footer).toContain(
      `<span class="privacy">Runs in your browser. ${proof}Nothing you type here leaves it.</a></span>`,
    );
    expect(footer).not.toContain("Nothing you drop here");
  });

  test("a privacy line of one sentence is linked whole, escaped", () => {
    const line = "Nothing <here> & nothing sent.";
    expect(
      shellHtml({ ...min, source, build, privacy: line }).footer,
    ).toContain(
      `<span class="privacy">${proof}Nothing &lt;here&gt; &amp; nothing sent.</a></span>`,
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
    expect(html).toContain('<span class="privacy">Runs in your browser. <a ');
  });

  // As on the site: the notes (©, the privacy line, the build stamp), then
  // the links (Source, MIT), in the markup's order, so Tab follows it; the
  // stamp's commit links to this repository. The 404 has the same footer.
  test("the footer's slots, in order, the stamp linked to the repository", () => {
    const page = readFileSync(join(out, "404.html"), "utf8");
    for (const doc of [html, page]) {
      const footer = /<footer[\s\S]*?<\/footer>/.exec(doc)?.[0] ?? "";
      const slots = [
        `© ${new Date().getUTCFullYear()} candygoogy`,
        '<span class="privacy">Runs in your browser.',
        '<span class="stamp">Built <time datetime="',
        '">Source</a>',
        "<span>MIT</span>",
      ];
      const at = slots.map((s) => footer.indexOf(s));
      expect(
        at.every((i) => i !== -1),
        at.join(),
      ).toBe(true);
      expect(at).toEqual([...at].sort((a, b) => a - b));
      // The notes are one paragraph, the links after it.
      expect(footer.indexOf("</p>")).toBeLessThan(at[3] ?? 0);
      // Built from this checkout, so there is a commit to link.
      const stamp = /<span class="stamp">.*?<\/span>/.exec(footer)?.[0] ?? "";
      expect(stamp).toMatch(
        /^<span class="stamp">Built <time datetime="\d{4}-\d{2}-\d{2}">[A-Z][a-z]{2} \d{1,2}, \d{4}<\/time> from <a href="https:\/\/github\.com\/candygoogy\/experiments\/commit\/[0-9a-f]{40}" aria-label="commit ([0-9a-f]{7}|[0-9a-f]{7}-dirty, with uncommitted changes)">[0-9a-f]{7}(-dirty)?<\/a><\/span>$/,
      );
      expect(footer).toContain(
        'href="https://github.com/candygoogy/experiments/tree/main/fixture">Source</a>',
      );
    }
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
