// Helpers for the words in each tool's copy.ts.

/** Puts values into a sentence: fill("{n} photos", { n: 3 }). A name
 * with no value is left as it is, so a missing one shows. */
export const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (all, key: string) =>
    key in values ? String(values[key]) : all,
  );
