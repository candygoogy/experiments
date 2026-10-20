// The 404's route check (notFoundHtml in shell.ts, the [data-trace]
// panel; notfound.css), copied from candygoogy.dev's
// scripts/motion/notfound.ts with its classes renamed (nf-). Started
// after the first paint by notfound.ts, as the site's motion loader
// starts it; until then the hops wait
// unseen (CSS, from the first paint, with a 4s fallback).
//
// The trace, once the 404 has typed in: the line carries the check across.
// Each hop rises in; it says "Checking…" (its dots appearing in turn) while
// its link draws on toward the next hop, and the moment the line arrives,
// it answers "Working" (its dot inks in green from the centre, settles on a
// spring and sends out one soft ring) and the next hop starts checking. The
// last hop, with no line to send, answers "Not found" with one shake. The header shows the time of this
// request in UTC (set once, not a clock). Then the last hop is a button:
// "turning it off and on again" shows "Restarting…" for 600ms, then
// "Not found" again, and says so once in the live line. Without JS it's
// the final state; under reduced motion it's the final state at once, and
// the egg still works (its words swap without moving).
import { EASE } from "./notfound-motion.ts";

// The sequence's beats (ms): a hop's link starts drawing LINK_AT after the
// hop starts rising and takes DRAW; the next hop starts rising NEXT_AT
// after the link starts; the last hop answers ANSWER after it starts
// checking.
const RISE = 600;
const LINK_AT = 450;
const DRAW = 450;
const NEXT_AT = 150;
const ANSWER = 300;
const RESTART = 600;
const LABELS: Record<string, string> = {
  // A hop the check hasn't reached yet shows no word.
  waiting: "Checking…",
  checking: "Checking…",
  ok: "Working",
  missing: "Not found",
  restarting: "Restarting…",
};
const calm = matchMedia("(prefers-reduced-motion: reduce)");
const touch = matchMedia("(hover: none)");
// Phones stack the hops, so the links run down instead of across.
const stacked = matchMedia("(max-width: 32.5rem)");
export default function init(trace: HTMLElement) {
  const hops = [...trace.querySelectorAll<HTMLElement>(".nf-hop")];
  const line = trace.querySelector<HTMLElement>("[data-egg-line]");

  const setState = (hop: HTMLElement | undefined, state: string) => {
    const status = hop?.querySelector<HTMLElement>(".nf-status");
    const sr = hop?.querySelector<HTMLElement>("[data-sr]");
    if (status) status.dataset["state"] = state;
    if (sr) sr.textContent = LABELS[state] ?? "";
  };

  // The real path and the visitor's time (UTC), in the trace and the
  // metadata line.
  // A malformed address (/100%, a cut-off escape) can't be decoded: then
  // it's shown as it came.
  const path = (() => {
    try {
      return decodeURI(location.pathname);
    } catch {
      return location.pathname;
    }
  })();
  // Long paths keep their start and their end, with an ellipsis between:
  // up to 28 characters in the footer, 20 under the narrow hop.
  const middle = (max: number) => {
    if (path.length <= max) return path;
    const head = Math.ceil((max - 1) / 2);
    return `${path.slice(0, head)}…${path.slice(-(max - 1 - head))}`;
  };
  for (const [selector, max] of [
    ["[data-path]", 20],
    ["[data-path-value]", 28],
  ] as const) {
    const el = trace.querySelector<HTMLElement>(selector);
    if (!el) continue;
    el.textContent = middle(max);
    el.title = path;
  }
  const timeValue = trace.querySelector<HTMLElement>("[data-time-value]");
  if (timeValue) {
    timeValue.textContent = `${new Date().toISOString().slice(11, 19)} UTC`;
  }
  for (const el of trace.querySelectorAll<HTMLElement>("[data-meta-path]")) {
    el.hidden = false;
  }

  // Something to do at a moment of the sequence: an empty animation on
  // the trace, so finishing the trace runs it too.
  const at = (delay: number, fn: () => void) => {
    const a = new Animation(
      new KeyframeEffect(trace, null, { duration: Math.max(1, delay) }),
      document.timeline,
    );
    a.onfinish = fn;
    a.play();
    return a;
  };

  // A status changing words: the old one leaves upward out of its mask,
  // quickly, and the new one rises in from below 0.1s later with a slight
  // lean that settles, in the same cell (the width never changes). An
  // answer arrives soft and settles into ink. With `still`, the words just
  // swap.
  const word = (hop: HTMLElement, state: string) =>
    hop.querySelector<HTMLElement>(`.nf-states [data-is="${state}"]`);
  const answers = new Set(["ok", "missing"]);
  const swap = (
    hop: HTMLElement,
    from: string,
    to: string,
    delay: number,
    still = false,
  ) => {
    const out = word(hop, from);
    const into = word(hop, to);
    const anims = [
      at(delay, () => {
        if (out && !still) out.dataset["leaving"] = "";
        setState(hop, to);
      }),
    ];
    if (still) return anims;
    if (out) {
      const leave = out.animate(
        [{ transform: "none" }, { transform: "translateY(-100%)" }],
        { duration: 200, delay, easing: EASE.inOut, fill: "forwards" },
      );
      leave.onfinish = () => {
        delete out.dataset["leaving"];
        leave.cancel();
      };
      anims.push(leave);
    }
    if (into) {
      const style = getComputedStyle(hop);
      const soft = style.getPropertyValue("--soft").trim();
      const inked = style.getPropertyValue("--ink").trim();
      const tint = answers.has(to) && soft !== "" && inked !== "";
      anims.push(
        into.animate(
          [
            {
              transform: "translateY(100%) skewY(4deg)",
              ...(tint ? { color: soft } : {}),
            },
            { transform: "none", ...(tint ? { color: inked } : {}) },
          ],
          {
            duration: 300,
            delay: delay + (out ? 100 : 0),
            easing: EASE.out,
            fill: "backwards",
          },
        ),
      );
    }
    return anims;
  };
  // "Working" lands: the green inks in from the centre over the grey, the
  // dot settles on a spring, and one soft ring grows 4px and fades.
  const ink = (hop: HTMLElement, delay: number) => {
    const dot = hop.querySelector<HTMLElement>(".nf-dot");
    if (!dot) return [];
    const size = dot.offsetWidth || 9;
    return [
      dot.animate(
        [
          { clipPath: "circle(0% at 50% 50%)" },
          { clipPath: "circle(75% at 50% 50%)" },
        ],
        {
          duration: 280,
          delay,
          easing: EASE.out,
          fill: "backwards",
          pseudoElement: "::before",
        },
      ),
      dot.animate([{ transform: "scale(0.85)" }, { transform: "none" }], {
        duration: 500,
        delay,
        easing: EASE.spring,
      }),
      dot.animate(
        [
          { opacity: 0.6, transform: "none" },
          { opacity: 0, transform: `scale(${(size + 8) / size})` },
        ],
        { duration: 600, delay, easing: EASE.out, pseudoElement: "::after" },
      ),
    ];
  };
  // "Not found" lands with one small shake of its ring.
  const shake = (hop: HTMLElement, delay: number) =>
    hop
      .querySelector(".nf-dot")
      ?.animate(
        [
          { transform: "none" },
          { transform: "translateX(-3px)" },
          { transform: "translateX(3px)" },
          { transform: "translateX(-2px)" },
          { transform: "none" },
        ],
        { duration: 350, delay },
      );

  // On touch screens nothing hovers, so once the trace is done the egg
  // shows its ring once, fading out, to say it can be tapped.
  const cue = () => {
    if (!touch.matches || calm.matches) return;
    const glyph = trace.querySelector<HTMLElement>("button.nf-node .nf-glyph");
    glyph?.classList.add("cue");
  };

  // The sequence. Skipping to the end drops every animation still
  // running in the trace (none of them would leave anything behind) and
  // sets the end state, which is plain CSS.
  let run: Animation[] | null = null;
  const finish = () => {
    run = null;
    for (const a of trace.getAnimations({ subtree: true })) a.cancel();
    hops.forEach((hop, i) => {
      hop.dataset["shown"] = "";
      hop.dataset["drawn"] = "";
      setState(hop, i === hops.length - 1 ? "missing" : "ok");
      for (const w of hop.querySelectorAll<HTMLElement>(".nf-states > span")) {
        delete w.dataset["leaving"];
      }
    });
    trace.dataset["done"] = "";
  };

  const play = () => {
    // Every hop is held unseen (and its link undrawn) by its own animation
    // until its moment; the first one is already checking.
    hops.forEach((hop, i) => {
      setState(hop, i === 0 ? "checking" : "waiting");
      hop.dataset["shown"] = "";
      hop.dataset["drawn"] = "";
    });
    const anims: Animation[] = [];
    let rise = 0;
    let checking = 0;
    hops.forEach((hop, i) => {
      const next = hops[i + 1];
      anims.push(
        hop.animate(
          [
            { transform: "translateY(24px)", opacity: 0 },
            { transform: "none", opacity: 1 },
          ],
          { duration: RISE, delay: rise, easing: EASE.out, fill: "backwards" },
        ),
      );
      if (!next) {
        // The last hop has no line to send: it answers on its own.
        const answer = checking + ANSWER;
        anims.push(...swap(hop, "checking", "missing", answer));
        const s = shake(hop, answer + 100);
        if (s) anims.push(s);
        return;
      }
      // The link draws toward the next hop; as it arrives, this hop
      // answers and the next one starts checking.
      const link = rise + LINK_AT;
      const arrive = link + DRAW;
      anims.push(
        hop.animate(
          [
            { transform: stacked.matches ? "scaleY(0)" : "scaleX(0)" },
            { transform: "none" },
          ],
          {
            duration: DRAW,
            delay: link,
            easing: EASE.out,
            fill: "backwards",
            pseudoElement: "::after",
          },
        ),
        hop.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 150,
          delay: arrive - 100,
          fill: "backwards",
          pseudoElement: "::before",
        }),
        ...swap(hop, "checking", "ok", arrive),
        ...ink(hop, arrive),
        ...swap(next, "waiting", "checking", arrive),
      );
      rise = link + NEXT_AT;
      checking = arrive;
    });
    run = anims;
    void Promise.all(anims.map((a) => a.finished)).then(
      () => {
        if (run !== anims) return;
        finish();
        cue();
      },
      () => {},
    );
  };

  // Reduced motion switched on: the trace ends where it was going (and a
  // restart in progress lands on its last words).
  calm.addEventListener("change", () => {
    if (!calm.matches) return;
    if (!("done" in trace.dataset)) finish();
    else for (const a of trace.getAnimations({ subtree: true })) a.finish();
  });

  if (calm.matches) {
    finish();
  } else {
    trace.dataset["run"] = "";
    // It starts as the "404" finishes typing in (CSS, from the first
    // paint), or at once if it already has.
    const lastDigit = trace
      .closest(".nf")
      ?.querySelector(".nf-code .nf-l:last-child > span");
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      // Already ended (the egg was reached first): it stays as it is.
      if ("done" in trace.dataset) return;
      // If the hops are already showing (the CSS fallback got there
      // first), the trace stays as it is: the end state, no replay.
      const first = hops[0];
      if (first && getComputedStyle(first).opacity === "1") finish();
      else play();
    };
    const typing = lastDigit
      ?.getAnimations()
      .find((a) => a.playState !== "finished");
    if (typing) void typing.finished.then(start, start);
    else start();
    window.setTimeout(start, 1500); // If it never reports.
  }

  // The egg: the last hop as a button.
  const lastHop = hops.at(-1);
  const node = lastHop?.querySelector<HTMLElement>(".nf-node");
  if (lastHop && node && line) {
    const button = document.createElement("button");
    for (const attr of node.attributes) {
      button.setAttribute(attr.name, attr.value);
    }
    button.type = "button";
    button.append(...node.childNodes);
    node.replaceWith(button);
    // Its name stays what it shows ("This page, Not found"); the question
    // is its description, from a hidden note (read only through the
    // button, never as page text).
    const hint = document.createElement("span");
    hint.id = "egg-hint";
    hint.hidden = true;
    hint.textContent = "Have you tried turning it off and on again?";
    lastHop.append(hint);
    button.setAttribute("aria-describedby", hint.id);
    // Reached (Tab, a press) before the trace has shown it: the trace ends
    // at once, so it's never focused or pressed unseen.
    const shown = () => {
      if (!("done" in trace.dataset)) finish();
    };
    button.addEventListener("focus", shown);
    button.addEventListener("pointerdown", shown);

    // Each press plays the same restart from the start; a press while
    // one is still running is ignored.
    let egg: Animation[] = [];
    button.addEventListener("click", () => {
      if (egg.some((a) => a.playState === "running")) return;
      if (!("done" in trace.dataset)) finish();
      trace.querySelector(".nf-glyph.cue")?.classList.remove("cue");
      const still = calm.matches;
      egg = [
        ...swap(lastHop, "missing", "restarting", 0, still),
        ...swap(lastHop, "restarting", "missing", RESTART, still),
        at(RESTART, () => {
          line.textContent = "Tried it. Still a 404.";
        }),
      ];
      if (!still) {
        const s = shake(lastHop, RESTART + 100);
        if (s) egg.push(s);
      }
    });
  }
}
