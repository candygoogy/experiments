import { defineExperiment } from "@exp/shared/vite";
import { copy } from "./src/copy.ts";

export default defineExperiment({
  name: "battery",
  title: copy.title,
  description: copy.intro,
  port: 4411,
});
