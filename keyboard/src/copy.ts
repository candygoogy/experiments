// Every word the keyboard check shows, in one place.

export const COPY = {
  title: "Keyboard check",
  // The meta description.
  description:
    "Press every key and watch it light up on a drawn keyboard, to find dead, stuck and double-typing keys.",
  noscript: "This tool needs JavaScript. It runs entirely in your browser.",
  intro:
    "Press every key and watch it light up. Find the dead ones, the stuck ones, and the ones that type twice.",
  start: "Start testing",
  stopHint: "Press Esc to stop testing.",
  // A touch-only device (a phone, a tablet without its keyboard), until
  // the first key press from a connected keyboard.
  phoneTitle: "This needs a physical keyboard",
  phone:
    "Connect one by Bluetooth or USB, then press any key. Or open this page on a computer.",
  phoneWhy: "The on-screen keyboard can’t be tested here.",
  soFar: "So far",
  findings: "Findings",
  limits:
    "Windows keeps the Win key and Print Screen partly to itself, and Fn never reaches the browser.",
  avoid: "Alt+F4 and Ctrl+W still close the page, so leave them out.",
  // A narrow window draws the board without its number pad.
  narrow: "Widen the window to test the number pad too.",
  layoutLabel: "Layout",
  layouts: { iso: "ISO", ansi: "ANSI" },
  startOver: "Start over",
  privacy: "Runs in your browser. Nothing you type here leaves it.",
  chatter: (key: string, ms: number) =>
    `${key} registered twice in a row, ${ms} ms apart. That’s the classic sign of a worn switch.`,
  held: (key: string, s: number) =>
    `${key} has been held for ${s} seconds. If you’re not pressing it, it may be stuck.`,
  rollover: (n: number) => `Most keys held at once: ${n}.`,
  progress: (pressed: number, total: number) =>
    `${pressed} of ${total} keys pressed.`,
  // Keys the browser saw that aren't on the drawing (laptop or language
  // keys).
  extra: (n: number) =>
    n === 1
      ? "Also 1 key that isn’t on this drawing."
      : `Also ${n} keys that aren’t on this drawing.`,
  // The ISO-only key (beside left Shift) pressed while the drawing is
  // ANSI.
  tryIso:
    "Your keyboard has the extra key next to left Shift, so it’s probably ISO: try that layout.",
  // The test area's name while testing (for screen readers).
  testing: "Keyboard test running. Press Esc to stop testing.",
} as const;

// Right Alt, as each layout's keycaps print it.
export const RIGHT_ALT = { iso: "Alt Gr", ansi: "Alt" } as const;

// The names drawn on keys that don't type a character, by
// KeyboardEvent.code (Right Alt is RIGHT_ALT, by layout).
export const KEY_NAMES: Readonly<Record<string, string>> = {
  Escape: "Esc",
  PrintScreen: "Prt sc",
  ScrollLock: "Scr lk",
  Pause: "Pause",
  Backspace: "Backspace",
  Tab: "Tab",
  CapsLock: "Caps lock",
  Enter: "Enter",
  ShiftLeft: "Shift",
  ShiftRight: "Shift",
  ControlLeft: "Ctrl",
  ControlRight: "Ctrl",
  MetaLeft: "Win",
  MetaRight: "Win",
  AltLeft: "Alt",
  ContextMenu: "Menu",
  Space: "Space",
  Insert: "Ins",
  Delete: "Del",
  Home: "Home",
  End: "End",
  PageUp: "Pg up",
  PageDown: "Pg dn",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  NumLock: "Num",
  NumpadEnter: "Enter",
};
