// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { initThemeSwitch } from "../theme-switch";

/** Another tab saving (or removing) the theme, as this tab hears it. */
function elsewhere(value: string | null) {
  if (value === null) localStorage.removeItem("theme");
  else localStorage.setItem("theme", value);
  // This tab only reads from here on.
  const write = vi.spyOn(Storage.prototype, "setItem");
  const remove = vi.spyOn(Storage.prototype, "removeItem");
  dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: value }));
  expect(write).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  vi.restoreAllMocks();
}

test("a theme chosen in another tab is put on here too", () => {
  document.head.innerHTML = '<meta name="color-scheme" content="light dark">';
  document.body.innerHTML = `
    <div data-theme-switch>
      <button data-value="auto">Auto</button>
      <button data-value="light">Light</button>
      <button data-value="dark">Dark</button>
    </div>`;
  const group = document.querySelector("[data-theme-switch]") as HTMLElement;
  initThemeSwitch(group);
  const root = document.documentElement;
  const meta = document.querySelector('meta[name="color-scheme"]') as Element;
  const pressed = () =>
    group.querySelector('[aria-pressed="true"]')?.getAttribute("data-value");
  expect(pressed()).toBe("auto");

  elsewhere("dark");
  expect(root.dataset["theme"]).toBe("dark");
  expect(meta.getAttribute("content")).toBe("dark");
  expect(group.dataset["current"]).toBe("dark");
  expect(pressed()).toBe("dark");

  // Removed is Auto.
  elsewhere(null);
  expect(root.dataset["theme"]).toBeUndefined();
  expect(meta.getAttribute("content")).toBe("light dark");
  expect(group.dataset["current"]).toBe("auto");
  expect(pressed()).toBe("auto");
});
