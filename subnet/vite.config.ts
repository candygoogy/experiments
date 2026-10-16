import { defineExperiment, words } from "@exp/shared/vite";
import { subnetExample } from "./example-html.ts";
import { COPY } from "./src/copy.ts";

const config = defineExperiment({
  name: "subnet",
  title: COPY.title,
  description: COPY.description,
  port: 4416,
  privacy: COPY.privacy,
});

export default {
  ...config,
  plugins: [...(config.plugins ?? []), words(COPY), subnetExample()],
};
