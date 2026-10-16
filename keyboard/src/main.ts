import "@exp/shared/tokens.css";
import "@exp/shared/fonts.css";
import "@exp/shared/base.css";
import "@exp/shared/shell.css";
import "@exp/shared/theme-switch.css";
import "@exp/shared/work.css";
import "./keyboard.css";
import { initHeader } from "@exp/shared/header";
import { COPY, KEY_NAMES } from "./copy";
import {
  codesOf,
  LAYOUTS,
  type LayoutName,
  nameOf,
  withoutNumpad,
} from "./layouts";
import { KeyTracker } from "./tracker";
import { renderBoard } from "./view";

initHeader();

// A key held this long, with no release, may be stuck.
const HELD_MS = 3000;
// The progress is read out at most this often.
const ANNOUNCE_MS = 1000;

const find = <T extends Element>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`keyboard: ${selector} is missing`);
  return node;
};
const tool = find<HTMLElement>("#tool");
const area = find<HTMLElement>(".test");
const board = find<HTMLElement>(".board");
const start = find<HTMLButtonElement>(".start");
const hint = find<HTMLElement>(".hint");
const over = find<HTMLButtonElement>(".over");
const layoutButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-layout]"),
];
const progress = find<HTMLElement>(".progress");
const extra = find<HTMLElement>(".extra");
const tryIso = find<HTMLElement>(".try-iso");
const rollover = find<HTMLElement>(".rollover");
const findings = find<HTMLElement>(".findings");
const live = find<HTMLElement>(".live");

let layoutName: LayoutName = "iso";
const labels = new Map<string, string>();
let keys = new Map<string, SVGGElement>();
let total = 0;
let tracker = new KeyTracker(new Set());
let testing = false;
// Findings shown now: a key's latest double press, and keys held too long.
const chatter = new Map<string, number>();
const held = new Map<string, number>();
// New findings, read out once with the next progress line.
let news: string[] = [];
// Nothing is read out before the first key pressed while testing.
let heard = false;

// Touch only (a coarse pointer, and nothing that's fine or hovers): a
// phone, or a tablet without its keyboard. keyboard.css asks for a
// keyboard there, from the same queries, until a real key press shows
// one is connected. A touchscreen laptop has its trackpad, so it's not
// touch only.
const touchOnly = () =>
  matchMedia("(pointer: coarse) and (any-hover: none)").matches &&
  !matchMedia("(any-pointer: fine)").matches;
tool.dataset["mode"] = "idle";

// Below this width the whole board's legends would be too small to read
// (about 7px at 768px wide), so it's drawn without its number pad, which
// keeps the main block's keys at 36px or more. keyboard.css uses the same
// width for the board's aspect ratio.
const narrow = matchMedia("(max-width: 68.75rem)");
const layoutNow = () =>
  narrow.matches ? withoutNumpad(LAYOUTS[layoutName]) : LAYOUTS[layoutName];

const name = (code: string) => labels.get(code) ?? nameOf(code, layoutNow());

function sync(code: string) {
  const key = keys.get(code);
  if (!key) return;
  key.dataset["state"] = tracker.pressed.has(code)
    ? "down"
    : tracker.seen.has(code)
      ? "seen"
      : "idle";
  if (chatter.has(code) || held.has(code)) key.dataset["finding"] = "";
  else delete key.dataset["finding"];
}

function renderFindings() {
  const items = [
    ...[...chatter].map(([code, ms]) => COPY.chatter(name(code), ms)),
    ...[...held].map(([code, s]) => COPY.held(name(code), s)),
  ];
  const now = [...findings.children].map((li) => li.textContent);
  if (now.join("\n") === items.join("\n")) return;
  findings.replaceChildren(
    ...items.map((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      return li;
    }),
  );
}

let announced = -Infinity;
let announceTimer = 0;
const announce = () => {
  announceTimer = 0;
  announced = performance.now();
  live.textContent = [progress.textContent, ...news].join(" ");
  news = [];
};

function update() {
  progress.textContent = COPY.progress(tracker.seen.size, total);
  extra.textContent = tracker.extra.size ? COPY.extra(tracker.extra.size) : "";
  extra.hidden = tracker.extra.size === 0;
  // The key only ISO keyboards have, pressed while the drawing is ANSI.
  const iso = layoutName === "ansi" && tracker.extra.has("IntlBackslash");
  if (iso && tryIso.hidden) news.push(COPY.tryIso);
  tryIso.hidden = !iso;
  // Start over shows once there's something to start over from.
  const started =
    tracker.seen.size > 0 || tracker.extra.size > 0 || chatter.size > 0;
  if (!started && document.activeElement === over) {
    (testing ? area : start).focus();
  }
  over.hidden = !started;
  rollover.textContent = COPY.rollover(tracker.maxHeld);
  renderFindings();
  // Read out at most once a second, never per key.
  if (heard && !announceTimer) {
    const wait = ANNOUNCE_MS - (performance.now() - announced);
    if (wait <= 0) announce();
    else announceTimer = window.setTimeout(announce, wait);
  }
}

