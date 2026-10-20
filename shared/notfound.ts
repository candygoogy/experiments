// The 404's script and styles (dist/404.html, notFoundHtml in shell.ts):
// the header, as on a tool page (the theme switch, and on phones the
// menu), and the 404's motion, as on candygoogy.dev's 404: the reveals
// (notfound-reveal.ts) and the route check with its restart
// (notfound-trace.ts). Built by the shell plugin in vite.ts as an entry of
// its own, which only 404.html loads.
import "./notfound.css";
import { initHeader } from "./header.ts";
import initReveal from "./notfound-reveal.ts";
import initTrace from "./notfound-trace.ts";

initHeader();

// The motion starts once the page has first painted, as the site's motion
// loader does (its Base.astro and scripts/loader.ts), so the first paint
// never waits for it and what's on screen then is shown settled. The load
// event often comes before the first paint, so it's only the fallback: 1s
// after it if the paint is never reported (as in a background tab), or at
// once without paint timing.
let started = false;
const start = () => {
  if (started) return;
  started = true;
  // The motion setting changed during the visit (either way): the
  // one-time CSS entrance (the "404") is done for good, so turning reduced
  // motion off never plays it again (html.motion-settled).
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener(
    "change",
    () => document.documentElement.classList.add("motion-settled"),
    { once: true },
  );
  // iOS Safari only applies :active (the restart's press) when the page
  // listens for touches.
  document.addEventListener("touchstart", () => {}, { passive: true });
  initReveal();
  const trace = document.querySelector<HTMLElement>("[data-trace]");
  if (trace) initTrace(trace);
};
let fallback = 0;
try {
  new PerformanceObserver((list, observer) => {
    if (!list.getEntriesByName("first-contentful-paint").length) return;
    observer.disconnect();
    start();
  }).observe({ type: "paint", buffered: true });
  fallback = 1000;
} catch {
  // No paint timing: the load event starts it.
}
if (document.readyState === "complete") setTimeout(start, fallback);
else
  addEventListener("load", () => setTimeout(start, fallback), { once: true });
