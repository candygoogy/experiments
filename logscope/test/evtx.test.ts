// Windows' own .evtx files: the synthetic week in fixtures/system.evtx
// (the same events as wevtutil.xml, which Get-WinEvent opens too), and
// the ways a real file can be damaged.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { analyzer, analyzeText, type Options } from "../src/analyze.ts";
import { copy, fill } from "../src/copy.ts";
import { EVTX_CHUNK, evtxChunk, evtxStart, isChunk } from "../src/evtx.ts";
import type { Result } from "../src/model.ts";
import { about, verdict } from "../src/summary.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const bytes = (name: string) =>
  new Uint8Array(readFileSync(join(FIXTURES, name)));
const OPTIONS: Options = { offset: () => 0 };
const HEADER = 4096;
const RESTARTS =
  "This PC restarted without shutting down 3 times, once after a blue screen.";

/** A whole .evtx, a chunk at a time, as the worker reads it. */
function read(file: Uint8Array): Result & { chunks: number } {
  const run = analyzer("evtx", OPTIONS);
  let chunks = 0;
  for (let at = evtxStart(file); at < file.length; at += EVTX_CHUNK) {
    const chunk = file.subarray(at, at + EVTX_CHUNK);
    if (isChunk(chunk)) chunks++;
    evtxChunk(chunk, (xml) => run.line(xml), run.skip);
  }
  return { ...run.end(), chunks };
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset);
/** Where each record of a chunk starts. */
function records(file: Uint8Array, chunk: number): number[] {
  const v = view(file);
  const base = HEADER + chunk * EVTX_CHUNK;
  const starts: number[] = [];
  for (let at = base + 512; v.getUint32(at, true) === 0x2a2a;) {
    starts.push(at);
    at += v.getUint32(at + 4, true);
  }
  return starts;
}

const week = bytes("system.evtx");
const xml = analyzeText(
  readFileSync(join(FIXTURES, "wevtutil.xml"), "utf8"),
  "ev-xml",
  OPTIONS,
);

describe("an .evtx file", () => {
  test("reads as the same events wevtutil writes out as XML", () => {
    const r = read(week);
    expect(r.chunks).toBeGreaterThan(1);
    expect(r.events).toBe(xml.events);
    expect(r.skipped).toBe(0);
    const { chunks, ...result } = r;
    expect(chunks).toBe(6);
    expect({ ...result, format: "ev-xml" }).toEqual(xml);
  });

  test("gives the verdict and says what it read", () => {
    const r = read(week);
    expect(r.format).toBe("evtx");
    expect(r.logName).toBe("System");
    expect(verdict(r)).toBe(RESTARTS);
    expect(about(r)).toContain("events in the System log");
    expect(about(r)).toContain("exported as .evtx");
  });

  test("a classic source's list of strings is one <Data> each", () => {
    const r = read(week);
    const g = r.groups.find((g) => g.source === "EventLog" && g.id === "6008");
    expect(g?.samples[0]).toMatch(/^Detail: The previous system shutdown at/);
  });

  test("a header with no chunks after it has nothing to read", () => {
    expect(read(bytes("fake.evtx")).chunks).toBe(0);
  });
});

