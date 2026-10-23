// The page shell every experiment shares: what goes in the head (title,
// theme metas, the pre-paint theme script), the header (a skip link, the
// wordmark back to candygoogy.dev, Experiments, the theme switch; on
// phones, Menu and its menu, as on the site) and the footer (as on the
// site: the notes, ©, the privacy line with its claim linked to how to
// check it and the build stamp, then the source and the license).
// Built into index.html by defineExperiment() in vite.ts; styled by
// shell.css, run by header.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Build } from "./build.ts";

export interface ExperimentOptions {
  /** Folder and subdomain, e.g. "battery". */
  name: string;
  /** The page's name: its h1, and its <title> as "<name> – candygoogy",
   * the way candygoogy.dev names its pages. */
  title: string;
  /** The meta description. */
  description: string;
  /** Vite's dev port; Wrangler serves on port + 10. */
  port: number;
  /** Hosts the page may connect to (CSP connect-src); none by default. */
  connectSrc?: string[];
  /** The footer's privacy line, if the default doesn't fit the tool. */
  privacy?: string;
  /** False only for a page that's never served (the template, the build
   * checks' fixture): it ships no link-preview card. Every tool ships its
   * og.png. */
  card?: false;
  /** The line drawn on the link-preview card, when it isn't the
   * description's first sentence (the card shows the site's line). */
  cardLine?: string;
}

export interface ShellOptions extends ExperimentOptions {
  /** The experiment's folder on GitHub. */
  source: string;
  /** When and from which commit it was built, for the footer's stamp. */
  build: Build;
  /** The card's description, when the page isn't the tool's own: the 404
   * shows the tool's card, so it keeps the tool's words for it. */
  cardAlt?: string;
}

export const SITE = "https://candygoogy.dev";
/** The experiments' repository: each tool's source is its folder there,
 * and the footer's stamp links the commit it was built from. */
export const REPO = "https://github.com/candygoogy/experiments";
/** What follows an experiment's name in its <title>, as on the site. */
export const TITLE_END = " – candygoogy";
/** Where the footer's privacy claim links: how to check it, on the site's
 * colophon (its Privacy row covers every tool, mail's DNS lookup too). */
export const PRIVACY_PROOF = `${SITE}/colophon#privacy`;
/** The footer's privacy line unless an experiment gives its own. */
export const PRIVACY =
  "Runs in your browser. Nothing you drop here is uploaded.";
/** The menu's route, as on candygoogy.dev: the site's sections, with
 * Experiments, where every tool belongs, as the current one. */
export const ROUTE = [
  { href: `${SITE}/#projects`, label: "Projects" },
  { href: `${SITE}/experiments`, label: "Experiments", current: true },
  { href: `${SITE}/#about`, label: "About" },
  { href: `${SITE}/#contact`, label: "Contact" },
] as const;

/** The menu's index of featured projects, as on candygoogy.dev's menu:
 * its heading, then each project's name and line, in the site's order.
 * The site's daily check compares it with the live site, so a change
 * there shows up here. */
export const FEATURED_TITLE = "A few things I’ve built";
export const FEATURED = [
  {
    href: `${SITE}/fettle`,
    name: "Fettle",
    blurb: "Windows check-up, printed as a readable receipt",
  },
  {
    href: `${SITE}/idiff`,
    name: "Install diff",
    blurb: "What an installer did to your PC, in plain words",
  },
  {
    href: `${SITE}/#eolietech`,
    name: "Eolietech",
    blurb: "Free file tools that run in your browser",
  },
  {
    href: `${SITE}/#notary`,
    name: "Notary",
    blurb: "Claude Code mods that check Claude’s work",
  },
] as const;

/** The first Tab stop on every page, as on candygoogy.dev: past the
 * header to the tool (every index.html has <main id="tool">). */
export const SKIP = "Skip to content";
/** The phone header's button, and its word while the menu is open. */
export const MENU = "Menu";
export const CLOSE = "Close";

/** The pre-paint theme script, exactly as it's inlined and hashed. */
export const themeScript = (): string =>
  readFileSync(
    fileURLToPath(new URL("./theme-head.js", import.meta.url)),
    "utf8",
  );

/** Text made safe for HTML, in an element or a quoted attribute. A line
 * break is written as &#10;, so a placeholder's lines stay lines; in text
 * it reads the same. */
export const escape = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", "&#10;");

/** Escaped text whose hyphenated words ("check-up") never break at the
 * hyphen, as the site's Keep.astro does: each is wrapped in a no-wrap
 * span. */
