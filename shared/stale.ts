// A part of the page's code that couldn't be fetched (the error Chrome and
// Firefox give, then Safari's): most likely a newer version of the page,
// deployed since this one opened, took its place. reloadIfGone() reloads
// the page, for the current files: once per session, so it can never loop,
// and never offline, where a reload would lose the page. As candygoogy.dev's
// loader does (its src/scripts/loader.ts). Only for a tool whose input
// survives a reload (photo's files are still on the disk); one with pasted
// text (compose) says so with missingModule() instead.
const MISSING = /dynamically imported module|Importing a module script failed/;

export const missingModule = (error: unknown): boolean =>
  MISSING.test(String(error));

/** Reloads the page for a missing module file; true when it does. */
export function reloadIfGone(error: unknown): boolean {
  try {
    if (
      missingModule(error) &&
      navigator.onLine &&
      !sessionStorage.getItem("stale-reload")
    ) {
      sessionStorage.setItem("stale-reload", "1");
      location.reload();
      return true;
    }
  } catch {
    // No sessionStorage (blocked): the page says something went wrong.
  }
  return false;
}