describe("a damaged or unfinished .evtx", () => {
  test("copied while Windows was writing it: dirty, its headers behind", () => {
    const file = week.slice();
    const v = view(file);
    // The file's header: dirty, and from when there were fewer chunks.
    v.setUint32(120, 1, true);
    v.setUint16(42, 2, true);
    v.setBigUint64(16, 1n, true);
    // The newest chunk's header: from when it held its first 3 records.
    const last = (file.length - HEADER) / EVTX_CHUNK - 1;
    const third = records(file, last)[3] ?? 0;
    v.setUint32(
      HEADER + last * EVTX_CHUNK + 48,
      third - HEADER - last * EVTX_CHUNK,
      true,
    );
    const r = read(file);
    expect(r.events).toBe(xml.events);
    expect(r.skipped).toBe(0);
  });

  test("leftovers past a chunk's free space don't count", () => {
    const file = week.slice();
    const v = view(file);
    // The first chunk's free space starts after its 3rd record, and the
    // 4th has an older number: a leftover from when the chunk was used
    // before.
    const starts = records(file, 0);
    const fourth = starts[3] ?? 0;
    v.setUint32(HEADER + 48, fourth - HEADER, true);
    v.setBigUint64(fourth + 8, 1n, true);
    const r = read(file);
    expect(r.events).toBe(3 + xml.events - starts.length);
  });

  test("cut off in the middle of a record", () => {
    const starts = records(week, 2);
    const cut = (starts[5] ?? 0) + 40;
    const r = read(week.slice(0, cut));
    const before = records(week, 0).length + records(week, 1).length + 5;
    expect(r.events).toBe(before);
    expect(r.skipped).toBe(1);
  });

  test("cut off in a record's header", () => {
    const starts = records(week, 2);
    const r = read(week.slice(0, (starts[5] ?? 0) + 10));
    expect(r.skipped).toBe(1);
  });

  test("a chunk of zeros (space set aside) is passed over", () => {
    const file = week.slice();
    file.fill(0, HEADER + EVTX_CHUNK, HEADER + 2 * EVTX_CHUNK);
    const r = read(file);
    expect(r.chunks).toBe(5);
    expect(r.events).toBe(xml.events - records(week, 1).length);
    expect(r.skipped).toBe(0);
  });

  test("a broken event is skipped; the next ones still read", () => {
    const file = week.slice();
    // The first record's template token: every later record of the chunk
    // points back to the template it writes out.
    const first = records(file, 0)[0] ?? 0;
    expect(file[first + 24 + 4]).toBe(0x0c);
    file[first + 24 + 4] = 0xee;
    const r = read(file);
    expect(r.skipped).toBe(1);
    expect(r.events).toBe(xml.events - 1);
    // An .evtx holds events, so the summary counts events, not lines.
    expect(about(r)).toContain(copy.skippedEventOne);
    expect(about({ ...r, skipped: 2 })).toContain(
      fill(copy.skippedEvents, { n: 2 }),
    );
    expect(about({ ...r, format: "ev-xml" })).toContain(copy.skippedOne);
  });

  test("bytes that make no sense never hang or throw", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const chunk = week.slice(HEADER, HEADER + EVTX_CHUNK);
    for (let round = 0; round < 50; round++) {
      const broken = chunk.slice();
      // A few hundred bytes changed anywhere after the chunk's header.
      for (let i = 0; i < 300; i++) {
        broken[512 + Math.floor(random() * (EVTX_CHUNK - 512))] = Math.floor(
          random() * 256,
        );
      }
      let events = 0;
      expect(() =>
        evtxChunk(
          broken,
          () => events++,
          () => {},
        ),
      ).not.toThrow();
      expect(events).toBeLessThanOrEqual(records(week, 0).length);
    }
  });

  test("a template inside itself, or nested past any real event, is skipped", () => {
    // A record whose binary XML is a template instance pointing at itself.
    const r = crafted((chunk, v, body) => {
      // Fragment header, then a template whose definition is at `def`.
      chunk.set([0x0f, 1, 1, 0, 0x0c, 1, 0, 0, 0, 0], body);
      const def = body + 14;
      v.setUint32(body + 10, def, true);
      // Its body: a fragment holding an instance of the same template.
      v.setUint32(def + 20, 14, true);
      chunk.set([0x0f, 1, 1, 0, 0x0c, 1, 0, 0, 0, 0], def + 24);
      v.setUint32(def + 24 + 10, def, true);
      v.setUint32(def + 24 + 14, 0, true);
    });
    expect(r.out).toEqual([]);
    expect(r.skipped).toBe(1);
  });

  test("templates each holding many of the next are given up on, quickly", () => {
    // Six templates, each holding 40 instances of the next, none writing
    // anything: 40^6 instances to write out, hours of work without a cap.
    const LEVELS = 6;
    const FAN = 40;
    const start = performance.now();
    const r = crafted((chunk, v, body) => {
      const def = (level: number) => body + 64 + level * 1024;
      // An instance with no values of the template at `at`: 14 bytes.
      const instance = (from: number, at: number) => {
        chunk.set([0x0c, 1, 0, 0, 0, 0], from);
        v.setUint32(from + 6, at, true);
        v.setUint32(from + 10, 0, true);
        return from + 14;
      };
      chunk.set([0x0f, 1, 1, 0], body);
      instance(body + 4, def(0));
      // Each one's body; the zeros after it end it.
      for (let level = 0; level < LEVELS; level++) {
        chunk.set([0x0f, 1, 1, 0], def(level) + 24);
        let at = def(level) + 28;
        if (level < LEVELS - 1) {
          for (let i = 0; i < FAN; i++) at = instance(at, def(level + 1));
        }
      }
    }, 8192);
    expect(r.out).toEqual([]);
    expect(r.skipped).toBe(1);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  test("a number sized wrong is shown as nothing, not read from its neighbours", () => {
    // <Event><EventID/><Level/></Event> filled in with a UInt64 two bytes
    // long, then a UInt32 that's right.
    const r = crafted((chunk, v, body) => {
      const name = (at: number, text: string) => {
        v.setUint16(at + 6, text.length, true);
        [...text].forEach((c, i) =>
          v.setUint16(at + 8 + i * 2, c.charCodeAt(0), true),
        );
        return at;
      };
      const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, n >> 16, 0];
      const open = (at: number) => [
        0x01,
        0xff,
        0xff,
        0,
        0,
        0,
        0,
        ...u32(at),
        0x02,
      ];
      const event = name(body + 512, "Event");
      const id = name(body + 544, "EventID");
      const level = name(body + 576, "Level");
      const def = body + 256;
      chunk.set(
        [
          ...[0x0f, 1, 1, 0],
          ...open(event),
          ...[...open(id), 0x0d, 0, 0, 0x0a, 0x04],
          ...[...open(level), 0x0d, 1, 0, 0x08, 0x04],
          ...[0x04, 0x00],
        ],
        def + 24,
      );
      chunk.set(
        [
          ...[0x0f, 1, 1, 0, 0x0c, 1, 0, 0, 0, 0, ...u32(def)],
          // Two values: their sizes and types, then their bytes.
          ...[...u32(2), 2, 0, 0x0a, 0, 4, 0, 0x08, 0],
          ...[0x39, 0x1b, 4, 0, 0, 0, 0x00],
        ],
        body,
      );
    }, 1024);
    expect(r.out).toEqual([
      "<Event><EventID></EventID><Level>4</Level></Event>",
    ]);
    expect(r.skipped).toBe(0);
  });
});

/** A chunk holding one record of `size` bytes, its binary XML written by
 * `write` from `body` on, and what it reads as. Offsets in binary XML are
 * from the chunk's start. */
function crafted(
  write: (chunk: Uint8Array, v: DataView, body: number) => void,
  size = 400,
): { out: string[]; skipped: number } {
  const chunk = new Uint8Array(EVTX_CHUNK);
  const v = view(chunk);
  chunk.set([..."ElfChnk\0"].map((c) => c.charCodeAt(0)));
  v.setBigUint64(24, 1n, true);
  v.setUint32(48, EVTX_CHUNK, true);
  const at = 512;
  write(chunk, v, at + 24);
  v.setUint32(at, 0x2a2a, true);
  v.setUint32(at + 4, size, true);
  v.setBigUint64(at + 8, 1n, true);
  v.setUint32(at + size - 4, size, true);
  let skipped = 0;
  const out: string[] = [];
  evtxChunk(
    chunk,
    (x) => out.push(x),
    () => skipped++,
  );
  return { out, skipped };
}
