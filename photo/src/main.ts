import "@exp/shared/tokens.css";
import "@exp/shared/fonts.css";
import "@exp/shared/base.css";
import "@exp/shared/shell.css";
import "@exp/shared/theme-switch.css";
import "@exp/shared/dropzone.css";
import "@exp/shared/disclosure.css";
import "@exp/shared/work.css";
import "./photo.css";
import { initDropZone } from "@exp/shared/dropzone";
import { initHeader } from "@exp/shared/header";
import { reloadIfGone, settle } from "@exp/shared/stale";

initHeader();

const zone = document.querySelector<HTMLLabelElement>(".drop");
const input = zone?.querySelector<HTMLInputElement>("input");
const example = document.querySelector<HTMLElement>("[data-example]");

// The reader and the cleaner (answer.ts) load once a file is on its way:
// when the pointer, a finger, the keyboard's focus or a dragged file
// reaches the page's drop zone, so they're usually here before the drop.
// A load that fails is forgotten, so the next drop asks for it again; one
// that works lets a later deploy's missing file reload the page again.
let work: Promise<typeof import("./answer")> | undefined;
const load = () =>
  (work ??= import("./answer").then(
    (module) => {
      settle();
      return module;
    },
    (error: unknown) => {
      work = undefined;
      throw error;
    },
  ));
// An early load that fails is tried again by the drop, which says so if
// it fails too.
const preload = () => void load().catch(() => undefined);

/** The drop's photos weren't read: the reader didn't load, or broke. Said
 * in the answer's place, in words index.html holds (copy.wrong), so it
 * needs nothing that might not have loaded. A missing file reloads the
 * page once instead (shared/stale.ts). */
function failed(error: unknown) {
  if (reloadIfGone(error)) return;
  const yours = document.querySelector<HTMLElement>("[data-yours]");
  const answer = yours?.querySelector<HTMLElement>("[data-answer]");
  const label = yours?.querySelector<HTMLElement>("#yours-label");
  const status = document.querySelector<HTMLElement>("[data-status]");
  const text = answer?.dataset["wrong"] ?? "";
  if (!yours || !answer) return;
  const line = document.createElement("p");
  line.className = "wrong";
  line.textContent = text;
  answer.replaceChildren(line);
  const name = document.querySelector(".input .label")?.textContent ?? "";
  if (label) label.textContent = name;
  yours.hidden = false;
  zone?.classList.add("has-result");
  if (status) status.textContent = text;
}

// Each drop counts; a failure only speaks for the latest one.
let drops = 0;

if (zone && input) {
  for (const type of ["pointerenter", "touchstart", "focusin"]) {
    zone.addEventListener(type, preload, { once: true, passive: true });
  }
  document.addEventListener("dragenter", preload, { once: true });
  initDropZone(
    zone,
    input,
    (files) => {
      // A dropped photo takes the example's place for good.
      example?.remove();
      const mine = ++drops;
      load()
        .then(({ readAll }) => readAll(files))
        .catch((error: unknown) => {
          if (mine === drops) failed(error);
        });
    },
    { multiple: true },
  );
}
