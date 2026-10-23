import { defineExperiment, words } from "@exp/shared/vite";
import { COPY } from "./src/copy.ts";

const config = defineExperiment({
  name: "keyboard",
  title: COPY.title,
  description: COPY.description,
  port: 4412,
  privacy: COPY.privacy,
  // The card's line is the site's, shorter than the description's.
  cardLine: "Press every key and watch it light up.",
});

export default { ...config, plugins: [...(config.plugins ?? []), words(COPY)] };
