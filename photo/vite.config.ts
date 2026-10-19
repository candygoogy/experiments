import { defineExperiment } from "@exp/shared/vite";
import { mergeConfig } from "vite";
import { photoExample } from "./example-html.ts";
import { copy } from "./src/copy.ts";

export default mergeConfig(
  defineExperiment({
    name: "photo",
    title: copy.title,
    description: copy.intro,
    port: 4413,
  }),
  {
    plugins: [photoExample()],
    // exifr's worker is one file of its own, loaded from this origin (the
    // page's CSP allows no other).
    worker: { format: "es" },
  },
);
