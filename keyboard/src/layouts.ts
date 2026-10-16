// The drawn keyboards: full size, ISO and ANSI, as rows of keys matched by
// KeyboardEvent.code (the physical key, whatever the language layout).
// Widths and heights are in key units (1 = a letter key). Every row spans
// the whole board, 23 units: the main block (15), the navigation keys (3)
// and the numpad (4), with half-unit gaps (18.5 without the numpad), and
// blank spacers (code "") where a row has no key, including under keys two
// rows tall. The legends are fallbacks (Italian on ISO, US on ANSI); the
// browser's own layout map replaces them where it has one.
import { KEY_NAMES, RIGHT_ALT } from "./copy";

export interface Key {
  code: string;
  label: string;
  w?: number;
  h?: number;
  // A two-row key whose lower half starts this far in from its left edge
  // (the ISO Enter).
  lowerInset?: number;
  // The browser only sees it partly (Windows keeps it, or only reports the
  // release).
  partial?: boolean;
}

export type LayoutName = "iso" | "ansi";

const key = (code: string, label?: string, w?: number): Key => {
  const k: Key = { code, label: label ?? KEY_NAMES[code] ?? code };
  if (w !== undefined) k.w = w;
  return k;
};
const gap = (w: number): Key => ({ code: "", label: "", w });
const letters = (s: string) => [...s].map((l) => key(`Key${l}`, l));
const partial = (k: Key): Key => ({ ...k, partial: true });
const tall = (k: Key, lowerInset?: number): Key => ({
  ...k,
  h: 2,
  ...(lowerInset === undefined ? {} : { lowerInset }),
});

// The navigation keys and the numpad, row by row (the same on both).
const fRowRight = [
  gap(0.5),
  partial(key("PrintScreen")),
  key("ScrollLock"),
  key("Pause"),
  gap(0.5),
  gap(4),
];
const right = [
  [
    gap(0.5),
    key("Insert"),
    key("Home"),
    key("PageUp"),
    gap(0.5),
    key("NumLock"),
    key("NumpadDivide", "/"),
    key("NumpadMultiply", "*"),
    key("NumpadSubtract", "−"),
  ],
  [
    gap(0.5),
    key("Delete"),
    key("End"),
    key("PageDown"),
    gap(0.5),
    key("Numpad7", "7"),
    key("Numpad8", "8"),
    key("Numpad9", "9"),
    tall(key("NumpadAdd", "+")),
  ],
  [
    gap(0.5),
    gap(3),
    gap(0.5),
    key("Numpad4", "4"),
    key("Numpad5", "5"),
    key("Numpad6", "6"),
    gap(1),
  ],
  [
    gap(0.5),
    gap(1),
    key("ArrowUp"),
    gap(1),
    gap(0.5),
    key("Numpad1", "1"),
    key("Numpad2", "2"),
    key("Numpad3", "3"),
    tall(key("NumpadEnter")),
  ],
  [
    gap(0.5),
    key("ArrowLeft"),
    key("ArrowDown"),
    key("ArrowRight"),
    gap(0.5),
    key("Numpad0", "0", 2),
    key("NumpadDecimal", "."),
    gap(1),
  ],
];

const fRow = [
  key("Escape"),
  gap(1),
  ...["F1", "F2", "F3", "F4"].map((f) => key(f, f)),
  gap(0.5),
  ...["F5", "F6", "F7", "F8"].map((f) => key(f, f)),
  gap(0.5),
  ...["F9", "F10", "F11", "F12"].map((f) => key(f, f)),
  ...fRowRight,
];

const digits = [..."1234567890"].map((d) => key(`Digit${d}`, d));
// Right Alt is named by the layout (RIGHT_ALT in copy.ts).
const bottom = (rightAlt: string) => [
  key("ControlLeft", undefined, 1.25),
  partial(key("MetaLeft", undefined, 1.25)),
  key("AltLeft", undefined, 1.25),
  key("Space", "", 6.25),
  key("AltRight", rightAlt, 1.25),
  partial(key("MetaRight", undefined, 1.25)),
  key("ContextMenu", undefined, 1.25),
  key("ControlRight", undefined, 1.25),
];

