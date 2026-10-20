// The 404's scroll reveals, copied from candygoogy.dev's scripts/reveal.ts
// with only what the 404 has: .rv and .rv-mask (no hairlines, statements,
// band, images or intro curtain). On the platform: IntersectionObserver
// (inView) and Web Animations (el.animate). Each plays once as it scrolls
// into view and is marked .is-in. Siblings that arrive together rise in
// turn, in reading order.
//
//   .rv          rises 40px (32px on phones) and fades in; headings and
//                large text also come into focus (a short blur)
//   .rv-mask     its child rises out of the clip, settling from a slight
//                skew
//   data-i       order within a group (when the whole group arrives at once)
//   data-d       extra delay for a whole group, in ms (as --d, notfound.css)
//
// Content never depends on this script. Hidden start states apply only
// under html.motion-ready, which is set after everything already on screen
// has been marked as arrived (so nothing that was seen disappears). If the
// script never runs, nothing is hidden. With reduced motion nothing is
// hidden either, and elements are only marked .is-in.

import { EASE, inView, phone, RISE, STAGGER_MS } from "./notfound-motion.ts";

export default function initReveal() {
  const root = document.documentElement;
  const BLOCKS = ".rv, .rv-mask";
  // Headings and large text come into focus as they rise; small text, and
  // many elements at once, never blur (it costs too much in Safari).
  const SOFT = "h1, h2, h3, .nf-lede";
  const BLUR = "blur(6px)";

  // Reduced motion, as it is now (it can be switched on while the page is
  // open).
  const calm = matchMedia("(prefers-reduced-motion: reduce)");

  // Every animation here, kept until it ends, so they can all be ended at
  // once. Under reduced motion none starts (the classes still mark arrival).
  const moving = new Set<Animation>();
  const go = (
    el: Element,
    frames: Keyframe[] | PropertyIndexedKeyframes,
    options: KeyframeAnimationOptions,
  ) => {
    if (calm.matches) return;
    const a = el.animate(frames, options);
    moving.add(a);
    const done = () => moving.delete(a);
    a.finished.then(done, done);
  };

  // Milliseconds from a CSS time ("420ms", "0.4s"); 0 when unset.
  const ms = (value: string) => {
    const n = parseFloat(value);
    if (Number.isNaN(n)) return 0;
    return value.trim().endsWith("ms") ? n : n * 1000;
  };

  // An element's --d, halved while the intro is on (--d-k, on the site).
  const groupDelay = (el: Element) => {
    const style = getComputedStyle(el);
    const k = parseFloat(style.getPropertyValue("--d-k"));
    return ms(style.getPropertyValue("--d")) * (Number.isNaN(k) ? 1 : k);
  };

  const order = (a: Element, b: Element) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;

  // Already shown by something else: nothing to play.
  const settled = (el: Element) => el.classList.contains("is-in");

  // Rise and fade, with a short blur-in on headings and large text (gone by
  // 60% of the move).
  function rise(el: HTMLElement, delay: number) {
    const from = `translateY(${RISE()}px)`;
    const frames: Keyframe[] = el.matches(SOFT)
      ? [
          { transform: from, opacity: 0, filter: BLUR },
          { filter: "blur(0px)", offset: 0.6 },
          { transform: "none", opacity: 1, filter: "blur(0px)" },
        ]
      : [
          { transform: from, opacity: 0 },
          { transform: "none", opacity: 1 },
        ];
    go(el, frames, {
      duration: 900,
      easing: EASE.out,
      delay,
      fill: "backwards",
    });
  }

  function reveal(el: HTMLElement, delay: number) {
    if (el.matches(".rv")) rise(el, delay);
    if (el.matches(".rv-mask")) {
      for (const span of el.querySelectorAll<HTMLElement>(":scope > span")) {
        go(
          span,
          [
            { transform: "translateY(110%) skewY(4deg)", filter: BLUR },
            { filter: "blur(0px)", offset: 0.6 },
            { transform: "none", filter: "blur(0px)" },
          ],
          { duration: 1000, easing: EASE.out, delay, fill: "backwards" },
        );
      }
    }
    el.classList.add("is-in");
  }

  // Plays a batch of blocks that arrived together. Siblings rise 80ms
  // apart: by their --i when the whole group arrived at once, otherwise in
  // the order they arrived (a group split across two arrivals doesn't wait
  // for the half that's already on screen).
  function blocks(batch: HTMLElement[]) {
    const groups = new Map<Element | null, HTMLElement[]>();
    for (const el of batch) {
      const group = groups.get(el.parentElement) ?? [];
      group.push(el);
      groups.set(el.parentElement, group);
    }
    for (const [parent, group] of groups) {
      const siblings = parent
        ? [...parent.children].filter((c) => c.matches(BLOCKS))
        : group;
      const indexed =
        group.length === siblings.length &&
        group.every((el) => el.dataset["i"] !== undefined);
      group.forEach((el, n) => {
        const i = indexed ? Number(el.dataset["i"]) || 0 : n;
        reveal(el, groupDelay(el) + i * STAGGER_MS);
      });
    }
  }

  // Marks an element as arrived with no animation: it was already on
  // screen.
  function arrived(el: Element) {
    el.classList.add("is-in");
  }

  // Everything that arrived in one go, in reading order.
  function play(batch: Element[]) {
    const sorted = [...new Set(batch)].sort(order) as HTMLElement[];
    blocks(sorted.filter((el) => !settled(el)));
  }

  const motion = !calm.matches;
  let pending: Element[] = [];

  const flush = () => {
    const batch = pending;
    pending = [];
    if (!motion) {
      for (const el of batch) el.classList.add("is-in");
      return;
    }
    play(batch);
  };

  // Elements that come into view in the same moment play as one batch.
  const arrive = (el: Element) => {
    if (!pending.length) queueMicrotask(flush);
    pending.push(el);
  };

  // Where each kind arrives: 15% up from the bottom of the window (8% on
  // phones, where screens are short). The footer is the page's last thing,
  // so it reveals as soon as it shows. For the window as it is now: a
  // phone turned can cross the line.
  const line = (el: Element) =>
    el.closest("footer") ? 1 : phone() ? 0.92 : 0.85;

  // Elements still waiting to arrive, with the function that stops
  // watching.
  const watching = new Map<Element, () => void>();

  const watch = (el: Element) => {
    const margin = `0px 0px -${Math.round((1 - line(el)) * 100)}% 0px`;
    const stop = inView(
      el,
      () => {
        watching.delete(el);
        arrive(el);
      },
      { margin },
    );
    watching.set(el, stop);
  };

  const all = [...document.querySelectorAll<HTMLElement>(BLOCKS)];

  // What's already on screen is marked as arrived first. Before the first
  // paint nothing has been seen yet, so only what's above its line counts;
  // after it, everything visible does, so nothing that was seen
  // disappears.
  const seen = performance.getEntriesByType("paint").length > 0;
  for (const el of all) {
    const top = el.getBoundingClientRect().top;
    if (top >= (seen ? 1 : line(el)) * innerHeight) watch(el);
    else arrived(el);
  }
  if (motion) root.classList.add("motion-ready");

  // A resize (a phone or tablet turned, a window resized) moves things with
  // no scroll, and the observer misses some of them. So on a resize,
  // whatever a load at the new size would have shown arrives now, measured
  // as on load; the rest are watched again if the lines changed. Once a
  // frame at most, and only until everything has arrived.
  let narrow = phone();
  let sizing = 0;
  const resized = () => {
    if (!watching.size) {
      removeEventListener("resize", resized);
      return;
    }
    if (sizing) return;
    sizing = requestAnimationFrame(() => {
      sizing = 0;
      const turned = phone() !== narrow;
      narrow = phone();
      for (const [el, stop] of [...watching]) {
        const below = el.getBoundingClientRect().top >= line(el) * innerHeight;
        if (below && !turned) continue;
        stop();
        watching.delete(el);
        if (below) watch(el);
        else arrive(el);
      }
      if (!watching.size) removeEventListener("resize", resized);
    });
  };
  if (watching.size) addEventListener("resize", resized, { passive: true });

  // At the end of the page (the footer's bottom edge in the window),
  // whatever is in the window and still waiting arrives: on a tall window,
  // the last blocks can stay inside the bottom margin even at full scroll
  // and would never reveal. Checked once a frame while scrolling, only
  // while the footer is on screen; at any zoom (no exact ratio to reach).
  const end = document.querySelector("footer");
  if (end) {
    let frame = 0;
    const check = () => {
      frame = 0;
      if (end.getBoundingClientRect().bottom > innerHeight + 1) return;
      for (const [el, stop] of watching) {
        if (el.getBoundingClientRect().top >= innerHeight) continue;
        stop();
        watching.delete(el);
        arrive(el);
      }
    };
    const queue = () => {
      if (!frame && watching.size) frame = requestAnimationFrame(check);
    };
    inView(
      end,
      (entry) => {
        if (entry.isIntersecting) {
          queue();
          addEventListener("scroll", queue, { passive: true });
        } else {
          removeEventListener("scroll", queue);
        }
      },
      { margin: "0px", once: false },
    );
  }

  // Keyboard focus inside something still waiting to arrive, or still
  // arriving: it shows at once, so focus never lands on something unseen.
  document.addEventListener("focusin", (e) => {
    if (!(e.target instanceof Node)) return;
    for (const el of all) {
      if (!el.contains(e.target)) continue;
      watching.get(el)?.();
      watching.delete(el);
      arrived(el);
      for (const a of moving) {
        const target = (a.effect as KeyframeEffect | null)?.target;
        if (target && el.contains(target)) a.finish();
      }
    }
  });

  // Reduced motion switched on: everything arriving lands at once.
  calm.addEventListener("change", () => {
    if (calm.matches) for (const a of moving) a.finish();
  });
}
