import "@exp/shared/tokens.css";
import "@exp/shared/fonts.css";
import "@exp/shared/base.css";
import "@exp/shared/shell.css";
import "@exp/shared/theme-switch.css";
import "@exp/shared/disclosure.css";
import "@exp/shared/work.css";
import "./subnet.css";
import { initThemeSwitch } from "@exp/shared/theme-switch";
import { COPY, MAP } from "./copy";
import { drawStrip } from "./draw";
import { end, hosts, cidr, v4, type Range4 } from "./ip";
import { parsePlan, type Entry } from "./plan";
import { label, renderPlan } from "./render";
import { addSplit, MAX_PARTS, splitEqual, splitFit, type Split } from "./split";
import { MAX_STRIPS, strips, type Strip } from "./strip";

const themes = document.querySelector<HTMLElement>("[data-theme-switch]");
if (themes) initThemeSwitch(themes);

const find = <T extends Element>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`subnet: ${selector} is missing`);
  return node;
};
const area = find<HTMLTextAreaElement>("#plan");
const example = find<HTMLElement>(".pane.example");
const yours = find<HTMLElement>(".pane.yours");
const exampleOut = find<HTMLElement>(".pane.example .out");
const out = find<HTMLElement>(".pane.yours .out");
const live = find<HTMLElement>(".live");

// Typing waits this long for a pause before the answer is drawn, and
// this long before the verdict is read out.
const PAUSE_MS = 150;
const SAY_MS = 1000;
// Phones draw the strips down the page (the same width as the CSS).
const phone = window.matchMedia("(max-width: 40rem)");

// What each pane shows now, for drawing (again) and for Split.
interface Shown {
  entries: Entry[];
  // The strips drawn, worked out once per plan.
  strips: Strip[];
  id: string;
  root: HTMLElement;
  preview?: { index: number; parts: Range4[] } | undefined;
}
let exampleShown: Shown | null = null;
let shown: Shown | null = null;

function draw(view: Shown) {
  const names = view.entries.map(label);
  // Every box measured first, then every strip drawn: one layout.
  const boxes = view.strips.map((_, i) => {
    const svg = document.getElementById(`${view.id}-strip-${i}`);
    return svg instanceof SVGSVGElement
      ? { svg, box: svg.getBoundingClientRect() }
      : null;
  });
  const down = phone.matches;
  const p = view.preview;
  const target = p ? view.entries[p.index] : undefined;
  view.strips.forEach((s, i) => {
    const found = boxes[i];
    if (!found) return;
    const inStrip =
      target?.net.v === 4 &&
      target.net.range.start >= s.block.start &&
      end(target.net.range) <= end(s.block);
    drawStrip(
      found.svg,
      found.box,
      down,
      s,
      {
        names,
        together: MAP.together,
        free: MAP.free,
        freeSize: MAP.freeSize,
        docker: MAP.docker,
        first: v4(s.block.start),
        last: v4(end(s.block)),
      },
      inStrip ? p?.parts : undefined,
    );
  });
}

// Strips follow their boxes' size (the window, the fonts, a phone turned).
new ResizeObserver(() => {
  if (exampleShown && !example.hidden) draw(exampleShown);
  if (shown && !yours.hidden) draw(shown);
}).observe(find<HTMLElement>(".work"));

// The example is in the page already; its strips are drawn after the
// first paint.
requestAnimationFrame(() => {
  const { entries } = parsePlan(exampleOut.dataset["plan"] ?? "");
  exampleShown = {
    entries,
    strips: strips(entries).slice(0, MAX_STRIPS),
    id: "example",
    root: exampleOut,
  };
  draw(exampleShown);
});

// The line the caret is on, while typing: a line half typed isn't a bad
// line yet. It counts once the caret leaves it, or after a pause.
const caretLine = () =>
  document.activeElement === area
    ? area.value.slice(0, area.selectionStart).split("\n").length
    : null;

// Read out: cleared first, then set on the next frame, so the same words
// said twice are still heard.
function speak(text: string) {
  live.textContent = "";
  requestAnimationFrame(() => {
    live.textContent = text;
  });
}

let said = "";
let verdictNow = "";
// The line held back from the last answer, when it had a bad line on it.
let held: number | null = null;

function update(hold: number | null = null) {
  const text = area.value;
  held = null;
  if (!text.trim()) {
    shown = null;
    out.replaceChildren();
    yours.hidden = true;
    example.hidden = false;
    said = "";
    verdictNow = "";
    // Back to the example: its verdict is read out.
    speak(exampleOut.querySelector(".verdict")?.textContent ?? "");
    if (exampleShown) draw(exampleShown);
    return;
  }
  const plan = parsePlan(text);
  const bad = plan.bad.filter((b) => b.line !== hold);
  if (bad.length < plan.bad.length) held = hold;
  const { nodes, verdict, strips } = renderPlan(
    document,
    plan.entries,
    bad,
    "yours",
  );
  out.replaceChildren(...nodes);
  example.hidden = true;
  yours.hidden = false;
  shown = { entries: plan.entries, strips, id: "yours", root: out };
  verdictNow = verdict;
  draw(shown);
}

