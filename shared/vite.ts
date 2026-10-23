// defineExperiment(): the Vite config every experiment uses. It builds the
// shared shell into index.html, inlines the pre-paint theme script, and
// writes dist/_headers with a Content-Security-Policy that allows exactly
// that script (by its hash) and no network calls, so the browser itself
// blocks any upload. The hash is taken from the same text that's inlined,
// so editing the script can never leave a stale hash behind.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, UserConfig } from "vite";
import { buildStamp, type Build } from "./build.ts";
import { thirdPartyNotices } from "./licenses.ts";
import {
  REPO,
  escape,
  notFoundHtml,
  shellHtml,
  themeScript,
  type ExperimentOptions,
  type ShellOptions,
} from "./shell.ts";

export type { ExperimentOptions, ShellOptions };

// Committed in shared/fonts/ (SIL Open Font License 1.1, the same files
// as candygoogy.dev's src/fonts/).
const FONTS = ["Newsreader-Display.woff2", "SchibstedGrotesk.woff2"];
const FONTS_DIR = fileURLToPath(new URL("./fonts/", import.meta.url));
// Files every experiment serves as they are (the icons).
const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
// The 404's script and styles (the header, as on a tool page), built as an
// entry of their own that only 404.html loads. Every module it reaches is
// a copy of its own (its id marked with NOT_FOUND_ID), so nothing is
// shared with the tool's entry: no common chunk, and the tool's own files
// come out exactly as they would without it.
const NOT_FOUND_ENTRY = fileURLToPath(
  new URL("./notfound.ts", import.meta.url),
);
const NOT_FOUND = "notfound";
const NOT_FOUND_ID = "?notfound";

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("base64");

export function cspFor(o: ExperimentOptions, script: string): string {
  const connect = o.connectSrc?.length ? o.connectSrc.join(" ") : "'none'";
  return [
    "default-src 'self'",
    `connect-src ${connect}`,
    "img-src 'self' blob: data:",
    "style-src 'self'",
    `script-src 'self' 'sha256-${sha256(script)}'`,
    "font-src 'self'",
    // A tool's Web Worker comes from its own files, never a blob.
    "worker-src 'self'",
    // No plugins, so no <object> or <embed> either.
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

const MARKERS = ["head", "header", "footer"] as const;

function shell(o: ExperimentOptions): Plugin {
  const source = `${REPO}/tree/main/${o.name}`;
  let building = false;
  // The tool's folder, where its link-preview card (og.png) lives.
  let root = "";
  // The footer's stamp: found once, when the config is, and said in the
  // build's log.
  let build: Build;
  return {
    name: "experiment-shell",
    configResolved(config) {
      building = config.command === "build";
      root = config.root;
      build = buildStamp();
      config.logger.info(build.note);
    },
    buildStart() {
      if (building) {
        this.emitFile({
          type: "chunk",
          id: NOT_FOUND_ENTRY + NOT_FOUND_ID,
          name: NOT_FOUND,
        });
        // The tool's link-preview card, served as /og.png. Without it a
        // shared link would show no picture: stop instead.
        if (o.card !== false) {
          const card = join(root, "og.png");
          if (!existsSync(card)) {
            this.error(
              `card: ${o.name}/og.png is missing. It's the tool's ` +
                `link-preview card (1200 by 630), rendered by ` +
                `candygoogy.dev's scripts/og.mjs --sites <dir>.`,
            );
          }
          this.emitFile({
            type: "asset",
            fileName: "og.png",
            source: readFileSync(card),
          });
        }
      }
    },
    // What the 404's entry imports, it gets as its own copy too: ahead of
    // Vite's own resolving, which would hand it the tool's.
    resolveId: {
      order: "pre",
      async handler(id, importer, options) {
        if (!importer?.endsWith(NOT_FOUND_ID)) return;
        const resolved = await this.resolve(
          id,
          importer.slice(0, -NOT_FOUND_ID.length),
          { ...options, skipSelf: true },
        );
        if (!resolved || resolved.external || resolved.id.includes("?")) {
          return resolved;
        }
        return { ...resolved, id: resolved.id + NOT_FOUND_ID };
      },
    },
    // Without the font files the page would quietly fall back to system
    // fonts: stop instead.
    transform(_code, id) {
      if (!id.replace(/\\/g, "/").endsWith("/shared/fonts.css")) return;
      const missing = FONTS.filter((f) => !existsSync(FONTS_DIR + f));
      if (missing.length) {
        this.error(`fonts: ${missing.join(", ")} missing in shared/fonts/.`);
      }
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const parts = shellHtml({ ...o, source, build });
        for (const marker of MARKERS) {
          const tag = `<!-- shell:${marker} -->`;
          if (!html.includes(tag)) {
            throw new Error(`index.html has no ${tag}`);
          }
          html = html.replace(tag, () => parts[marker]);
        }
        return html;
      },
    },
    generateBundle(_options, bundle) {
      // The notices for any third-party code in the page, served as a
      // plain file next to it.
      const ids = Object.values(bundle).flatMap((file) =>
        file.type === "chunk" ? file.moduleIds : [],
      );
      this.emitFile({
        type: "asset",
        fileName: "third-party-licenses.txt",
        source: thirdPartyNotices(ids),
      });
      // dist/404.html: the tool's stylesheets (its page's entry), then the
      // 404's own, and the 404's script.
      const entries = Object.values(bundle).flatMap((file) =>
        file.type === "chunk" && file.isEntry ? [file] : [],
      );
      const notFound = entries.find((file) => file.name === NOT_FOUND);
      const sheets = [
        ...entries.filter((file) => file !== notFound),
        ...(notFound ? [notFound] : []),
      ].flatMap((file) => [...(file.viteMetadata?.importedCss ?? [])]);
      this.emitFile({
        type: "asset",
        fileName: "404.html",
        source: notFoundHtml(
          { ...o, source, build },
          {
            css: sheets,
            script: notFound?.fileName,
            fonts: Object.values(bundle)
              .map((file) => file.fileName)
              .filter((name) => name.endsWith(".woff2")),
          },
        ),
      });
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: [
          "/*",
          `  Content-Security-Policy: ${cspFor(o, themeScript())}`,
          "  X-Content-Type-Options: nosniff",
          "  Referrer-Policy: strict-origin-when-cross-origin",
          // No tool asks for the camera, the microphone or the location.
          "  Permissions-Policy: camera=(), microphone=(), geolocation=()",
          "  Cross-Origin-Opener-Policy: same-origin",
          // HTTPS only, for this subdomain alone (no includeSubDomains, no
          // preload: those are the zone's call).
          "  Strict-Transport-Security: max-age=31536000",
          "",
          "/assets/*",
          "  Cache-Control: public, max-age=31536000, immutable",
          "",
        ].join("\n"),
      });
    },
  };
}

