import "@exp/shared/tokens.css";
import "@exp/shared/fonts.css";
import "@exp/shared/base.css";
import "@exp/shared/shell.css";
import "@exp/shared/theme-switch.css";
import "@exp/shared/dropzone.css";
import "@exp/shared/work.css";
import "./compose.css";
import { initDropZone } from "@exp/shared/dropzone";
import { initThemeSwitch } from "@exp/shared/theme-switch";
import { COPY } from "./copy";
import { drawWires } from "./wires";

const themes = document.querySelector<HTMLElement>("[data-theme-switch]");
if (themes) initThemeSwitch(themes);

const find = <T extends Element>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`compose: ${selector} is missing`);
  return node;
};
const textarea = find<HTMLTextAreaElement>("#file");
const problem = find<HTMLElement>("#problem");
const zone = find<HTMLLabelElement>(".drop");
const input = find<HTMLInputElement>(".drop input");
const example = find<HTMLElement>(".pane.example");
const yours = find<HTMLElement>(".pane.yours");
const out = find<HTMLElement>(".pane.yours .out");
const live = find<HTMLElement>(".live");

// Files bigger than this aren't compose files anyone writes by hand, and
// a paste as big would hold the page while it's read.
const MAX_BYTES = 2_000_000;
// Typing waits for a pause; a paste or a drop is read at once.
const PAUSE_MS = 250;
// A problem found while typing is read out once typing has paused for a
// second, so a file that's only broken mid-word isn't announced.
const SAY_AFTER_MS = 1000 - PAUSE_MS;

// The wires follow the rows: drawn once a map is on the page, and again
// whenever its size changes (the window, the fonts, the text wrapping).
const sized = new ResizeObserver((entries) => {
  for (const e of entries) drawWires(e.target as HTMLElement);
});
const wire = (scope: HTMLElement) => {
  const map = scope.querySelector<HTMLElement>(".map");
  if (map) sized.observe(map);
};
// The example is in the page already; its wires come after the first
// paint.
requestAnimationFrame(() => wire(example));

let said = "";
const say = (text: string) => {
  if (text === said) return;
  said = text;
  live.textContent = text;
};

// `invalid`: the problem is in the text itself.
const showProblem = (text: string | null, invalid = text !== null) => {
  problem.hidden = text === null;
  problem.textContent = text ?? "";
  if (invalid) textarea.setAttribute("aria-invalid", "true");
  else textarea.removeAttribute("aria-invalid");
};

// The name of the one file dropped, until the text is edited.
let source: string | null = null;

// Back to the example: nothing to map.
function reset() {
  sized.disconnect();
  out.replaceChildren();
  yours.hidden = true;
  yours.classList.remove("is-stale");
  example.hidden = false;
  zone.classList.remove("has-result");
  showProblem(null);
  said = "";
  wire(example);
}

// A text that doesn't read. A map already drawn stays (a file being typed
// is often broken for a moment), dimmed, and the line says so.
let announce = 0;
function trouble(text: string, now: boolean) {
  const mapped = !yours.hidden;
  const line = mapped ? `${text} ${COPY.stale}` : text;
  showProblem(line);
  yours.classList.toggle("is-stale", mapped);
  clearTimeout(announce);
  if (now) say(line);
  else announce = window.setTimeout(() => say(line), SAY_AFTER_MS);
}

let run = 0;
/** `now`: pasted or dropped, so any problem is said at once. */
async function read(text: string, now: boolean) {
  const mine = ++run;
  clearTimeout(announce);
  if (!text.trim()) {
    reset();
    return;
  }
  if (text.length > MAX_BYTES) {
    trouble(COPY.tooBig, now);
    return;
  }
  // The parser and the drawing load with the first file.
  const { answer } = await import("./answer");
  if (mine !== run) return;
  const result = answer(text, source);
  if ("problem" in result) {
    trouble(result.problem, now);
    return;
  }
  showProblem(null);
  sized.disconnect();
  out.replaceChildren(...result.nodes);
  example.hidden = true;
  yours.hidden = false;
  yours.classList.remove("is-stale");
  zone.classList.add("has-result");
  wire(yours);
  say(COPY.ready(result.services, result.verdict));
}

let timer = 0;
textarea.addEventListener("input", (event) => {
  clearTimeout(timer);
  clearTimeout(announce);
  source = null;
  const pasted = (event as InputEvent).inputType === "insertFromPaste";
  if (pasted) void read(textarea.value, true);
  else
    timer = window.setTimeout(() => void read(textarea.value, false), PAUSE_MS);
});

// Several files dropped together are read as one, in the order Docker
// Compose would merge them: the main file, any others, then the overrides.
const rank = (name: string) =>
  /^(?:docker-)?compose\.ya?ml$/i.test(name)
    ? 0
    : /^(?:docker-)?compose\.override\.ya?ml$/i.test(name)
      ? 2
      : /\.override\./i.test(name)
        ? 3
        : 1;

initDropZone(
  zone,
  input,
  (files) => {
    if (!files.length) return;
    if (files.reduce((n, f) => n + f.size, 0) > MAX_BYTES) {
      showProblem(COPY.tooBig, false);
      say(COPY.tooBig);
      return;
    }
    const sorted = [...files].sort(
      (a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name),
    );
    void Promise.all(sorted.map((f) => f.text())).then((texts) => {
      clearTimeout(timer);
      // Each file opens with its name, so the page can say what it merged;
      // a "---" between them is how YAML separates documents.
      textarea.value =
        sorted.length === 1
          ? (texts[0] ?? "")
          : sorted
              .map((f, i) => {
                const text = (texts[i] ?? "").replace(/^---[ \t]*\r?\n/, "");
                return `# ${f.name}\n${text.endsWith("\n") ? text : `${text}\n`}`;
              })
              .join("---\n");
      source = sorted.length === 1 ? (sorted[0]?.name ?? null) : null;
      void read(textarea.value, true);
    });
  },
  { multiple: true },
);
