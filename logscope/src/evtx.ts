// Windows' own event log files (.evtx): what Event Viewer's "Save All
// Events As…" writes by default, and what `wevtutil epl` exports.
//
// A file is a 4 KB header, then 64 KB chunks of event records. Each event
// is "binary XML": tokens for elements, attributes and text. Most of it is
// a template (the event's shape, written once per chunk and pointed back
// to after that) filled in with values. Element and attribute names are
// written once per chunk too. Each record becomes the XML that
// `wevtutil qe /f:xml` writes for it, which windows-xml.ts reads: there's
// no rendered message in the file (that comes from the provider's files
// on the PC that logged it), so the event's data values stand in for it.
//
// The file is read a chunk at a time. Nothing in it is trusted: every
// read is bounds-checked, nesting is capped, and an event that doesn't
// make sense is skipped, never guessed at.

/** The size of a chunk. */
export const EVTX_CHUNK = 0x10000;
// A chunk's header; its records start after it.
const CHUNK_HEADER = 512;
// A record's header, before its binary XML, and the size copy after it.
const RECORD_HEADER = 24;
const RECORD_TAIL = 4;
const RECORD_MAGIC = 0x00002a2a;
// Templates and values inside values: real events go three or four deep.
const MAX_DEPTH = 32;
// An event's XML this long is broken, not big (as in windows-xml.ts).
const MAX_XML = 1 << 20;
// More values than any event has.
const MAX_VALUES = 4096;
// Tokens read and parts written in one chunk. A template is kept once but
// written out again for every instance of it, so templates holding many
// instances of the next one, a few deep, multiply into billions of steps
// that write nothing for MAX_XML to catch. The fixture's busiest chunk
// (87 events) takes about 5,000, some 60 an event; about 2 million is 400
// times that, room for chunks of far smaller or far bigger events, and
// running out of it takes a few milliseconds.
const MAX_WORK = 1 << 21;

const startsWith = (bytes: Uint8Array, magic: string) =>
  bytes.length >= magic.length &&
  [...magic].every((c, i) => bytes[i] === c.charCodeAt(0));

/** Where the first chunk starts, from the file's header. */
export function evtxStart(header: Uint8Array): number {
  const size =
    header.length >= 42 ? (header[40] ?? 0) | ((header[41] ?? 0) << 8) : 0;
  // Always 4096 in the files Windows writes.
  return size >= 128 ? size : 4096;
}

/** Whether a block of the file is a chunk of events. Space Windows set
 * aside for the log but hasn't used yet is zeros. */
export const isChunk = (bytes: Uint8Array) => startsWith(bytes, "ElfChnk\0");

/** One substitution value: its type and where its bytes are. */
interface Value {
  type: number;
  at: number;
  size: number;
}

/** A filled-in template: its shape, and the values for its slots. */
interface Instance {
  tree: Part[];
  values: Value[];
}

interface Element {
  name: string;
  attributes: [string, Part[]][];
  children: Part[];
}

interface Slot {
  slot: number;
  /** Left out, attribute and all, when it has no value. */
  optional: boolean;
}

