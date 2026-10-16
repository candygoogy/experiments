// Event Viewer's XML: "Save All Events As…" → XML (each <Event> with its
// rendered message and level), or `wevtutil qe System /f:RenderedXml`
// (the same, under the root its /e option names). Plain `/f:xml` leaves
// out the rendered text: the event's data values stand in for it.
// Workers have no XML parser, and the events are simple and regular, so
// each <Event>…</Event> is collected and read with a few patterns and
// searches that never go back over the text.
import { eventSource } from "../known.ts";
import type { LogEvent } from "../model.ts";
import { levelNumber, levelWord } from "./levels.ts";
import type { Context, Emit, Parser } from "./types.ts";

// An event this long is broken, not big.
const MAX_EVENT = 1 << 20;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

const unescape = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name: string) => {
    if (name[0] === "#") {
      const code =
        name[1] === "x" || name[1] === "X"
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
      // A reference past Unicode's last character stays as written.
      return code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    const key = name.toLowerCase();
    return Object.hasOwn(ENTITIES, key) ? (ENTITIES[key] ?? all) : all;
  });

/** Text from XML: references read, CDATA sections as they are, and each
 * tag (when `tags`) as a space. One pass: a tag or section that never
 * closes ends the text. */
function text(xml: string, tags = false): string {
  if (!xml.includes("<")) return unescape(xml);
  let out = "";
  let at = 0;
  while (at < xml.length) {
    const lt = xml.indexOf("<", at);
    if (lt === -1) {
      out += unescape(xml.slice(at));
      break;
    }
    out += unescape(xml.slice(at, lt));
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      out += xml.slice(lt + 9, end === -1 ? undefined : end);
      if (end === -1) break;
      at = end + 3;
      continue;
    }
    if (!tags) {
      out += "<";
      at = lt + 1;
      continue;
    }
    const gt = xml.indexOf(">", lt);
    if (gt === -1) break;
    out += " ";
    at = gt + 1;
  }
  return out;
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? unescape(m[1] ?? m[2] ?? "") : null;
};

/** Whether the text at `at` goes on a tag's name ("<Level" in "<Level>",
 * not in "<LevelName>"). */
const nameEnds = (xml: string, at: number) => {
  const c = xml[at] ?? "";
  return c === ">" || c === "/" || /\s/.test(c);
};

/** The first <name …> tag itself, attributes and all. */
function openTag(xml: string, name: string): string {
  let at = 0;
  for (;;) {
    const open = xml.indexOf(`<${name}`, at);
    if (open === -1) return "";
    if (nameEnds(xml, open + name.length + 1)) {
      const gt = xml.indexOf(">", open);
      return gt === -1 ? "" : xml.slice(open, gt + 1);
    }
    at = open + 1;
  }
}

/** The inside of the first <name>…</name>, found by searching. */
function element(xml: string, name: string): string | null {
  let at = 0;
  for (;;) {
    const open = xml.indexOf(`<${name}`, at);
    if (open === -1) return null;
    if (!nameEnds(xml, open + name.length + 1)) {
      at = open + 1;
      continue;
    }
    const gt = xml.indexOf(">", open);
    if (gt === -1) return null;
    if (xml[gt - 1] === "/") return "";
    const close = xml.indexOf(`</${name}>`, gt);
    return close === -1 ? null : xml.slice(gt + 1, close);
  }
}

/** The data an event carries, for when there's no rendered message:
 * "Name: value" for named values (a classic event's param1, param2… as
 * bare values), joined. Binary data is left out. */
function eventData(xml: string): string {
  const data = element(xml, "EventData") ?? element(xml, "UserData") ?? "";
  const values: string[] = [];
  let named = false;
  let found = false;
  let at = 0;
  for (;;) {
    const open = data.indexOf("<Data", at);
    if (open === -1) break;
    if (!nameEnds(data, open + 5)) {
      at = open + 1;
      continue;
    }
    const gt = data.indexOf(">", open);
    if (gt === -1) break;
    found = true;
    at = gt + 1;
    if (data[gt - 1] === "/") continue;
    const close = data.indexOf("</Data>", gt);
    if (close === -1) break;
    at = close + 7;
    const value = text(data.slice(gt + 1, close)).trim();
    if (!value) continue;
    const name = attr(data.slice(open, gt), "Name");
    if (name && !/^param\d+$/i.test(name)) {
      named = true;
      values.push(`${name}: ${value}`);
    } else {
      values.push(value);
    }
  }
  if (found) return values.join(named ? "; " : " ");
  // Other data (UserData has its own elements): their text.
  const binary = data.indexOf("<Binary");
  const kept = binary === -1 ? data : data.slice(0, binary);
  return text(kept, true).replace(/\s+/g, " ").trim();
}

