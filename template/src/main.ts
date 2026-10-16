import "@exp/shared/tokens.css";
import "@exp/shared/fonts.css";
import "@exp/shared/base.css";
import "@exp/shared/shell.css";
import "@exp/shared/theme-switch.css";
import "@exp/shared/work.css";
import { initThemeSwitch } from "@exp/shared/theme-switch";

const themes = document.querySelector<HTMLElement>("[data-theme-switch]");
if (themes) initThemeSwitch(themes);
