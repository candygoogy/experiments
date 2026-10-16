// Before first paint: a saved Light or Dark, else Auto (the OS decides).
(() => {
  const r = document.documentElement;
  r.classList.add("js");
  try {
    const t = localStorage.getItem("theme");
    if (t !== "light" && t !== "dark") return;
    r.dataset.theme = t;
    document
      .querySelector('meta[name="color-scheme"]')
      ?.setAttribute("content", t);
    for (const m of document.querySelectorAll('meta[name="theme-color"]'))
      m.setAttribute("content", t === "light" ? "#f4f4f5" : "#121214");
  } catch {
    // Storage blocked: stay on Auto.
  }
})();