// Draws the active layout (without the number pad in a narrow window).
// Switching layout mid-test keeps what both drawings share: the keys
// tested, their double presses, the rollover.
function draw() {
  const layout = layoutNow();
  keys = renderBoard(board, layout, labels);
  board.toggleAttribute("data-compact", narrow.matches);
  const codes = codesOf(layout);
  total = codes.size;
  tracker = tracker.carryTo(codes);
  for (const code of chatter.keys()) {
    if (!codes.has(code)) chatter.delete(code);
  }
  held.clear();
  news = [];
  for (const code of keys.keys()) sync(code);
  for (const b of layoutButtons) {
    b.setAttribute("aria-pressed", String(b.dataset["layout"] === layoutName));
  }
  update();
}

// Nothing counts as held once the window loses the keyboard (Alt+Tab, the
// Win key's Start menu): their releases won't arrive.
function releaseAll() {
  const down = [...tracker.pressed];
  tracker.releaseAll();
  held.clear();
  for (const code of down) sync(code);
  update();
}

let heldTimer = 0;
const checkHeld = () => {
  const now = performance.now();
  let changed = false;
  for (const f of tracker.heldLongerThan(now, HELD_MS)) {
    const s = Math.floor(f.ms / 1000);
    if (held.get(f.code) !== s) {
      if (!held.has(f.code)) news.push(COPY.held(name(f.code), s));
      held.set(f.code, s);
      changed = true;
      sync(f.code);
    }
  }
  if (changed) update();
};

function startTesting() {
  testing = true;
  tool.dataset["mode"] = "testing";
  start.hidden = true;
  hint.hidden = false;
  area.setAttribute("role", "application");
  area.setAttribute("aria-label", COPY.testing);
  area.focus();
  heldTimer = window.setInterval(checkHeld, 250);
}

function stopTesting() {
  testing = false;
  tool.dataset["mode"] = "idle";
  hint.hidden = true;
  start.hidden = false;
  area.removeAttribute("role");
  area.removeAttribute("aria-label");
  window.clearInterval(heldTimer);
  start.focus();
}

addEventListener(
  "keydown",
  (e) => {
    if (!("keyboard" in tool.dataset) && touchOnly()) {
      if (!e.code || e.code === "Unidentified") return;
      // A keyboard after all: the controls take the note's place, and
      // Start has the focus, so Enter starts. The key itself does nothing
      // else (Enter mustn't press Start too); shortcuts still work.
      tool.dataset["keyboard"] = "";
      if (!e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault();
      start.focus();
      return;
    }
    if (!testing) return;
    // Nothing the key would normally do happens while testing (Tab, the
    // arrows, Space, the F keys); Esc is tested too, then stops testing.
    e.preventDefault();
    heard = true;
    const found = tracker.down(e.code, e.timeStamp, e.repeat);
    for (const f of found) {
      if (f.kind !== "chatter") continue;
      if (!chatter.has(f.code)) news.push(COPY.chatter(name(f.code), f.ms));
      chatter.set(f.code, f.ms);
    }
    sync(e.code);
    // Alt Gr's own Left Ctrl press may just have been taken back.
    if (e.code === "AltRight") sync("ControlLeft");
    update();
    if (e.code === "Escape" && !e.repeat) stopTesting();
  },
  true,
);

addEventListener(
  "keyup",
  (e) => {
    const wasDown = tracker.pressed.has(e.code);
    if (!testing && !wasDown) return;
    if (testing) e.preventDefault();
    tracker.up(e.code, e.timeStamp);
    if (held.delete(e.code)) renderFindings();
    sync(e.code);
    update();
  },
  true,
);

addEventListener("blur", releaseAll);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseAll();
});

start.addEventListener("click", startTesting);
over.addEventListener("click", () => {
  tracker.reset();
  chatter.clear();
  held.clear();
  news = [];
  for (const code of keys.keys()) sync(code);
  update();
});
narrow.addEventListener("change", draw);
for (const b of layoutButtons) {
  b.addEventListener("click", () => {
    const next = b.dataset["layout"];
    if ((next !== "iso" && next !== "ansi") || next === layoutName) return;
    layoutName = next;
    draw();
  });
}

// The browser's own layout map (Chromium): the legends as this keyboard
// types them, and ISO or ANSI by whether it has the key beside left Shift.
type LayoutMap = ReadonlyMap<string, string>;
const keyboardApi = (
  navigator as Navigator & {
    keyboard?: { getLayoutMap?: () => Promise<LayoutMap> };
  }
).keyboard;
async function layoutMap(): Promise<LayoutMap | undefined> {
  if (!keyboardApi?.getLayoutMap) return undefined;
  try {
    return await Promise.race([
      keyboardApi.getLayoutMap(),
      new Promise<undefined>((r) => setTimeout(r, 300)),
    ]);
  } catch {
    return undefined;
  }
}

const map = await layoutMap();
if (map?.size) {
  layoutName = map.has("IntlBackslash") ? "iso" : "ansi";
  for (const [code, char] of map) {
    if (KEY_NAMES[code] || !char) continue;
    labels.set(code, char.length === 1 ? char.toUpperCase() : char);
  }
}
draw();
