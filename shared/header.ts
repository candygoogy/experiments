// The header's behaviour (markup in shell.ts, styles in shell.css), from
// candygoogy.dev's Header.astro: the theme switches, and on phones the
// menu and a header that steps out of the way while you scroll down.
import { initThemeSwitch } from "./theme-switch.ts";

/** Below this the header is the wordmark and Menu (as in shell.css). */
const PHONE = "(max-width: 34rem)";

export function initHeader(): void {
  for (const group of document.querySelectorAll<HTMLElement>(
    "[data-theme-switch]",
  )) {
    initThemeSwitch(group);
  }
  initMenu();
  initAway();
}

// The menu opens as a modal dialog: the page behind can't be reached or
// scrolled. Close, Esc, a link or a wider window closes it, and focus
// goes back to Menu.
function initMenu() {
  const root = document.documentElement;
  const button = document.querySelector<HTMLButtonElement>("[data-menu-open]");
  const menu = document.querySelector<HTMLDialogElement>("[data-menu]");
  if (!button || !menu || typeof menu.showModal !== "function") return;
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  // The fallback close below, cleared when the menu closes or opens, so
  // a menu opened again soon after isn't shut by it.
  let fallback = 0;

  // Quicker than it opens: the menu fades away over the page (its top row
  // over the header's own, so the wordmark stays put), then closes.
  const shut = () => {
    if (!menu.open || menu.classList.contains("closing")) return;
    if (calm.matches) return menu.close();
    menu.classList.add("closing");
    // If the fade never reports its end (a hidden tab), close anyway.
    fallback = window.setTimeout(() => menu.open && menu.close(), 400);
  };

  button.addEventListener("click", (event) => {
    window.clearTimeout(fallback);
    // The page gutter is 5vw, and a kept scrollbar room changes what vw
    // measures: the menu keeps the header's gutter as it is now.
    menu.style.setProperty(
      "--gutter",
      getComputedStyle(button.parentElement ?? root).paddingLeft,
    );
    root.classList.toggle("menu-bar", innerWidth > root.clientWidth);
    root.classList.add("menu-on");
    menu.showModal();
    button.setAttribute("aria-expanded", "true");
    // Opened from the keyboard, focus goes to Close (where Menu was);
    // from a tap or a click, to the menu itself, so no ring shows.
    const close = menu.querySelector<HTMLElement>("[data-menu-close]");
    (event.detail === 0 && close ? close : menu).focus({
      preventScroll: true,
    });
  });

  menu.addEventListener("animationend", (event) => {
    if (event.target === menu && menu.open) menu.close();
  });

  menu.addEventListener("close", () => {
    window.clearTimeout(fallback);
    menu.classList.remove("closing");
    root.classList.remove("menu-on", "menu-bar");
    button.setAttribute("aria-expanded", "false");
    // The header is at the top of the page: focusing it mustn't scroll.
    button.focus({ preventScroll: true });
  });

  // Esc fades it like Close does.
  menu.addEventListener("cancel", (event) => {
    event.preventDefault();
    shut();
  });

  menu.addEventListener("click", (event) => {
    if ((event.target as Element).closest("[data-menu-close]")) shut();
  });

  // Wide enough for the full row again (a tablet turned): no menu.
  matchMedia(PHONE).addEventListener("change", (event) => {
    if (!event.matches && menu.open) menu.close();
  });

  // Leaving the page with it open: a page coming back from the
  // back/forward cache shows the page, not the menu.
  addEventListener("pagehide", () => {
    if (menu.open) menu.close();
  });
}

// On phones the header stays with you: scrolling down slides it up out of
// view, scrolling up brings it back, and at the top it sits in its place
// (shell.css, header.top). One passive scroll listener, read once a frame.
// A jump within the page (the skip link, or arriving at a #) keeps it
// away until the page has settled, so it never lands over what you went
// to.
function initAway() {
  const root = document.documentElement;
  const header = document.querySelector<HTMLElement>("header.top");
  if (!header) return;
  // Scrolled this far in one direction before it moves.
  const STEP = 10;
  let last = 0;
  let dir = 0;
  let travel = 0;
  let frame = 0;
  // Mid-jump, and the timer that ends it once the page stops moving.
  let jumping = false;
  let settling = 0;
  const away = (on: boolean) => header.classList.toggle("away", on);
  // Where the page is, ignoring iOS's rubber-band past either end.
  const at = () =>
    Math.min(Math.max(scrollY, 0), root.scrollHeight - innerHeight);
  const tick = () => {
    frame = 0;
    const y = at();
    const d = y - last;
    last = y;
    if (jumping || root.classList.contains("menu-on")) return;
    if (y <= header.offsetHeight) {
      away(false);
      return;
    }
    if (!d) return;
    if (Math.sign(d) !== dir) {
      dir = Math.sign(d);
      travel = 0;
    }
    travel += Math.abs(d);
    if (travel >= STEP) away(dir > 0);
  };
  const settle = () => {
    jumping = false;
    last = at();
    dir = 0;
    travel = 0;
    away(last > header.offsetHeight);
    header.classList.remove("still");
  };
  const jump = () => {
    jumping = true;
    window.clearTimeout(settling);
    settling = window.setTimeout(settle, 250);
  };
  // Arriving (a reload, a link to a #, the page restoring its place): in
  // place at once, no slide, once the page stops moving.
  header.classList.add("still");
  jump();
  addEventListener(
    "scroll",
    () => {
      if (jumping) jump();
      frame ||= requestAnimationFrame(tick);
    },
    { passive: true },
  );
  document.addEventListener(
    "click",
    (event) => {
      const a = (event.target as Element).closest?.("a");
      // Only a # on this page: the menu's candygoogy.dev/#projects has
      // the same path as a tool's page, on another site.
      if (
        a?.hash &&
        a.origin === location.origin &&
        a.pathname === location.pathname
      ) {
        jump();
        away(true);
      }
    },
    true,
  );
  // A keyboard user reaching Menu or the wordmark sees them.
  header.addEventListener("focusin", () => away(false));
}
