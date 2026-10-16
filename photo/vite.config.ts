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
  { plugins: [photoExample()] },
);
