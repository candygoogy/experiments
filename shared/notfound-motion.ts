// The motion helpers the 404 uses (notfound-trace.ts, notfound.ts),
// copied from candygoogy.dev's scripts/motion.ts: everything moves on the
// platform, el.animate() (Web Animations), IntersectionObserver and CSS,
// with no library. The curves are the tokens in tokens.css, read once, so
// CSS and scripts share them exactly.

const token = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
  fallback;

export const EASE = {
  // Entrances, counters, draws.
  out: token("--ease-out", "cubic-bezier(0.16, 1, 0.3, 1)"),
  // Things moving on screen: shared elements, packets.
  inOut: token("--ease-in-out", "cubic-bezier(0.77, 0, 0.175, 1)"),
  // Hover, press, toggles.
  ui: token("--ease-ui", "cubic-bezier(0.23, 1, 0.32, 1)"),
  // Spreading signals (the antenna's waves).
  sine: token("--ease-sine", "cubic-bezier(0.39, 0.575, 0.565, 1)"),
  // Things that land: pops, dots, pills (a small overshoot, then still).
  spring: ((curve) =>
    CSS.supports("transition-timing-function", curve)
      ? curve
      : "cubic-bezier(0.34, 1.4, 0.64, 1)")(
    token("--ease-spring", "cubic-bezier(0.34, 1.4, 0.64, 1)"),
  ),
};

export const reduced = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;
export const phone = () => matchMedia("(max-width: 40rem)").matches;

// How far a block rises into place (px), and the gap between siblings.
export const RISE = () => (phone() ? 32 : 40);
export const STAGGER_MS = 80;

// Calls back when the element comes into view: by default once, as its
// top crosses 85% of the window (92% on phones), then it stops watching.
// With once: false it calls back on every change, entering and leaving
// (check entry.isIntersecting). One observer is shared per margin.
// Returns a function that stops watching.
type Watch = (entry: IntersectionObserverEntry) => void;
const observers = new Map<
  string,
  { io: IntersectionObserver; watching: Map<Element, Set<Watch>> }
>();

export function inView(
  el: Element,
  cb: Watch,
  {
    margin = phone() ? "0px 0px -8% 0px" : "0px 0px -15% 0px",
    once = true,
  }: { margin?: string; once?: boolean } = {},
) {
  let shared = observers.get(margin);
  if (!shared) {
    const watching = new Map<Element, Set<Watch>>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          for (const fn of [...(watching.get(entry.target) ?? [])]) fn(entry);
        }
      },
      { rootMargin: margin },
    );
    shared = { io, watching };
    observers.set(margin, shared);
  }
  const { io, watching } = shared;
  const stop = () => {
    const set = watching.get(el);
    set?.delete(watch);
    if (set?.size === 0) {
      watching.delete(el);
      io.unobserve(el);
    }
  };
  const watch: Watch = (entry) => {
    if (!once) return cb(entry);
    if (!entry.isIntersecting) return;
    stop();
    cb(entry);
  };
  const set = watching.get(el) ?? new Set<Watch>();
  set.add(watch);
  if (!watching.has(el)) {
    watching.set(el, set);
    io.observe(el);
  }
  return stop;
}
