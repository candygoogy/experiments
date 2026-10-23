import { defineExperiment } from "@exp/shared/vite";

export default defineExperiment({
  name: "template",
  title: "Template",
  description: "One sentence that says what this does.",
  port: 4410,
  // Never served, so no link-preview card (a new tool's copy needs one).
  card: false,
});
