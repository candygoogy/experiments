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
import { initThemeSwitch } from "@exp/shared/theme-switch";

const themes = document.querySelector<HTMLElement>("[data-theme-switch]");
if (themes) initThemeSwitch(themes);

const zone = document.querySelector<HTMLLabelElement>(".drop");
const input = zone?.querySelector<HTMLInputElement>("input");
const example = document.querySelector<HTMLElement>("[data-example]");

// The reader and the cleaner (answer.ts) load once a file is on its way:
// when the pointer, a finger, the keyboard's focus or a dragged file
// reaches the page's drop zone, so they're usually here before the drop.
let work: Promise<typeof import("./answer")> | undefined;
const load = () => (work ??= import("./answer"));

if (zone && input) {
  for (const type of ["pointerenter", "touchstart", "focusin"]) {
    zone.addEventListener(type, () => void load(), {
      once: true,
      passive: true,
    });
  }
  document.addEventListener("dragenter", () => void load(), { once: true });
  initDropZone(
    zone,
    input,
    (files) => {
      // A dropped photo takes the example's place for good.
      example?.remove();
      void load().then(({ readAll }) => readAll(files));
    },
    { multiple: true },
  );
}
