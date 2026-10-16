import { defineExperiment, words } from "@exp/shared/vite";
import { mergeConfig } from "vite";
import { logscopeExample } from "./example-html.ts";
import { copy } from "./src/copy.ts";

export default mergeConfig(
  defineExperiment({
    name: "logscope",
    title: copy.title,
    description: copy.intro,
    port: 4417,
  }),
  {
    plugins: [words(copy), logscopeExample()],
    // The worker is one file of its own, loaded from this origin (the
    // page's CSP allows no other).
    worker: { format: "es" },
  },
);
