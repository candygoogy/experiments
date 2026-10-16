import { defineExperiment } from "@exp/shared/vite";
import { mergeConfig, type Plugin } from "vite";
import { logscopeExample } from "./example-html.ts";
import { copy } from "./src/copy.ts";

// The page's words come from src/copy.ts: each {{name}} in index.html is
// filled in when the page is built.
const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

function words(): Plugin {
  return {
    name: "logscope-words",
    transformIndexHtml: {
      order: "pre",
      handler: (html) =>
        html.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
          const value = (copy as Record<string, unknown>)[key];
          if (typeof value !== "string") {
            throw new Error(`index.html: no words for {{${key}}}`);
          }
          return escape(value);
        }),
    },
  };
}

export default mergeConfig(
  defineExperiment({
    name: "logscope",
    title: copy.title,
    description: copy.intro,
    port: 4417,
  }),
  {
    plugins: [words(), logscopeExample()],
    // The worker is one file of its own, loaded from this origin (the
    // page's CSP allows no other).
    worker: { format: "es" },
  },
);
