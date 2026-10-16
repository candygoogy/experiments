import { defineExperiment } from "@exp/shared/vite";
import type { Plugin } from "vite";
import { mailExample } from "./example-html.ts";
import { COPY } from "./src/copy.ts";

// The page's words come from src/copy.ts: each {{name}} in index.html is
// filled in at build time, so the heading and the sentence are in the HTML
// itself.
const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", "&#10;");

function words(): Plugin {
  return {
    name: "mail-words",
    transformIndexHtml: {
      order: "pre",
      handler: (html) =>
        html.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
          const value = (COPY as Record<string, unknown>)[key];
          if (typeof value !== "string") {
            throw new Error(`index.html: no words for {{${key}}}`);
          }
          return escape(value);
        }),
    },
  };
}

const config = defineExperiment({
  name: "mail",
  title: COPY.title,
  description: COPY.description,
  port: 4415,
  privacy: COPY.privacy,
  connectSrc: ["https://cloudflare-dns.com"],
});

export default {
  ...config,
  plugins: [...(config.plugins ?? []), words(), mailExample()],
};
