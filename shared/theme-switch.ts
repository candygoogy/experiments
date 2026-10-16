// The Auto / Light / Dark switch (markup in shell.ts, styles in
// theme-switch.css), from candygoogy.dev's ThemeSwitch.astro. An
// experiment is one page, so a change applies at once while the pill
// slides: there's no page snapshot to wipe between.

// The browser bar's color: on Light or Dark both theme-color metas take
// that theme's page color; on Auto each goes back to its own (by its media
// query, as in the HTML). Keep in step with --bg in tokens.css.
const BG = { light: "#f4f4f5", dark: "#121214" } as const;

type Theme = "auto" | "light" | "dark";

const saved = (): Theme => {
  try {
    const value = localStorage.getItem("theme");
    return value === "light" || value === "dark" ? value : "auto";
  } catch {
    return "auto";
  }
};

export function initThemeSwitch(group: HTMLElement): void {
  const root = document.documentElement;
  const meta = document.querySelector('meta[name="color-scheme"]');
  const dark = matchMedia("(prefers-color-scheme: dark)");
  const buttons = group.querySelectorAll<HTMLButtonElement>("button");
  const resolved = group.querySelector<HTMLElement>("[data-resolved]");

  const barColor = (value: Theme) => {
    for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
      const own = m.getAttribute("media")?.includes("dark")
        ? BG.dark
        : BG.light;
      m.setAttribute("content", value === "auto" ? own : BG[value]);
    }
  };

  const sync = () => {
    const current = root.dataset["theme"] ?? "auto";
    group.dataset["current"] = current;
    for (const b of buttons) {
      b.setAttribute("aria-pressed", String(b.dataset["value"] === current));
    }
    if (resolved) resolved.textContent = dark.matches ? " (dark)" : " (light)";
  };

  const apply = (value: Theme) => {
    if (value === "auto") {
      delete root.dataset["theme"];
      meta?.setAttribute("content", "light dark");
    } else {
      root.dataset["theme"] = value;
      meta?.setAttribute("content", value);
    }
    barColor(value);
    try {
      if (value === "auto") localStorage.removeItem("theme");
      else localStorage.setItem("theme", value);
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
    sync();
  };

  group.addEventListener("click", (event) => {
    const button = (event.target as Element).closest("button");
    const value = button?.dataset["value"];
    if (value !== "auto" && value !== "light" && value !== "dark") return;
    if (value === group.dataset["current"]) return;
    apply(value);
  });

  // A page restored from the back/forward cache comes back with the theme
  // it was left with; one chosen since in another tab is put on at once,
  // before it's seen, with the pill already in place.
  addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    const value = saved();
    if (value === (root.dataset["theme"] ?? "auto")) return;
    root.classList.add("theme-restore");
    apply(value);
    void root.offsetWidth; // The new state is in place with transitions off.
    requestAnimationFrame(() => root.classList.remove("theme-restore"));
  });

  dark.addEventListener("change", sync);
  sync();
  requestAnimationFrame(() => {
    group.dataset["ready"] = "";
  });
}
