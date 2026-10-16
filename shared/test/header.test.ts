// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { initHeader } from "../header";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function menu() {
  document.body.innerHTML = `
    <button data-menu-open aria-expanded="false">Menu</button>
    <dialog data-menu><button data-menu-close>Close</button></dialog>`;
  initHeader();
  const q = <T extends Element>(s: string) => document.querySelector(s) as T;
  return {
    open: q<HTMLButtonElement>("[data-menu-open]"),
    close: q<HTMLButtonElement>("[data-menu-close]"),
    dialog: q<HTMLDialogElement>("[data-menu]"),
  };
}

test("a fade that never ends still closes the menu", () => {
  const { open, close, dialog } = menu();
  open.click();
  close.click();
  expect(dialog.classList.contains("closing")).toBe(true);
  vi.advanceTimersByTime(400);
  expect(dialog.open).toBe(false);
});

test("opened again just after closing, the menu stays open", () => {
  const { open, close, dialog } = menu();
  open.click();
  close.click();
  dialog.dispatchEvent(new Event("animationend")); // The fade ends.
  expect(dialog.open).toBe(false);
  open.click();
  vi.advanceTimersByTime(400);
  expect(dialog.open).toBe(true);
});