// The two fonts start loading with the CSS, not after it.
function preloadFonts(): Plugin {
  return {
    name: "experiment-preload-fonts",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        if (!ctx.bundle) return;
        return Object.values(ctx.bundle)
          .filter((file) => file.fileName.endsWith(".woff2"))
          .map((file) => ({
            tag: "link",
            attrs: {
              rel: "preload",
              href: `/${file.fileName}`,
              as: "font",
              type: "font/woff2",
              crossorigin: true,
            },
            injectTo: "head" as const,
          }));
      },
    },
  };
}

// A tool's words come from its src/copy.ts: each {{path}} in index.html
// (a key, or keys joined by dots) is filled in at build time, so the
// heading and the sentence are in the HTML itself. A path with no words
// stops the build.
export function words(copy: object): Plugin {
  return {
    name: "experiment-words",
    transformIndexHtml: {
      order: "pre",
      handler: (html) =>
        html.replace(/\{\{([\w.]+)\}\}/g, (_, path: string) => {
          const value = path
            .split(".")
            .reduce<unknown>(
              (o, k) => (o as Record<string, unknown> | undefined)?.[k],
              copy,
            );
          if (typeof value !== "string") {
            throw new Error(`index.html: no words for {{${path}}}`);
          }
          return escape(value);
        }),
    },
  };
}

export function defineExperiment(o: ExperimentOptions): UserConfig {
  return {
    plugins: [shell(o), preloadFonts()],
    publicDir: PUBLIC_DIR,
    server: { host: "127.0.0.1", port: o.port, strictPort: true },
    preview: { host: "127.0.0.1", port: o.port, strictPort: true },
    build: {
      target: "es2022",
      // Every supported browser has modulepreload.
      modulePreload: { polyfill: false },
    },
  };
}
