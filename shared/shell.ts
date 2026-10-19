// The page shell every experiment shares: what goes in the head (title,
// theme metas, the pre-paint theme script), the header (a skip link, the
// wordmark back to candygoogy.dev, Experiments, the theme switch; on
// phones, Menu and its menu, as on the site) and the footer (the privacy
// line, its claim linked to how to check it, the source, the license).
// Built into index.html by defineExperiment() in vite.ts; styled by
// shell.css, run by header.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
}

export interface ShellOptions extends ExperimentOptions {
  /** The experiment's folder on GitHub. */
  source: string;
}

export const SITE = "https://candygoogy.dev";
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

export function shellHtml(o: ShellOptions): {
  head: string;
  header: string;
  footer: string;
} {
  const head = [
    `<title>${escape(o.title + TITLE_END)}</title>`,
    `<meta name="description" content="${escape(o.description)}" />`,
    `<link rel="canonical" href="https://${o.name}.candygoogy.dev/" />`,
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
    `<p class="privacy">${privacyLine(o.privacy ?? PRIVACY)}</p>` +
    `<a href="${escape(o.source)}">Source</a>` +
    `<span>MIT</span>` +
    `</div></footer>`;
  return { head, header, footer };
}
