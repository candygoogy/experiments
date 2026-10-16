import { defineExperiment, words } from "@exp/shared/vite";
import { COPY } from "./src/copy.ts";

const config = defineExperiment({
  name: "keyboard",
  title: COPY.title,
  description: COPY.description,
  port: 4412,
  privacy: COPY.privacy,
});

export default { ...config, plugins: [...(config.plugins ?? []), words(COPY)] };
