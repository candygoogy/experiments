import "@exp/shared/tokens.css";
import "@exp/shared/fonts.css";
import "@exp/shared/base.css";
import "@exp/shared/shell.css";
import "@exp/shared/theme-switch.css";
import "@exp/shared/work.css";
import "./mail.css";
import { arrive } from "@exp/shared/arrive";
import { initHeader } from "@exp/shared/header";
import { COPY } from "./copy";
import { normalizeDomain, reservedName } from "./normalize";

initHeader();

const find = <T extends Element>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`mail: ${selector} is missing`);
  return node;
};
const form = find<HTMLFormElement>("form.ask");
const field = find<HTMLInputElement>("#domain");
const problem = find<HTMLElement>("#problem");
const example = find<HTMLElement>(".pane.example");
const yours = find<HTMLElement>(".pane.yours");
const label = find<HTMLElement>("#yours-label");
const out = find<HTMLElement>(".pane.yours .out");
const live = find<HTMLElement>(".live");

// The line under the field. Asking frees its height; anything that comes
// back later (the answer, or a failure) keeps at least the height it has,
// so nothing below it moves long after the click.
const note = (text: string | null) => {
  problem.style.minHeight = "";
  problem.hidden = text === null;
  problem.textContent = text ?? "";
};
const later = (text: string) => {
  if (!problem.hidden) problem.style.minHeight = `${problem.offsetHeight}px`;
  problem.textContent = text;
};

// A check that fails leaves the last answer where it was, dimmed and
// labelled as the last one checked, so it can't be read as the answer for
// what was just typed. Nothing moves.
let shown: string | null = null;
const stale = () => {
  if (shown === null) return;
  yours.classList.add("is-stale");
  label.textContent = COPY.lastChecked(shown);
};

// A new ask calls off the check before it, so its lookups stop and stop
// holding places in the resolver's line. The run counter still guards
// against an answer that was already on its way.
let run = 0;
let current: AbortController | null = null;
form.addEventListener("submit", (event) => {
  event.preventDefault();
  current?.abort();
  current = null;
  const domain = normalizeDomain(field.value);
  // Not a domain, or a name that's never in public DNS: said here, and
  // nothing is sent anywhere.
  const refusal = !domain
    ? COPY.notDomain
    : reservedName(domain)
      ? COPY.reserved
      : null;
  if (!domain || refusal !== null) {
    ++run;
    note(refusal);
    field.setAttribute("aria-invalid", "true");
    live.textContent = refusal;
    stale();
    field.focus();
    return;
  }
  field.removeAttribute("aria-invalid");
  const mine = ++run;
  current = new AbortController();
  const { signal } = current;
  note(COPY.looking(domain));
  void import("./check")
    .then(({ check }) => check(domain, signal))
    .then((result) => {
      if (mine !== run) return;
      if ("problem" in result) {
        later(result.problem);
        live.textContent = result.problem;
        stale();
        return;
      }
      later(COPY.checked(domain));
      shown = domain;
      label.textContent = domain;
      yours.classList.remove("is-stale");
      out.replaceChildren(...result.nodes);
      example.hidden = true;
      yours.hidden = false;
      arrive(yours);
      live.textContent = COPY.ready(domain, result.verdict);
    })
    // The check's code didn't load, or something else broke: say so
    // calmly. The button stays as it was, ready for another try.
    .catch(() => {
      if (mine !== run) return;
      later(COPY.wrong);
      live.textContent = COPY.wrong;
      stale();
    });
});