const keep = (text: string): string =>
  text
    .split(/([\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)+)/u)
    .map((part, i) =>
      i % 2 === 1
        ? `<span class="menu-index-nobr">${escape(part)}</span>`
        : escape(part),
    )
    .join("");

/** The footer's privacy line: "Runs in your browser." as text, then the
 * claim after it linked to how to check it, as the site links only its
 * claim. A line of one sentence is linked whole. */
const privacyLine = (line: string): string => {
  const [, lead, claim] = /^(.+?[.!?])\s+(\S.*)$/su.exec(line) ?? [];
  const link = (text: string) =>
    `<a href="${PRIVACY_PROOF}">${escape(text)}</a>`;
  return lead && claim ? `${escape(lead)} ${link(claim)}` : link(line);
};

/** The footer's build stamp, as on the site: "Built Oct 23, 2026 from
 * 1a2b3c4", the commit linked to the repository; "-dirty" when built with
 * uncommitted changes; just the date when the build had no commit. */
const stamp = (b: Build): string => {
  const date = `Built <time datetime="${b.iso}">${b.label}</time>`;
  if (!b.commit) return date;
  // The link's name holds its text, "1a2b3c4-dirty" too, as on the site.
  const short = `${b.commit.slice(0, 7)}${b.dirty ? "-dirty" : ""}`;
  const label = `commit ${short}${b.dirty ? ", with uncommitted changes" : ""}`;
  return (
    `${date} from <a href="${REPO}/commit/${b.commit}" aria-label="${label}">` +
    `${short}</a>`
  );
};

const OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const themeSwitch = () => {
  const buttons = OPTIONS.map(
    (o) =>
      `<button type="button" data-value="${o.value}" aria-pressed="false">` +
      `<span class="face"><span class="name">${o.label}</span>` +
      (o.value === "auto" ? `<span class="resolved"></span>` : "") +
      `</span>` +
      (o.value === "auto"
        ? `<span class="visually-hidden" data-resolved></span>`
        : "") +
      `</button>`,
  ).join("");
  const ink = OPTIONS.map(
    (o) =>
      `<span class="face" data-label="${o.label}">` +
      (o.value === "auto" ? `<span class="resolved"></span>` : "") +
      `</span>`,
  ).join("");
  return (
    `<div class="themes" role="group" aria-label="Theme" data-theme-switch>` +
    `<span class="pill" aria-hidden="true"></span>${buttons}` +
    `<div class="ink" aria-hidden="true">${ink}</div></div>`
  );
};

/** The link-preview card's description: the tool's name, then the line
 * drawn on its card, the description's first sentence unless a cardLine
 * is given. */
export const cardAlt = (o: ExperimentOptions): string => {
  if (o.cardLine) return `${o.title}: ${o.cardLine}`;
  const [lede = ""] = o.description.split(". ");
  return `${o.title}: ${lede === o.description ? lede : `${lede}.`}`;
};