/** "2026-10-14T20:51:02.1234567Z" as the viewer's wall-clock time. */
function systemTime(time: string, context: Context): number | null {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/.exec(
      time.trim(),
    );
  if (!m) return null;
  const n = (i: number) => Number(m[i] ?? 0);
  let utc = Date.UTC(n(1), n(2) - 1, n(3), n(4), n(5), n(6));
  const zone = m[8];
  if (zone && zone !== "Z") {
    const sign = zone[0] === "-" ? -1 : 1;
    const [h, min] = zone.slice(1).split(":").map(Number);
    utc -= sign * ((h ?? 0) * 60 + (min ?? 0)) * 60_000;
  }
  return utc - context.offset(utc) * 60_000;
}

const START = /<Event[\s>]/;
const END = "</Event>";

export function windowsXml(emit: Emit, context: Context): Parser {
  // Inside an event: its text so far. Outside: the end of the last piece,
  // which may hold the start of "<Event".
  let buffer = "";
  let inside = false;
  let named = false;

  const event = (xml: string) => {
    const system = element(xml, "System");
    if (system === null) {
      context.skip();
      return;
    }
    const provider = openTag(system, "Provider");
    // BugCheck and DCOM are classic sources under a newer provider: both
    // names count (known.ts).
    const source = eventSource(
      attr(provider, "Name") ?? "",
      attr(provider, "EventSourceName"),
    );
    const id = element(system, "EventID")?.trim() ?? null;
    const levelN = element(system, "Level");
    const created = openTag(system, "TimeCreated");
    const channel = element(system, "Channel");
    if (channel && !named) {
      context.logName(unescape(channel.trim()));
      named = true;
    }
    const rendering = element(xml, "RenderingInfo");
    const rendered = rendering ? element(rendering, "Message") : null;
    const renderedLevel = rendering
      ? text(element(rendering, "Level") ?? "").trim()
      : "";
    const level =
      (levelN !== null ? levelNumber(Number(levelN)) : null) ??
      (renderedLevel ? levelWord(renderedLevel) : null);
    if (!level && renderedLevel) context.unknownLevel(renderedLevel);
    const event: LogEvent = {
      time: systemTime(attr(created, "SystemTime") ?? "", context),
      level,
      source,
      id: id && /^\d+$/.test(id) ? String(Number(id)) : null,
      message: rendered ? text(rendered).trim() : eventData(xml),
    };
    emit(event);
  };

  return {
    line(piece, more = false) {
      // A line break only where the file has one.
      const lineEnd = more ? "" : "\n";
      let rest = piece;
      for (;;) {
        if (!inside) {
          const hay = buffer + rest;
          buffer = "";
          const start = hay.search(START);
          if (start === -1) {
            // "<Event" may go on in the next piece or line.
            buffer = hay.slice(-6) + lineEnd;
            return;
          }
          inside = true;
          rest = hay.slice(start);
        }
        // The end tag may begin in the text so far.
        const look = buffer.slice(-(END.length - 1));
        const hay = look + rest;
        const at = hay.indexOf(END);
        if (at === -1) {
          buffer += rest + lineEnd;
          if (buffer.length > MAX_EVENT) {
            context.skip();
            inside = false;
            buffer = "";
          }
          return;
        }
        const whole =
          buffer.slice(0, buffer.length - look.length) + hay.slice(0, at);
        inside = false;
        buffer = "";
        event(whole);
        rest = rest.slice(at + END.length - look.length);
      }
    },
    end() {
      if (inside) context.skip();
    },
  };
}
