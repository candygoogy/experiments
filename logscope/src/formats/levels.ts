// Event levels as Windows writes them, in the languages it's most often
// set to: each word as real Event Viewer output shows it (Polish shows
// both the singular and the plural). An unknown word gives null: the
// event's level then comes from the known events (known.ts), and the page
// says it can't tell errors from information.
import type { Level } from "../model.ts";

const WORDS: Record<string, Level> = {};
const add = (level: Level, words: string[]) => {
  for (const w of words) WORDS[w] = level;
};
add("critical", [
  "critical",
  "critico",
  "kritisch",
  "critique",
  "crítico",
  "kritiek",
  "krytyczny",
  "krytyczne",
  "критический",
  "重大",
  "关键",
]);
add("error", [
  "error",
  "errore",
  "fehler",
  "erreur",
  "erro",
  "fout",
  "błąd",
  "błędy",
  "ошибка",
  "エラー",
  "错误",
]);
add("warning", [
  "warning",
  "avviso",
  "avvertenza",
  "warnung",
  "avertissement",
  "advertencia",
  "aviso",
  "waarschuwing",
  "ostrzeżenie",
  "ostrzeżenia",
  "предупреждение",
  "警告",
]);
add("information", [
  "information",
  "informazioni",
  "informationen",
  "información",
  "informações",
  "informatie",
  "informacje",
  "informacja",
  "сведения",
  "情報",
  "信息",
  "verbose",
  "dettagliato",
  "ausführlich",
  "commentaires",
  "detallado",
  "detalhado",
]);

export const levelWord = (word: string): Level | null => {
  const key = word.trim().toLowerCase();
  return Object.hasOwn(WORDS, key) ? (WORDS[key] ?? null) : null;
};

/** A word read in the wrong text encoding: one of its letters became
 * U+FFFD. It may be any level, even next to words this page knows. */
export const garbled = (word: string) => word.includes("\u{fffd}");

/** The numbers Windows' XML uses: 1 critical … 5 verbose; 0 is "log
 * always", which Event Viewer shows as information. */
export function levelNumber(n: number): Level | null {
  if (n === 1) return "critical";
  if (n === 2) return "error";
  if (n === 3) return "warning";
  if (n === 0 || n === 4 || n === 5) return "information";
  return null;
}