const iso: Key[][] = [
  fRow,
  [
    key("Backquote", "\\"),
    ...digits,
    key("Minus", "'"),
    key("Equal", "ì"),
    key("Backspace", undefined, 2),
    ...(right[0] ?? []),
  ],
  [
    key("Tab", undefined, 1.5),
    ...letters("QWERTYUIOP"),
    key("BracketLeft", "è"),
    key("BracketRight", "+"),
    tall(key("Enter", undefined, 1.5), 0.25),
    ...(right[1] ?? []),
  ],
  [
    key("CapsLock", undefined, 1.75),
    ...letters("ASDFGHJKL"),
    key("Semicolon", "ò"),
    key("Quote", "à"),
    key("Backslash", "ù"),
    gap(1.25),
    ...(right[2] ?? []),
  ],
  [
    key("ShiftLeft", undefined, 1.25),
    key("IntlBackslash", "<"),
    ...letters("ZXCVBNM"),
    key("Comma", ","),
    key("Period", "."),
    key("Slash", "-"),
    key("ShiftRight", undefined, 2.75),
    ...(right[3] ?? []),
  ],
  [...bottom(RIGHT_ALT.iso), ...(right[4] ?? [])],
];

const ansi: Key[][] = [
  fRow,
  [
    key("Backquote", "`"),
    ...digits,
    key("Minus", "-"),
    key("Equal", "="),
    key("Backspace", undefined, 2),
    ...(right[0] ?? []),
  ],
  [
    key("Tab", undefined, 1.5),
    ...letters("QWERTYUIOP"),
    key("BracketLeft", "["),
    key("BracketRight", "]"),
    key("Backslash", "\\", 1.5),
    ...(right[1] ?? []),
  ],
  [
    key("CapsLock", undefined, 1.75),
    ...letters("ASDFGHJKL"),
    key("Semicolon", ";"),
    key("Quote", "'"),
    key("Enter", undefined, 2.25),
    ...(right[2] ?? []),
  ],
  [
    key("ShiftLeft", undefined, 2.25),
    ...letters("ZXCVBNM"),
    key("Comma", ","),
    key("Period", "."),
    key("Slash", "/"),
    key("ShiftRight", undefined, 2.75),
    ...(right[3] ?? []),
  ],
  [...bottom(RIGHT_ALT.ansi), ...(right[4] ?? [])],
];

export const LAYOUTS: Record<LayoutName, Key[][]> = { iso, ansi };

// Where the number pad starts on every row: the main block (15), a gap
// (0.5) and the navigation keys (3).
const NUMPAD_AT = 18.5;

/** The layout without its number pad (or the spacers beside it), for a
 * window too narrow to draw all of it at a readable size. */
export const withoutNumpad = (layout: Key[][]): Key[][] =>
  layout.map((row) => {
    let x = 0;
    return row.filter((k) => {
      const at = x;
      x += k.w ?? 1;
      return at < NUMPAD_AT;
    });
  });

/** A layout's width in key units (every row spans it). */
export const widthOf = (layout: Key[][]): number =>
  (layout[0] ?? []).reduce((w, k) => w + (k.w ?? 1), 0);

// Every key's code on a layout (spacers left out).
export const codesOf = (layout: Key[][]): Set<string> =>
  new Set(layout.flat().flatMap((k) => (k.code ? [k.code] : [])));

// What to call a key in a sentence ("Space registered twice…").
export const nameOf = (code: string, layout?: Key[][]): string =>
  KEY_NAMES[code] ?? layout?.flat().find((k) => k.code === code)?.label ?? code;

export interface Placed {
  key: Key;
  x: number;
  row: number;
}

// Each key with its left edge (in units) and its row. Spacers are left out.
export const place = (layout: Key[][]): Placed[] =>
  layout.flatMap((row, r) => {
    let x = 0;
    return row.flatMap((k) => {
      const at = x;
      x += k.w ?? 1;
      return k.code ? [{ key: k, x: at, row: r }] : [];
    });
  });
