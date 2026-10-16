// What the keyboard has done so far: keys held now, keys seen, and the
// findings (a key registering twice too fast, a key held too long). Pure
// state, no DOM; times are milliseconds (KeyboardEvent.timeStamp).

export type Finding =
  | { kind: "chatter"; code: string; ms: number }
  | { kind: "held"; code: string; ms: number };

// A press this soon after the same key's release is the switch bouncing,
// not a second press.
export const CHATTER_MS = 30;
// On Windows, Alt Gr also sends a Left Ctrl press at the same moment (it's
// Ctrl+Alt underneath). A Left Ctrl press this close to an Alt Gr press is
// that, not a real one.
const ALTGR_MS = 5;
// Keys that only ever report their release (Print Screen on Windows).
const RELEASE_ONLY = new Set(["PrintScreen"]);
// Codes that name no physical key: nothing to place or count.
const unplaceable = (code: string) => !code || code === "Unidentified";

export class KeyTracker {
  readonly #codes: ReadonlySet<string>;
  readonly #pressed = new Map<string, number>(); // code → when it went down
  readonly #lastUp = new Map<string, number>();
  readonly #seen = new Set<string>();
  readonly #extra = new Set<string>();
  #maxHeld = 0;
  // A Left Ctrl press that turned out to be Alt Gr's, until its release.
  #ghostCtrl = false;

  constructor(layoutCodes: ReadonlySet<string>) {
    this.#codes = layoutCodes;
  }

  get pressed(): ReadonlySet<string> {
    return new Set(this.#pressed.keys());
  }

  get seen(): ReadonlySet<string> {
    return this.#seen;
  }

  get extra(): ReadonlySet<string> {
    return this.#extra;
  }

  get maxHeld(): number {
    return this.#maxHeld;
  }

  down(code: string, t: number, repeat: boolean): Finding[] {
    // Auto-repeat is the key still held: not a new press. A key with no
    // code (or an unidentified one) can't be placed.
    if (repeat || unplaceable(code)) return [];
    // A new Left Ctrl press means any earlier ghost's release is never
    // coming (it went to another window). If this press is itself Alt Gr's,
    // the Right Alt press right after marks it again.
    if (code === "ControlLeft") this.#ghostCtrl = false;
    if (code === "AltRight") this.#dropAltGrCtrl(t);
    const findings: Finding[] = [];
    const up = this.#lastUp.get(code);
    if (up !== undefined && t - up < CHATTER_MS && !this.#pressed.has(code)) {
      findings.push({ kind: "chatter", code, ms: Math.round(t - up) });
    }
    if (!this.#pressed.has(code)) this.#pressed.set(code, t);
    this.#mark(code);
    this.#maxHeld = Math.max(this.#maxHeld, this.#pressed.size);
    return findings;
  }

  up(code: string, t: number): void {
    if (unplaceable(code)) return;
    if (code === "ControlLeft" && this.#ghostCtrl) {
      this.#ghostCtrl = false;
      return;
    }
    // A release counts only for a press seen here (not, say, the Enter
    // that started the test), except for keys that only report releases.
    if (!this.#pressed.has(code) && !RELEASE_ONLY.has(code)) return;
    this.#pressed.delete(code);
    this.#lastUp.set(code, t);
    this.#mark(code);
  }

  // The window lost focus: its key releases won't arrive, so nothing counts
  // as held any more (and no false "stuck" warning follows). An Alt Gr
  // ghost stays marked, so its Left Ctrl release, if it still comes, is
  // swallowed rather than counted.
  releaseAll(): void {
    this.#pressed.clear();
  }

  /** The same test on another drawing: what both layouts share carries
   * over (tested keys, their last releases, the rollover); keys only on
   * the old drawing are dropped, and extra keys on neither stay extra. */
  carryTo(layoutCodes: ReadonlySet<string>): KeyTracker {
    const next = new KeyTracker(layoutCodes);
    for (const code of this.#seen) {
      if (layoutCodes.has(code)) next.#seen.add(code);
    }
    for (const code of this.#extra) {
      if (!layoutCodes.has(code)) next.#extra.add(code);
    }
    for (const [code, t] of this.#lastUp) {
      if (layoutCodes.has(code) && this.#codes.has(code))
        next.#lastUp.set(code, t);
    }
    next.#maxHeld = this.#maxHeld;
    return next;
  }

  heldLongerThan(now: number, ms: number): Finding[] {
    const findings: Finding[] = [];
    for (const [code, since] of this.#pressed) {
      if (now - since >= ms) {
        findings.push({ kind: "held", code, ms: Math.round(now - since) });
      }
    }
    return findings;
  }

  reset(): void {
    this.#pressed.clear();
    this.#lastUp.clear();
    this.#seen.clear();
    this.#extra.clear();
    this.#maxHeld = 0;
    this.#ghostCtrl = false;
  }

  #mark(code: string) {
    (this.#codes.has(code) ? this.#seen : this.#extra).add(code);
  }

  // Undo a Left Ctrl press that came with this Alt Gr press. Left Ctrl
  // stays seen if it was ever released for real before.
  #dropAltGrCtrl(t: number) {
    const ctrl = this.#pressed.get("ControlLeft");
    if (ctrl === undefined || t - ctrl > ALTGR_MS) return;
    this.#pressed.delete("ControlLeft");
    if (!this.#lastUp.has("ControlLeft")) this.#seen.delete("ControlLeft");
    this.#ghostCtrl = true;
  }
}
