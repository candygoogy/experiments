import "@exp/shared/tokens.css";
import "@exp/shared/fonts.css";
import "@exp/shared/base.css";
import "@exp/shared/shell.css";
import "@exp/shared/theme-switch.css";
import "@exp/shared/dropzone.css";
import "@exp/shared/work.css";
import "./logscope.css";
import { arrive } from "@exp/shared/arrive";
import { initDropZone } from "@exp/shared/dropzone";
import { initHeader } from "@exp/shared/header";
import { copy, fill } from "./copy.ts";
import { canonical } from "./known.ts";
import type { Group, Level, Result } from "./model.ts";
import { PAGE, renderAnswer, row, START_LEVELS } from "./render.ts";
import { groupName, groupPlain, isNoise, plainMessage } from "./summary.ts";
import type { FromWorker } from "./worker.ts";

initHeader();

const zone = document.querySelector<HTMLLabelElement>(".drop");
const input = zone?.querySelector<HTMLInputElement>("input");
const status = document.querySelector<HTMLElement>("[data-status]");
const answer = document.querySelector<HTMLElement>("[data-answer]");
const example = document.querySelector<HTMLElement>("[data-example]");
// The answer's column, labelled with the file's name once one is in.
const yours = document.querySelector<HTMLElement>("[data-yours]");
const yoursLabel = document.querySelector<HTMLElement>("#yours-label");

let worker: Worker | null = null;

const make = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// Several files dropped at once: the answer opens by naming the one it's
// for, and says so with it.
let oneFile: HTMLElement | null = null;

function show(nodes: Node[], said: string) {
  answer?.replaceChildren(...(oneFile ? [oneFile, ...nodes] : nodes));
  if (status) {
    status.textContent =
      oneFile && said ? `${oneFile.textContent ?? ""} ${said}` : said;
  }
}

function problem(lines: string[]) {
  const [first = "", ...rest] = lines;
  show(
    [
      make("p", "problem", first),
      ...rest.map((l) => make("p", "problem-how", l)),
    ],
    lines.join(" "),
  );
  arrive(answer);
}

/** Wires the filters of a drawn answer to its lists. */
function wire(result: Result) {
  const form = answer?.querySelector<HTMLFormElement>(".filters");
  const main = answer?.querySelector<HTMLOListElement>('[data-list="main"]');
  const noise = answer?.querySelector<HTMLOListElement>('[data-list="noise"]');
  const noiseHead = answer?.querySelector<HTMLElement>(".noise-head");
  const none = answer?.querySelector<HTMLElement>(".no-match");
  const more = answer?.querySelector<HTMLButtonElement>(".more");
  const count = form?.querySelector<HTMLElement>(".shown");
  if (!form || !main || !noise || !noiseHead || !none || !more || !count)
    return;

  const on = new Set<Level>(START_LEVELS);
  let limit = PAGE;
  // What each group can be found by, worked out once.
  const words = new Map<Group, string>();
  const findable = (g: Group) => {
    let text = words.get(g);
    if (text === undefined) {
      const { label, name } = groupName(g, result.kind);
      text = [
        label,
        name,
        plainMessage(g.message),
        groupPlain(g, result) ?? "",
        ...g.samples,
      ]
        .join("\n")
        .toLowerCase();
      words.set(g, text);
    }
    return text;
  };

  const apply = () => {
    const source =
      (form.elements.namedItem("source") as HTMLSelectElement | null)?.value ??
      "";
    const q = (
      (form.elements.namedItem("q") as HTMLInputElement | null)?.value ?? ""
    )
      .trim()
      .toLowerCase();
    const match = (g: Group) =>
      on.has(g.level) &&
      (!source ||
        (result.kind === "web"
          ? g.path === source
          : canonical(g.source) === source)) &&
      (!q || findable(g).includes(q));
    const shown = result.groups.filter(match);
    const problems = shown.filter((g) => !isNoise(g, result.kind));
    const quiet = shown.filter((g) => isNoise(g, result.kind));
    main.replaceChildren(
      ...problems.slice(0, limit).map((g) => row(document, g, result)),
    );
    noise.replaceChildren(...quiet.map((g) => row(document, g, result)));
    noiseHead.hidden = noise.hidden = !quiet.length;
    none.hidden = shown.length > 0;
    const left = problems.length - Math.min(limit, problems.length);
    more.hidden = left === 0;
    more.textContent = fill(copy.showMore, { n: Math.min(left, PAGE) });
    count.textContent = fill(shown.length === 1 ? copy.shownOne : copy.shown, {
      n: shown.length,
      total: result.groups.length,
    });
  };

  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      ".level-toggle",
    );
    const level = button?.dataset["level"] as Level | undefined;
    if (!button || !level) return;
    if (on.has(level)) on.delete(level);
    else on.add(level);
    button.setAttribute("aria-pressed", String(on.has(level)));
    limit = PAGE;
    apply();
  });
  form.addEventListener("input", () => {
    limit = PAGE;
    apply();
  });
  more.addEventListener("click", () => {
    limit += PAGE;
    apply();
  });
  apply();
}

function read(file: File, skipped: File[]) {
  example?.remove();
  zone?.classList.add("has-result");
  if (yoursLabel) yoursLabel.textContent = file.name;
  if (yours) yours.hidden = false;
  oneFile = skipped.length
    ? make("p", "one-file", fill(copy.oneAtATime, { name: file.name }))
    : null;
  worker?.terminate();
  const reading = make("p", "reading num", fill(copy.reading, { pct: 0 }));
  show([reading], "");
  const mine = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
  worker = mine;
  mine.addEventListener("message", (event: MessageEvent<FromWorker>) => {
    const message = event.data;
    if (message.type === "progress") {
      const pct = message.total
        ? Math.floor((message.read / message.total) * 100)
        : 100;
      reading.textContent = fill(copy.reading, { pct });
      return;
    }
    mine.terminate();
    if (worker === mine) worker = null;
    if (message.type === "problem") {
      problem(
        message.reason === "not-a-log" ? [copy.notALog] : [copy.unreadable],
      );
      return;
    }
    try {
      const { nodes, said } = renderAnswer(document, message.result, "answer");
      show(nodes, said);
      wire(message.result);
      arrive(answer);
    } catch {
      // Never left on "Reading the log… 100%".
      problem([copy.unreadable]);
    }
  });
  mine.addEventListener("error", () => {
    mine.terminate();
    problem([copy.unreadable]);
  });
  mine.postMessage(file);
}

if (zone && input) {
  initDropZone(zone, input, ([file], skipped) => {
    if (file) read(file, skipped);
  });
}
