import { defineExperiment } from "../../vite";

export default defineExperiment({
  name: "fixture",
  title: "Fixture",
  description: "A page for the shell's build checks.",
  port: 4400,
  card: false,
});