export function shellHtml(o: ShellOptions): {
  head: string;
  header: string;
  footer: string;
} {
  const home = `https://${o.name}.candygoogy.dev/`;
  const head = [
    `<title>${escape(o.title + TITLE_END)}</title>`,
    `<meta name="description" content="${escape(o.description)}" />`,
    `<link rel="canonical" href="${home}" />`,
    // The link preview, as candygoogy.dev's pages send it: the tool's card
    // (og.png, shipped by the build) at its full 1200 by 630.
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="candygoogy" />`,
    `<meta property="og:title" content="${escape(o.title + TITLE_END)}" />`,
    `<meta property="og:description" content="${escape(o.description)}" />`,
    `<meta property="og:url" content="${home}" />`,
    `<meta property="og:image" content="${home}og.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escape(o.cardAlt ?? cardAlt(o))}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="color-scheme" content="light dark" />`,
    `<meta name="theme-color" content="#f4f4f5" media="(prefers-color-scheme: light)" />`,
    `<meta name="theme-color" content="#121214" media="(prefers-color-scheme: dark)" />`,
    // The site's icons (shared/public), the same as candygoogy.dev's.
    `<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />`,
    `<script>${themeScript()}</script>`,
  ].join("\n    ");
  const brand = `<a class="brand" href="${SITE}/">candygoogy</a>`;
  // Where the row doesn't fit, the menu (header.ts): its top row is the
  // header's, with Close where Menu was; right under it the site's route,
  // drawn in its timeline's line and rings; under that the site's index
  // of featured projects, where the screen has room for it; and the theme
  // switch at the bottom.
  const route = ROUTE.map(
    (r) =>
      `<li><a href="${r.href}"${"current" in r ? ` aria-current="true"` : ""}>` +
      `<span class="route-node" aria-hidden="true"><span></span></span>` +
      `<span class="route-name"><span>${r.label}</span></span></a></li>`,
  ).join("");
  const featured = FEATURED.map(
    (f) =>
      `<li><a href="${escape(f.href)}">` +
      `<span class="menu-index-name">${escape(f.name)}</span>` +
      `<span class="menu-index-blurb">${keep(f.blurb)}</span></a></li>`,
  ).join("");
  const index =
    `<div class="menu-index wrap" data-menu-index>` +
    `<nav aria-labelledby="menu-index-title">` +
    `<h2 id="menu-index-title">${escape(FEATURED_TITLE)}</h2>` +
    `<ol>${featured}</ol></nav></div>`;
  const header =
    `<a class="skip" href="#tool">${SKIP}</a>` +
    `<header class="top wrap">` +
    brand +
    `<nav class="nav" aria-label="Main"><ul><li><a href="${SITE}/experiments">Experiments</a></li></ul></nav>` +
    `<div class="tools">${themeSwitch()}</div>` +
    `<button type="button" class="toggle" aria-expanded="false" aria-controls="menu" aria-haspopup="dialog" data-menu-open>` +
    `<span class="swap"><span>${MENU}</span></span></button>` +
    `<dialog id="menu" class="menu" aria-label="${MENU}" tabindex="-1" data-menu>` +
    `<div class="top wrap">${brand}` +
    `<button type="button" class="toggle" data-menu-close><span class="swap">` +
    `<span aria-hidden="true">${MENU}</span><span>${CLOSE}</span></span></button></div>` +
    `<nav class="route wrap" aria-label="Pages"><ul>${route}</ul></nav>` +
    index +
    `<div class="menu-end wrap">${themeSwitch()}</div>` +
    `</dialog>` +
    `</header>`;
  const footer =
    `<footer class="foot wrap"><div class="inner">` +
    `<p class="notes"><span>© ${o.build.year} candygoogy</span>` +
    `<span class="privacy">${privacyLine(o.privacy ?? PRIVACY)}</span>` +
    `<span class="stamp">${stamp(o.build)}</span></p>` +
    `<a href="${escape(o.source)}">Source</a>` +
    `<span>MIT</span>` +
    `</div></footer>`;
  return { head, header, footer };
}

/** The 404's words, as on candygoogy.dev's 404. */
export const NOT_FOUND_TITLE = "Page not found";
export const NOT_FOUND_LEDE =
  "There’s nothing at this address. It may have moved, or the link has a typo.";

// The route trace's hops, as on the site's 404: drawn once, in hairlines;
// with JS they're checked in turn (notfound-trace.ts).
const HOP_ICONS = {
  laptop:
    `<rect x="4" y="5" width="16" height="11" rx="1.5" />` +
    `<path d="M2 19h20" />`,
  globe:
    `<circle cx="12" cy="12" r="8.5" />` +
    `<path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5s1.2-6.2 3.6-8.5Z" />`,
  page:
    `<path d="M6.5 3.5h7.5l4 4v13h-11.5Z" />` +
    `<path d="M14 3.5v4h4M9.5 13h5M9.5 16.5h3" />`,
};

// Every state a hop can show, stacked in one cell as wide as the hop's
// settled word (data-settled), so the settled status sits centred under its
// icon and nothing moves when it changes (as on the site).
const HOP_STATES = {
  // Its dots are separate, so they can appear in turn while the hop is
  // being checked.
  checking: `Checking<span class="nf-dots"><span>.</span><span>.</span><span>.</span></span>`,
  ok: "Working",
  missing: "Not found",
  restarting: "Restarting…",
};

/** dist/404.html, served by Cloudflare for any path with no file: the
 * shell (the same head script, so the CSP's hash holds), then the site's
 * 404 (404.astro) in the tool's words, with its route trace. Linked to
 * the tool's built stylesheets, the 404's own and its script (the
 * header's, as on a tool page, and the 404's motion: notfound.ts), and
 * the fonts preloaded, as the build finds them. Without JS it's the
 * finished state. */
