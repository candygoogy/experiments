import { defineExperiment } from "@exp/shared/vite";
import type { Plugin } from "vite";
import { COPY } from "./src/copy.ts";

// The page's words come from src/copy.ts: each {{name}} in index.html is
// filled in at build time, so the heading and the sentence are in the HTML
// itself.
const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

function words(): Plugin {
  return {
    name: "keyboard-words",
    transformIndexHtml: {
      order: "pre",
      handler: (html) =>
        html.replace(/\{\{([\w.]+)\}\}/g, (_, path: string) => {
          const value = path
            .split(".")
            .reduce<unknown>(
              (o, k) => (o as Record<string, unknown> | undefined)?.[k],
              COPY,
            );
          if (typeof value !== "string") {
            throw new Error(`index.html: no words for {{${path}}}`);
          }
          return escape(value);
        }),
    },
  };
}

const config = defineExperiment({
  name: "keyboard",
  title: COPY.title,
  description: COPY.description,
  port: 4412,
  privacy: COPY.privacy,
});

export default { ...config, plugins: [...(config.plugins ?? []), words()] };
