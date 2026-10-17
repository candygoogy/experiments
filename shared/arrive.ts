// An answer the visitor asked for (a drop, a Check, a button) arrives: it
// fades in and rises a little into place, so the eye goes to it. Web
// Animations rather than a CSS class, so nothing is hidden before the
// script runs, and the end state is the element as it is (no fill). Only
// on explicit actions: what redraws while typing or filtering just changes.
// Under reduced motion the answer is simply there.
const calm = matchMedia("(prefers-reduced-motion: reduce)");

// The pace and curve are the tokens' (tokens.css), read when an answer
// arrives, with the same values as a fallback.
function token(name: string, fallback: string): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  );
}

// Milliseconds from a CSS time: the build minifies "200ms" to ".2s".
export function ms(value: string): number {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return NaN;
  return value.trim().endsWith("ms") ? n : n * 1000;
}

export function arrive(...els: (Element | null | undefined)[]): void {
  if (calm.matches) return;
  const duration = ms(token("--dur-ui", "200ms")) || 200;
  const easing = token("--ease-ui", "cubic-bezier(0.23, 1, 0.32, 1)");
  for (const el of els) {
    el?.animate(
      [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration, easing },
    );
  }
}