// The verdict is read out once typing has paused, and only when it
// changed: not at every keystroke.
function say() {
  if (held !== null) update();
  if (verdictNow && verdictNow !== said) {
    said = verdictNow;
    speak(verdictNow);
  }
}

let timer = 0;
let sayTimer = 0;
area.addEventListener("input", () => {
  clearTimeout(timer);
  clearTimeout(sayTimer);
  timer = window.setTimeout(() => update(caretLine()), PAUSE_MS);
  sayTimer = window.setTimeout(say, SAY_MS);
});

// The caret leaving a held line (arrows, a click, leaving the box): the
// line counts now.
const release = () => {
  if (held !== null && caretLine() !== held) {
    clearTimeout(timer);
    update(caretLine());
  }
};
document.addEventListener("selectionchange", release);
area.addEventListener("blur", release);

// Split: one panel at a time, opened in place under a range's details.
const make = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

function closePanels() {
  for (const panel of out.querySelectorAll(".split-panel")) panel.remove();
  for (const b of out.querySelectorAll(".split[aria-expanded='true']")) {
    b.setAttribute("aria-expanded", "false");
  }
  if (shown?.preview) {
    shown.preview = undefined;
    draw(shown);
  }
}

function openPanel(button: HTMLButtonElement, index: number) {
  const view = shown;
  const entry = view?.entries[index];
  if (!view || !entry || entry.net.v !== 4) return;
  const range = entry.net.range;
  const panel = make("div", "split-panel");
  panel.id = `split-${index}`;
  const ways = make("div", "split-ways");
  ways.setAttribute("role", "group");
  ways.setAttribute("aria-label", COPY.splitInto);
  ways.append(make("span", "", COPY.splitInto));
  const choices = ([2, 4, 8, 16] as const).map((n) => {
    const b = make("button", "", String(n));
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => {
      fit.value = "";
      choose(b, splitEqual(range, n));
    });
    return b;
  });
  ways.append(...choices);
  const fitLabel = make("label", "fit");
  const fit = make("input");
  fit.inputMode = "numeric";
  fit.autocomplete = "off";
  fitLabel.append(`${COPY.fit} `, fit, ` ${COPY.devices}`);
  ways.append(fitLabel);
  const result = make("div", "split-result");
  result.setAttribute("aria-live", "polite");
  panel.append(ways, result);

  let parts: Range4[] = [];
  const choose = (
    pressed: HTMLButtonElement | null,
    split: Split | { problem: "notWhole" },
  ) => {
    for (const b of choices) {
      b.setAttribute("aria-pressed", String(b === pressed));
    }
    result.replaceChildren();
    parts = [];
    if ("problem" in split) {
      result.append(
        make(
          "p",
          "split-problem",
          split.problem === "tooMany"
            ? COPY.tooMany(MAX_PARTS)
            : split.problem === "tooBig"
              ? COPY.tooBig
              : split.problem === "notWhole"
                ? COPY.notWhole
                : COPY.tooSmall,
        ),
      );
    } else if (split.parts.length) {
      parts = split.parts;
      const list = make("ul", "split-list");
      for (const p of parts) {
        list.append(make("li", "", COPY.part(cidr(p), hosts(p).count)));
      }
      const add = make("button", "split-add", COPY.add(parts.length));
      add.type = "button";
      add.addEventListener("click", () => {
        const name = entry.name;
        area.value = addSplit(area.value, entry.line, name, parts);
        clearTimeout(timer);
        clearTimeout(sayTimer);
        update();
        said = verdictNow;
        speak(COPY.added(parts.length, label(entry)));
        // Back to the range, now with its parts under it.
        const heading = out.querySelector<HTMLElement>(
          `.ranges > li[data-index="${index}"] .name`,
        );
        heading?.setAttribute("tabindex", "-1");
        heading?.focus();
      });
      result.append(list, add);
    }
    view.preview = parts.length ? { index, parts } : undefined;
    draw(view);
  };
  fit.addEventListener("input", () => {
    const typed = fit.value.trim();
    // Emptied: nothing chosen, nothing to add.
    if (!typed) {
      choose(null, { parts: [] });
      return;
    }
    if (!/^\d+$/.test(typed) || Number(typed) < 1) {
      choose(null, { problem: "notWhole" });
      return;
    }
    choose(null, splitFit(range, Number(typed)));
  });
  // Escape closes the panel and goes back to its Split button.
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closePanels();
    button.focus();
  });
  button.setAttribute("aria-expanded", "true");
  button.setAttribute("aria-controls", panel.id);
  button.after(panel);
  choices[0]?.focus();
}

out.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>(".split");
  if (!button) return;
  const open = button.getAttribute("aria-expanded") === "true";
  closePanels();
  if (open) return;
  const li = button.closest<HTMLElement>("li[data-index]");
  openPanel(button, Number(li?.dataset["index"]));
});
