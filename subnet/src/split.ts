// Splitting a range: into 2, 4, 8 or 16 equal parts, or into the smallest
// parts that each fit N devices; and adding the parts to the plan, indented
// under their range (which stays), in place of any parts it had.
import { cidr, hosts, type Range4 } from "./ip";

// More parts than this in one go would bury the plan.
export const MAX_PARTS = 64;

export type Split =
  { parts: Range4[] } | { problem: "tooSmall" | "tooBig" | "tooMany" };

function parts(r: Range4, prefix: number): Range4[] {
  const size = 2 ** (32 - prefix);
  return Array.from({ length: r.size / size }, (_, i) => ({
    start: r.start + i * size,
    size,
    prefix,
  }));
}

export function splitEqual(r: Range4, n: 2 | 4 | 8 | 16): Split {
  const prefix = r.prefix + Math.log2(n);
  if (prefix > 32) return { problem: "tooSmall" };
  return { parts: parts(r, prefix) };
}

export function splitFit(r: Range4, devices: number): Split {
  if (!(devices >= 1) || devices > hosts(r).count) return { problem: "tooBig" };
  let prefix = r.prefix;
  while (prefix < 32) {
    const next = {
      start: r.start,
      size: 2 ** (31 - prefix),
      prefix: prefix + 1,
    };
    if (hosts(next).count < devices) break;
    prefix++;
  }
  if (2 ** (prefix - r.prefix) > MAX_PARTS) return { problem: "tooMany" };
  return { parts: parts(r, prefix) };
}

/** The plan with the parts indented under the range on line `line`, in
 * place of the parts it had (splitting again replaces a split). Parts are
 * named after their range. */
export function addSplit(
  text: string,
  line: number,
  name: string,
  ranges: Range4[],
): string {
  const lines = text.split(/\r\n?|\n/);
  // The range's block runs to the next unindented line, blank lines
  // included. Only lines the parser reads (parts, or lines it couldn't
  // read) are replaced; comments and blank lines stay.
  let to = line;
  while (to < lines.length && !/^\S/.test(lines[to] ?? "")) to++;
  const kept = lines
    .slice(line, to)
    .filter((l) => !l.replace(/#.*$/, "").trim());
  const added = ranges.map(
    (r, i) => `  ${name ? `${name}-${i + 1} ` : ""}${cidr(r)}`,
  );
  lines.splice(line, to - line, ...added, ...kept);
  return lines.join("\n");
}
