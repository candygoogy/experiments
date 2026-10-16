import { defineExperiment, words } from "@exp/shared/vite";
import { mailExample } from "./example-html.ts";
import { COPY } from "./src/copy.ts";

const config = defineExperiment({
  name: "mail",
  title: COPY.title,
  description: COPY.description,
  port: 4415,
  privacy: COPY.privacy,
  connectSrc: ["https://cloudflare-dns.com"],
});

export default {
  ...config,
  plugins: [...(config.plugins ?? []), words(COPY), mailExample()],
};