export function notFoundHtml(
  o: ShellOptions,
  assets: { css: string[]; fonts: string[]; script?: string | undefined },
): string {
  const parts = shellHtml({
    ...o,
    title: NOT_FOUND_TITLE,
    description: "There’s nothing at this address.",
    cardAlt: cardAlt(o),
  });
  // The tool's canonical address is its home, not this page, so neither
  // the canonical nor the preview's address is sent, as on the site's 404.
  const head = parts.head
    .replace(/<link rel="canonical"[^>]*>\s*/, "")
    .replace(/<meta property="og:url"[^>]*>\s*/, "");
  const fonts = assets.fonts.map(
    (f) =>
      `<link rel="preload" href="/${escape(f)}" as="font" type="font/woff2" crossorigin />`,
  );
  const css = assets.css.map(
    (f) => `<link rel="stylesheet" crossorigin href="/${escape(f)}" />`,
  );
  const script = assets.script
    ? [
        `<script type="module" crossorigin src="/${escape(assets.script)}"></script>`,
      ]
    : [];
  const hops = [
    { label: "You", ok: true, icon: HOP_ICONS.laptop },
    // The site, as on candygoogy.dev's 404: the tool is one of its
    // subdomains, and the address bar and the way back already name it.
    { label: "candygoogy.dev", ok: true, icon: HOP_ICONS.globe },
    { label: "This page", ok: false, icon: HOP_ICONS.page },
  ]
    .map((hop, i) => {
      const state = hop.ok ? "ok" : "missing";
      const states = Object.entries(HOP_STATES)
        .map(
          ([key, text]) =>
            `<span data-is="${key}"${key === state ? " data-settled" : ""}>${text}</span>`,
        )
        .join("");
      return (
        `<li class="nf-hop" data-hop="${i + 1}"><span class="nf-node">` +
        `<span class="nf-glyph" aria-hidden="true">` +
        `<svg viewBox="0 0 24 24" width="28" height="28">${hop.icon}</svg></span>` +
        `<span class="nf-num" aria-hidden="true">0${i + 1}</span>` +
        `<span class="nf-label">${hop.label}</span>` +
        `<span class="visually-hidden">, </span>` +
        `<span class="nf-status" data-state="${state}">` +
        `<span class="nf-dot" aria-hidden="true"></span>` +
        `<span class="nf-states" aria-hidden="true">${states}</span>` +
        `<span class="visually-hidden" data-sr>${HOP_STATES[state]}</span>` +
        `</span>` +
        // The path under "This page", filled in by the script; its line is
        // kept even when empty, as on the site, so nothing moves.
        (hop.ok ? "" : `<span class="nf-path" data-path></span>`) +
        `</span></li>`
      );
    })
    .join("");
  const trace =
    `<div class="nf-trace" data-trace>` +
    `<span class="nf-tick nf-tl" aria-hidden="true"></span>` +
    `<span class="nf-tick nf-tr" aria-hidden="true"></span>` +
    `<span class="nf-tick nf-bl" aria-hidden="true"></span>` +
    `<span class="nf-tick nf-br" aria-hidden="true"></span>` +
    // The request's time and path, as on the site, come from the script.
    `<p class="nf-panel-head"><span>Route check</span><span data-time-value></span></p>` +
    `<div class="nf-panel-body"><ol class="nf-hops">${hops}</ol>` +
    `<p class="nf-egg-line" aria-live="polite" data-egg-line></p></div>` +
    `<dl class="nf-meta leaders"><div><dt>Status</dt><dd>404</dd></div>` +
    `<div hidden data-meta-path><dt>Path</dt><dd data-path-value></dd></div></dl>` +
    `</div>`;
  // The "404" types in digit by digit, each in its own clip (notfound.css).
  const code = [..."404"]
    .map(
      (ch, i) => `<span class="nf-l" data-i="${i}"><span>${ch}</span></span>`,
    )
    .join("");
  return [
    `<!doctype html>`,
    `<html lang="en">`,
    `  <head>`,
    `    <meta charset="utf-8" />`,
    `    <meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `    <meta name="robots" content="noindex" />`,
    `    ${head}`,
    ...[...script, ...css, ...fonts].map((l) => `    ${l}`),
    `  </head>`,
    `  <body class="nf-page">`,
    `    ${parts.header}`,
    `    <main id="tool" class="wrap">`,
    `      <section class="nf" aria-labelledby="nf-title">`,
    `        <div class="nf-lost">`,
    `          <p class="nf-code" aria-hidden="true">${code}</p>`,
    `          <h1 id="nf-title"><span class="rv-mask" data-d="260"><span>${NOT_FOUND_TITLE}</span></span></h1>`,
    `          <p class="nf-lede rv" data-d="380">${escape(NOT_FOUND_LEDE)}</p>`,
    `          <p class="nf-back rv" data-d="500"><a href="/">Back to ${escape(o.title)}</a></p>`,
    `        </div>`,
    `        ${trace}`,
    `      </section>`,
    `    </main>`,
    `    ${parts.footer}`,
    `  </body>`,
    `</html>`,
    ``,
  ].join("\n");
}
