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
//   data-d       extra delay for a whole group, in ms (as --d, notfound.css),
//                counted from the earliest group that arrives with it
//
// Each element arrives as its own top crosses its line (see line, below).
// A group delay counts from the earliest one in the batch, so blocks
// arriving together keep their order and a lone late arrival starts at
// once. Once scrolling has stopped for 500ms, whatever is still waiting in
// the window arrives anyway, and whatever a fast scroll carried past,
// above the window, is marked as arrived unplayed (it never rises from
// below on the way back up).
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
  // A block still at its start state, risen RISE() below where it rests
  // (notfound.css; a mask's own box never moves, only its child).
  const LOW = ".nf .rv:not(.is-in)";
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

  // Where an element's box will rest: the observer sees a waiting block,
  // and everything inside one, lower by the rise still ahead of it.
  const resting = (el: Element) => {
    const r = el.getBoundingClientRect();
    let lift = 0;
    if (root.classList.contains("motion-ready")) {
      const step = RISE();
      for (let a: Element | null = el; a; a = a.parentElement) {
        if (a.matches(LOW)) lift += step;
      }
    }
    return { top: r.top - lift, bottom: r.bottom - lift };
  };

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

  // Plays a batch of blocks that arrived together, each group from
  // start(el). Siblings rise 80ms apart: by their --i when the whole group
  // arrived at once, otherwise in the order they arrived (a group split
  // across two arrivals doesn't wait for the half that's already on
  // screen). The steps count from the batch's first, so a block arriving
  // alone never waits for a turn.
  function blocks(batch: HTMLElement[], start: (el: HTMLElement) => number) {
    const groups = new Map<Element | null, HTMLElement[]>();
    for (const el of batch) {
      const group = groups.get(el.parentElement) ?? [];
      group.push(el);
      groups.set(el.parentElement, group);
    }
    const steps = new Map<HTMLElement, number>();
    for (const [parent, group] of groups) {
      const siblings = parent
        ? [...parent.children].filter((c) => c.matches(BLOCKS))
        : group;
      const indexed =
        group.length === siblings.length &&
        group.every((el) => el.dataset["i"] !== undefined);
      group.forEach((el, n) => {
        steps.set(el, indexed ? Number(el.dataset["i"]) || 0 : n);
      });
    }
    const first = Math.min(...steps.values());
    for (const [el, i] of steps) {
      reveal(el, start(el) + (i - first) * STAGGER_MS);
    }
  }

  // Marks an element as arrived with no animation: it was already on
  // screen.
  function arrived(el: Element) {
    el.classList.add("is-in");
  }

  // Everything that arrived in one go, in reading order, its group delays
  // counted from the earliest.
  function play(batch: Element[]) {
    const sorted = [...new Set(batch)]
      .filter((el) => !settled(el))
      .sort(order) as HTMLElement[];
    const delays = new Map(sorted.map((el) => [el, groupDelay(el)]));
    const first = Math.min(...delays.values());
    blocks(sorted, (el) => (delays.get(el) ?? first) - first);
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
    listen();
  };

  const unwatch = (el: Element) => {
    watching.get(el)?.();
    watching.delete(el);
  };

  // A resize (a phone or tablet turned, a window resized) moves things with
  // no scroll, and the observer misses some of them. So on a resize,
  // whatever a load at the new size would have shown arrives now, measured
  // as on load; the rest are watched again if the lines changed. Once a
  // frame at most, and only until everything has arrived.
  let narrow = phone();
  let sizing = 0;
  function resized() {
    if (!watching.size) return quiet();
    if (sizing) return;
    sizing = requestAnimationFrame(() => {
      sizing = 0;
      const turned = phone() !== narrow;
      narrow = phone();
      for (const el of [...watching.keys()]) {
        const below = el.getBoundingClientRect().top >= line(el) * innerHeight;
        if (below && !turned) continue;
        unwatch(el);
        if (below) watch(el);
        else arrive(el);
      }
      if (!watching.size) quiet();
    });
  }

  // At rest (no scroll for 500ms, and once 500ms after the start),
  // whatever is still waiting and would rest in the window arrives: the
  // last few pixels of a page, a block left just under its line, a
  // find-in-page jump. Whatever a fast scroll or a scrollbar drag carried
  // past, above the window, is marked as arrived unplayed. A scroll only
  // notes the time; the check runs in the timer.
  let moved = performance.now();
  let still = 0;
  const settle = () => {
    const wait = moved + 500 - performance.now();
    if (wait > 0) {
      still = window.setTimeout(settle, wait);
      return;
    }
    still = 0;
    for (const el of [...watching.keys()]) {
      const box = resting(el);
      if (box.bottom <= 0) {
        unwatch(el);
        arrived(el);
      } else if (box.top < innerHeight - 8) {
        unwatch(el);
        arrive(el);
      }
    }
    if (!watching.size) quiet();
  };
  function scrolled() {
    moved = performance.now();
    if (!still) still = window.setTimeout(settle, 500);
  }

  // Both listeners stay only while something is waiting.
  let listening = false;
  function listen() {
    if (listening) return;
    listening = true;
    addEventListener("resize", resized, { passive: true });
    addEventListener("scroll", scrolled, { passive: true });
  }
  function quiet() {
    listening = false;
    removeEventListener("resize", resized);
    removeEventListener("scroll", scrolled);
  }

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
  if (watching.size) scrolled();

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
      for (const el of [...watching.keys()]) {
        if (el.getBoundingClientRect().top >= innerHeight) continue;
        unwatch(el);
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
      unwatch(el);
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
