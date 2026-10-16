// What the page loads with the first file: the parser and the drawing.
import { COPY } from "./copy";
import { parseCompose } from "./parse";
import { renderAnswer } from "./render";

export type Result =
  | { nodes: HTMLElement[]; verdict: string; services: number }
  | { problem: string };

/** `source`: the name of the one file dropped, when there was one. */
export function answer(text: string, source: string | null = null): Result {
  const parsed = parseCompose(text);
  if ("error" in parsed) {
    return {
      problem: parsed.error === "yaml" ? COPY.notYaml(parsed.line) : COPY.empty,
    };
  }
  const { nodes, verdict } = renderAnswer(
    document,
    parsed.file,
    "yours",
    source,
  );
  return { nodes, verdict, services: parsed.file.services.length };
}
