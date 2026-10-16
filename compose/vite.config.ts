import { defineExperiment, words } from "@exp/shared/vite";
import { composeExample } from "./example-html.ts";
import { COPY } from "./src/copy.ts";

const config = defineExperiment({
  name: "compose",
  title: COPY.title,
  description: COPY.description,
  port: 4414,
  privacy: COPY.privacy,
});

export default {
  ...config,
  plugins: [...(config.plugins ?? []), words(COPY), composeExample()],
};
