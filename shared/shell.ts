// The page shell every experiment shares: what goes in the head (title,
// theme metas, the pre-paint theme script), the header (a skip link, the
// wordmark back to candygoogy.dev, Experiments, the theme switch) and the
// footer (the privacy line, the source, the license). Built into
// index.html by defineExperiment() in vite.ts; styled by shell.css.
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
/** The footer's privacy line unless an experiment gives its own. */
export const PRIVACY =
  "Runs in your browser. Nothing you drop here is uploaded.";
/** The first Tab stop on every page, as on candygoogy.dev: past the
 * header to the tool (every index.html has <main id="tool">). */
export const SKIP = "Skip to content";

/** The pre-paint theme script, exactly as it's inlined and hashed. */
export const themeScript = (): string =>
  readFileSync(
    fileURLToPath(new URL("./theme-head.js", import.meta.url)),
    "utf8",
  );

const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

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
      `<span class="icon icon-${o.value}" aria-hidden="true"></span></span>` +
      (o.value === "auto"
        ? `<span class="visually-hidden" data-resolved></span>`
        : "") +
      `</button>`,
  ).join("");
  const ink = OPTIONS.map(
    (o) =>
      `<span class="face" data-label="${o.label}">` +
      (o.value === "auto" ? `<span class="resolved"></span>` : "") +
      `<span class="icon icon-${o.value}"></span></span>`,
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
  const header =
    `<a class="skip" href="#tool">${SKIP}</a>` +
    `<header class="top wrap">` +
    `<a class="brand" href="${SITE}/">candygoogy</a>` +
    `<nav aria-label="Main"><ul><li><a href="${SITE}/experiments">Experiments</a></li></ul></nav>` +
    `<div class="tools">${themeSwitch()}</div>` +
    `</header>`;
  const footer =
    `<footer class="foot wrap"><div class="inner">` +
    `<p class="privacy">${escape(o.privacy ?? PRIVACY)}</p>` +
    `<a href="${escape(o.source)}">Source</a>` +
    `<span>MIT</span>` +
    `</div></footer>`;
  return { head, header, footer };
}
