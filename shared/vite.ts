// defineExperiment(): the Vite config every experiment uses. It builds the
// shared shell into index.html, inlines the pre-paint theme script, and
// writes dist/_headers with a Content-Security-Policy that allows exactly
// that script (by its hash) and no network calls, so the browser itself
// blocks any upload. The hash is taken from the same text that's inlined,
// so editing the script can never leave a stale hash behind.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin, UserConfig } from "vite";
import { thirdPartyNotices } from "./licenses.ts";
import {
  shellHtml,
  themeScript,
  type ExperimentOptions,
  type ShellOptions,
} from "./shell.ts";

export type { ExperimentOptions, ShellOptions };

const FONTS = ["CabinetGrotesk-Variable.woff2", "Satoshi-Variable.woff2"];
const FONTS_DIR = fileURLToPath(new URL("./fonts/", import.meta.url));
// Files every experiment serves as they are (the icons).
const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));

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
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

const MARKERS = ["head", "header", "footer"] as const;

function shell(o: ExperimentOptions): Plugin {
  const source = `https://github.com/candygoogy/experiments/tree/main/${o.name}`;
  return {
    name: "experiment-shell",
    // Without the font files the page would quietly fall back to system
    // fonts: stop instead (`npm run fonts` fetches them).
    transform(_code, id) {
      if (!id.replace(/\\/g, "/").endsWith("/shared/fonts.css")) return;
      const missing = FONTS.filter((f) => !existsSync(FONTS_DIR + f));
      if (missing.length) {
        this.error(
          `fonts: ${missing.join(", ")} missing in shared/fonts/. Run npm run fonts.`,
        );
      }
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const parts = shellHtml({ ...o, source });
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