/** XML as written, a slot for a value, an element, or a template. */
type Part = string | Slot | Element | Instance;

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};
const escape = (text: string) =>
  /[&<>"]/.test(text) ? text.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c) : text;

const hex = (n: number | bigint, digits: number) =>
  n.toString(16).padStart(digits, "0");

const utf16 = new TextDecoder("utf-16le");
const latin1 = new TextDecoder("windows-1252");

// The size of each fixed-size value type, alone or as an item of an array.
const ITEM: Record<number, number> = {
  0x03: 1,
  0x04: 1,
  0x05: 2,
  0x06: 2,
  0x07: 4,
  0x08: 4,
  0x09: 8,
  0x0a: 8,
  0x0b: 4,
  0x0c: 8,
  0x0d: 4,
  0x0f: 16,
  0x11: 8,
  0x12: 16,
  0x14: 4,
  0x15: 8,
};

// From 1601 (FILETIME's start) to 1970, in milliseconds.
const EPOCH_1601 = 11_644_473_600_000n;

class Chunk {
  private readonly view: DataView;
  private readonly names = new Map<number, string>();
  private readonly templates = new Map<number, Part[]>();
  private readonly bytes: Uint8Array;
  private pos = 0;
  private out = "";
  private work = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u8 = (at: number) => this.view.getUint8(at);
  u16 = (at: number) => this.view.getUint16(at, true);
  u32 = (at: number) => this.view.getUint32(at, true);
  u64 = (at: number) => this.view.getBigUint64(at, true);

  /** One more step; past MAX_WORK, every record left in the chunk is
   * skipped. */
  private step() {
    if (++this.work > MAX_WORK) throw new Error("too much work");
  }

  private chars(at: number, count: number): string {
    if (at + count * 2 > this.bytes.length) throw new RangeError("past end");
    return utf16.decode(this.bytes.subarray(at, at + count * 2));
  }

  /** A name the chunk keeps at `at`. */
  private nameAt(at: number): string {
    let name = this.names.get(at);
    if (name === undefined) {
      name = this.chars(at + 8, this.u16(at + 6));
      if (!/^[^\s<>&"'=/]+$/.test(name)) throw new Error("not a name");
      this.names.set(at, name);
    }
    return name;
  }

  /** A name's offset; a name used for the first time follows it. */
  private name(): string {
    const at = this.u32(this.pos);
    this.pos += 4;
    if (at === this.pos) this.pos += 10 + this.u16(at + 6) * 2;
    return this.nameAt(at);
  }

  /** Text in a value token: only strings. */
  private text(): string {
    const type = this.u8(this.pos);
    const count = this.u16(this.pos + 1);
    if (type !== 0x01) throw new Error("not text");
    const text = this.chars(this.pos + 3, count);
    this.pos += 3 + count * 2;
    return escape(text);
  }

  private slot(token: number): Slot {
    const slot = this.u16(this.pos + 1);
    this.pos += 4;
    return { slot, optional: token === 0x0e };
  }

  /** Tokens up to the end of an element or of the stream. */
  private content(depth: number): Part[] {
    if (depth > MAX_DEPTH) throw new Error("too deep");
    const parts: Part[] = [];
    for (;;) {
      this.step();
      const token = this.u8(this.pos);
      // 0x40 marks "more follows" or "has attributes".
      switch (token & ~0x40) {
        case 0x00: // end of stream
        case 0x04: // end of element
          this.pos++;
          return parts;
        case 0x01:
          parts.push(this.openElement(token, depth));
          break;
        case 0x05:
          this.pos++;
          parts.push(this.text());
          break;
        case 0x07: {
          const count = this.u16(this.pos + 1);
          const text = this.chars(this.pos + 3, count);
          this.pos += 3 + count * 2;
          parts.push(
            `<![CDATA[${text.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`,
          );
          break;
        }
        case 0x08: {
          const code = this.u16(this.pos + 1);
          this.pos += 3;
          parts.push(`&#${code};`);
          break;
        }
        case 0x09:
          this.pos++;
          parts.push(`&${this.name()};`);
          break;
        case 0x0a: // a processing instruction: nothing an event needs
          this.pos++;
          this.name();
          break;
        case 0x0b:
          this.pos += 3 + this.u16(this.pos + 1) * 2;
          break;
        case 0x0c:
          parts.push(this.instance(depth));
          break;
        case 0x0d:
        case 0x0e:
          parts.push(this.slot(token));
          break;
        case 0x0f: // a fragment's header
          this.pos += 4;
          break;
        default:
          throw new Error("unknown token");
      }
    }
  }

  private openElement(token: number, depth: number): Element {
    // The token, a dependency ID and the element's size.
    this.pos += 7;
    const name = this.name();
    if (token & 0x40) this.pos += 4; // the attributes' size
    const attributes: [string, Part[]][] = [];
    for (;;) {
      const next = this.u8(this.pos);
      if ((next & ~0x40) === 0x06) {
        this.pos++;
        const attribute = this.name();
        attributes.push([attribute, this.attributeValue()]);
        continue;
      }
      this.pos++;
      if (next === 0x02) {
        return { name, attributes, children: this.content(depth + 1) };
      }
      if (next === 0x03) return { name, attributes, children: [] };
      throw new Error("bad element");
    }
  }

  private attributeValue(): Part[] {
    const parts: Part[] = [];
    for (;;) {
      this.step();
      const token = this.u8(this.pos);
      const base = token & ~0x40;
      if (base === 0x05) {
        this.pos++;
        parts.push(this.text());
      } else if (base === 0x0d || base === 0x0e) {
        parts.push(this.slot(token));
      } else if (base === 0x08) {
        parts.push(`&#${this.u16(this.pos + 1)};`);
        this.pos += 3;
      } else if (base === 0x09) {
        this.pos++;
        parts.push(`&${this.name()};`);
      } else {
        return parts;
      }
    }
  }

  /** A template and its values. A template used for the first time in
   * the chunk is written out right here; later ones point back to it. */
  private instance(depth: number): Instance {
    // The token, one unknown byte and the template's ID.
    this.pos += 6;
    const at = this.u32(this.pos);
    this.pos += 4;
    if (at === this.pos) this.pos += 24 + this.u32(at + 20);
    const tree = this.template(at, depth);
    const count = this.u32(this.pos);
    if (count > MAX_VALUES) throw new Error("too many values");
    this.pos += 4;
    const values: Value[] = [];
    let next = this.pos + count * 4;
    for (let i = 0; i < count; i++) {
      const size = this.u16(this.pos + i * 4);
      values.push({ type: this.u8(this.pos + i * 4 + 2), at: next, size });
      next += size;
    }
    if (next > this.bytes.length) throw new RangeError("past end");
    this.pos = next;
    return { tree, values };
  }

  private template(at: number, depth: number): Part[] {
    let tree = this.templates.get(at);
    if (tree) return tree;
    // A template inside itself reads as empty.
    this.templates.set(at, []);
    const back = this.pos;
    this.pos = at + 24;
    try {
      tree = this.content(depth + 1);
    } catch (error) {
      this.templates.delete(at);
      throw error;
    }
    this.pos = back;
    this.templates.set(at, tree);
    return tree;
  }

  private write(text: string) {
    this.out += text;
    if (this.out.length > MAX_XML) throw new Error("too long");
  }

  private render(parts: Part[], values: Value[], depth: number) {
    if (depth > MAX_DEPTH) throw new Error("too deep");
    for (const part of parts) {
      this.step();
      if (typeof part === "string") this.write(part);
      else if ("slot" in part) this.value(values[part.slot], depth);
      else if ("tree" in part) this.render(part.tree, part.values, depth + 1);
      else this.element(part, values, depth);
    }
  }

  private element(part: Element, values: Value[], depth: number) {
    const [only] = part.children;
    // An element holding just a list of values is written once for each,
    // as wevtutil does: a classic event's <Data> strings.
    const list =
      part.children.length === 1 && typeof only === "object" && "slot" in only
        ? this.items(values[only.slot])
        : null;
    for (const item of list ?? [null]) {
      this.write(`<${part.name}`);
      for (const [name, value] of part.attributes) {
        // A step even when it's left out, which writes nothing.
        this.step();
        // Left out when it's only optional slots with no value.
        const empty = value.every(
          (p) =>
            typeof p === "object" &&
            "slot" in p &&
            p.optional &&
            !(values[p.slot]?.type && values[p.slot]?.size),
        );
        if (empty && value.length) continue;
        this.write(` ${name}="`);
        this.render(value, values, depth + 1);
        this.write('"');
      }
      if (item !== null) {
        this.write(`>${item}</${part.name}>`);
      } else if (!part.children.length) {
        this.write("/>");
      } else {
        this.write(">");
        this.render(part.children, values, depth + 1);
        this.write(`</${part.name}>`);
      }
    }
  }

  /** The items of a list value, as XML; null for any other value. */
  private items(value: Value | undefined): string[] | null {
    if (!value || !(value.type & 0x80)) return null;
    const { type, at, size } = value;
    if (at + size > this.bytes.length) throw new RangeError("past end");
    if (type === 0x81) {
      // Strings, each ending in a zero.
      const all = this.chars(at, size >> 1).split("\0");
      if (all.at(-1) === "") all.pop();
      return all.map(escape);
    }
    const item = ITEM[type & 0x7f];
    if (!item) return [];
    const items: string[] = [];
    for (let i = at; i + item <= at + size; i += item) {
      items.push(this.scalar(type & 0x7f, i, item));
    }
    return items;
  }

  /** A value as XML. */
  private value(value: Value | undefined, depth: number) {
    if (!value || !value.size) return;
    const { type, at, size } = value;
    if (at + size > this.bytes.length) throw new RangeError("past end");
    if (type === 0x21) {
      // Binary XML: an event's EventData or UserData, often a template
      // of its own.
      const back = this.pos;
      this.pos = at;
      const parts = this.content(depth + 1);
      this.pos = back;
      this.render(parts, [], depth + 1);
      return;
    }
    // A list anywhere else: its items in a row.
    const list = this.items(value);
    this.write(list ? list.join(", ") : this.scalar(type, at, size));
  }

  /** One value of a plain type, as wevtutil writes it. */
  private scalar(type: number, at: number, size: number): string {
    const v = this.view;
    // A fixed-size value of another size would be read from its
    // neighbours' bytes: shown as nothing, like any value that makes no
    // sense, and the rest of the event still reads. 0x10, a size, is 4 or
    // 8 bytes.
    const width = type === 0x10 ? (size === 8 ? 8 : 4) : ITEM[type];
    if (width !== undefined && size !== width) return "";
    switch (type) {
      case 0x01:
        return escape(this.chars(at, size >> 1).replace(/\0+$/, ""));
      case 0x02:
        return escape(
          latin1.decode(this.bytes.subarray(at, at + size)).replace(/\0+$/, ""),
        );
      case 0x03:
        return String(v.getInt8(at));
      case 0x04:
        return String(v.getUint8(at));
      case 0x05:
        return String(v.getInt16(at, true));
      case 0x06:
        return String(v.getUint16(at, true));
      case 0x07:
        return String(v.getInt32(at, true));
      case 0x08:
        return String(v.getUint32(at, true));
      case 0x09:
        return String(v.getBigInt64(at, true));
      case 0x0a:
        return String(v.getBigUint64(at, true));
      case 0x0b:
        return String(v.getFloat32(at, true));
      case 0x0c:
        return String(v.getFloat64(at, true));
      case 0x0d:
        return v.getUint32(at, true) ? "true" : "false";
      case 0x0e: {
        let out = "";
        for (const b of this.bytes.subarray(at, at + size)) {
          out += hex(b, 2).toUpperCase();
        }
        return out;
      }
      case 0x0f:
        return this.guid(at);
      case 0x10:
        return `0x${(size === 8 ? v.getBigUint64(at, true) : v.getUint32(at, true)).toString(16)}`;
      case 0x11:
        return this.filetime(at);
      case 0x12:
        return this.systemtime(at);
      case 0x13:
        return this.sid(at, size);
      case 0x14:
        return `0x${v.getUint32(at, true).toString(16)}`;
      case 0x15:
        return `0x${v.getBigUint64(at, true).toString(16)}`;
      default:
        // A handle, or a type no event uses: nothing to show.
        return "";
    }
  }

  private guid(at: number): string {
    const b = (i: number) => hex(this.u8(at + i), 2);
    const tail = [8, 9, 10, 11, 12, 13, 14, 15].map(b);
    return `{${hex(this.u32(at), 8)}-${hex(this.u16(at + 4), 4)}-${hex(this.u16(at + 6), 4)}-${tail.slice(0, 2).join("")}-${tail.slice(2).join("")}}`;
  }

  /** Hundreds of nanoseconds since 1601, as "2026-10-14T20:51:02.1234567Z". */
  private filetime(at: number): string {
    const ticks = this.u64(at);
    const ms = ticks / 10_000n - EPOCH_1601;
    const date = new Date(Number(ms));
    if (Number.isNaN(date.getTime()) || date.getUTCFullYear() > 9999) return "";
    const fraction = String(ticks % 10_000_000n).padStart(7, "0");
    return `${date.toISOString().slice(0, 19)}.${fraction}Z`;
  }

  private systemtime(at: number): string {
    const [
      year = 0,
      month = 0,
      ,
      day = 0,
      hour = 0,
      minute = 0,
      second = 0,
      ms = 0,
    ] = Array.from({ length: 8 }, (_, i) => this.u16(at + i * 2));
    const two = (n: number) => String(n).padStart(2, "0");
    return `${String(year).padStart(4, "0")}-${two(month)}-${two(day)}T${two(hour)}:${two(minute)}:${two(second)}.${String(ms).padStart(3, "0")}Z`;
  }

  /** "S-1-5-18". */
  private sid(at: number, size: number): string {
    const count = this.u8(at + 1);
    if (8 + count * 4 > size) return "";
    let authority = 0;
    for (let i = 2; i < 8; i++) authority = authority * 256 + this.u8(at + i);
    let out = `S-${this.u8(at)}-${authority}`;
    for (let i = 0; i < count; i++) out += `-${this.u32(at + 8 + i * 4)}`;
    return out;
  }

  /** One record's event as XML, from its binary XML at start…end. */
  event(start: number, end: number): string {
    this.pos = start;
    this.out = "";
    const parts = this.content(0);
    if (this.pos > end) throw new RangeError("past the record");
    this.render(parts, [], 0);
    if (!/^<Event[\s/>]/.test(this.out)) throw new Error("not an event");
    // Line breaks as in every other format, read a line at a time.
    return this.out.includes("\r")
      ? this.out.replace(/\r\n?/g, "\n")
      : this.out;
  }
}

/**
 * The events in a chunk, each as XML for windows-xml.ts. A record that
 * can't be read is skipped and counted.
 *
 * Records end where the chunk's header says its free space starts. Past
 * that, in a file copied while Windows was still writing to it, the
 * header can lag behind: records there count only while their numbers
 * carry on from the last one (older leftovers don't).
 */
export function evtxChunk(
  bytes: Uint8Array,
  emit: (xml: string) => void,
  skip: () => void,
): void {
  if (!isChunk(bytes) || bytes.length < CHUNK_HEADER) return;
  const chunk = new Chunk(bytes);
  const free = chunk.u32(48);
  const end =
    free >= CHUNK_HEADER && free <= bytes.length ? free : bytes.length;
  let last = chunk.u64(24) - 1n;
  let at = CHUNK_HEADER;
  while (at + RECORD_HEADER + RECORD_TAIL <= bytes.length) {
    if (chunk.u32(at) !== RECORD_MAGIC) break;
    const size = chunk.u32(at + 4);
    const id = chunk.u64(at + 8);
    const whole =
      size >= RECORD_HEADER + RECORD_TAIL &&
      at + size <= bytes.length &&
      chunk.u32(at + size - RECORD_TAIL) === size;
    if (at >= end && (!whole || id !== last + 1n)) break;
    if (!whole) {
      // Cut off (a file copied while it was being written) or broken: the
      // rest of the chunk can't be found.
      skip();
      break;
    }
    last = id;
    let xml: string | null = null;
    try {
      xml = chunk.event(at + RECORD_HEADER, at + size - RECORD_TAIL);
    } catch {
      skip();
    }
    if (xml !== null) emit(xml);
    at += size;
  }
  // The file ends inside a record's header: that one is cut off too.
  const left = bytes.subarray(at, Math.min(end, at + 4));
  if (
    at < end &&
    at + RECORD_HEADER + RECORD_TAIL > bytes.length &&
    left.length &&
    left.every((b, i) => b === [0x2a, 0x2a, 0, 0][i])
  ) {
    skip();
  }
}
