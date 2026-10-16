// How serious a finding is, and whom it names: what the page's first line
// needs, apart from the rules that find them (findings.ts), so the words
// can load without the rules.
import type { Finding } from "./findings.ts";

/** 3: control of the host; 2: exposed or broken; 1: worth tidying. */
export function severity(f: Finding): 1 | 2 | 3 {
  switch (f.rule) {
    case "socket":
    case "privileged":
    case "rootMount":
      return 3;
    case "caps":
      return f.caps.some((c) => c !== "NET_ADMIN") ? 3 : 2;
    case "latest":
    case "noRestart":
      return 1;
    default:
      return 2;
  }
}

/** The services a finding is about. */
export const about = (f: Finding): string[] =>
  "services" in f ? [...f.services] : [f.service];
