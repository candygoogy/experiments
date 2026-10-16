// HEIC files crafted to reach the corners: Exif about a helper picture,
// details stored inside another item, boxes whose counts ask for more than
// they hold, and metadata too big for one JPEG segment.
import { describe, expect, test } from "vitest";
import { CantClean, heifMeta } from "../src/heif";
import { readMeta } from "../src/read";
import { stripHeic, stripWebp } from "../src/strip/index";
import { sentences, summarize } from "../src/summary";

import {
  ARTIST,
  box,
  bytes,
  DESCRIPTION,
  exifPayload,
  FTYP,
  full,
  heic,
  HELPER,
  PICTURES,
  MARKER,
  u16,
  u32,
  xmpPacket,
} from "./craft";

const has = (b: Uint8Array, s: string) =>
  Buffer.from(b).toString("latin1").includes(s);

describe("Exif about a helper picture", () => {
  const file = heic(
    [
      ...PICTURES,
      { id: 3, type: "Exif", payload: exifPayload([[ARTIST, MARKER]]) },
    ],
    [HELPER, box("cdsc", u16(3), u16(1), u16(2))],
  );

  test("is the photo's: read, and said", async () => {
    expect(heifMeta(file).exif.map((x) => x.id)).toEqual([3]);
    const meta = await readMeta(file, "heic");
    expect(sentences(summarize(meta))).toContain(
      `It names a person: ${MARKER}.`,
    );
  });

  test("is blanked in the clean copy, with no trace left", async () => {
    const out = stripHeic(file, 1);
    expect(out.length).toBe(file.length);
    expect(has(out, MARKER)).toBe(false);
    expect(await readMeta(out, "heic")).toBeUndefined();
  });

  test("XMP about the helper stays when it only says how to draw it", async () => {
    const gainMap = bytes(
      `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 6.0.0"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:HDRGainMap="http://ns.apple.com/HDRGainMap/1.0/"><HDRGainMap:HDRGainMapVersion>131072</HDRGainMap:HDRGainMapVersion></rdf:Description></rdf:RDF></x:xmpmeta>`,
    );
    const withXmp = heic(
      [...PICTURES, { id: 4, type: "xmp", payload: gainMap }],
      [HELPER, box("cdsc", u16(4), u16(1), u16(2))],
    );
    expect(heifMeta(withXmp).xmp).toEqual([]);
    expect(await readMeta(withXmp, "heic")).toBeUndefined();
    expect(has(stripHeic(withXmp, 1), "HDRGainMapVersion>131072")).toBe(true);
  });

  test("XMP about the helper that says more is read, and blanked", async () => {
    // A creator in a helper's XMP: no gain map needs one.
    const withXmp = heic(
      [...PICTURES, { id: 4, type: "xmp", payload: xmpPacket(MARKER) }],
      [HELPER, box("cdsc", u16(4), u16(1), u16(2))],
    );
    expect(heifMeta(withXmp).xmp.map((x) => x.id)).toEqual([4]);
    expect(sentences(summarize(await readMeta(withXmp, "heic")))).toContain(
      `It names a person: ${MARKER}.`,
    );
    expect(has(stripHeic(withXmp, 1), MARKER)).toBe(false);
  });
});

describe("details stored inside another item (iloc method 2)", () => {
  test.each(["Exif", "xmp"] as const)(
    "%s: can't be cleaned, and the page doesn't say nothing's there",
    async (type) => {
      const payload =
        type === "Exif" ? exifPayload([[ARTIST, MARKER]]) : xmpPacket(MARKER);
      const file = heic(
        [...PICTURES, { id: 3, type, payload, method: 2 }],
        [box("cdsc", u16(3), u16(1), u16(1))],
      );
      expect(() => heifMeta(file)).toThrow(CantClean);
      await expect(readMeta(file, "heic")).rejects.toThrow(CantClean);
      expect(() => stripHeic(file, 1)).toThrow(CantClean);
    },
  );
});

describe("a crafted HEIC can't make the reading run long", () => {
  const MB = 1 << 20;
  /** ftyp, a meta box holding `inside`, then a megabyte of 0xff. */
  const crafted = (inside: number[]) => {
    const head = [...FTYP, ...full("meta", 0, ...[inside])];
    const out = new Uint8Array(head.length + MB + 8);
    out.set(head);
    out.set([...u32(MB + 8), ...bytes("free")], head.length);
    out.fill(0xff, head.length + 8);
    return out;
  };
  const iinf = full(
    "iinf",
    0,
    u16(1),
    full("infe", 2, u16(3), u16(0), bytes("Exif"), [0]),
  );
  /** The file, with a free box of 0xff bytes after it up to 1 MB. */
  const atLeastOneMb = (file: Uint8Array | readonly number[]) => {
    const pad = Math.max(0, MB - file.length - 8);
    const out = new Uint8Array(file.length + (pad ? pad + 8 : 0));
    out.set(file);
    if (pad) {
      out.set([...u32(pad + 8), ...bytes("free")], file.length);
      out.fill(0xff, file.length + 8);
    }
    return out;
  };
  /** A megabyte-long box of 0xff bytes after its first fields. */
  const long = (type: string, version: number, ...head: number[][]) => {
    const flat = head.flat();
    return [
      ...u32(12 + flat.length + MB),
      ...bytes(type),
      version,
      0,
      0,
      0,
      ...flat,
      ...new Array<number>(MB).fill(0xff),
    ];
  };

  test.each([
    // An item count far past the box, every field zero bytes wide.
    [
      "iloc v2, a huge count",
      crafted([...iinf, ...full("iloc", 2, [0, 0], u32(0xffffffff))]),
    ],
    // Entries with no fields and 65535 extents each, a megabyte of them.
    [
      "iloc, zero-size extents",
      [
        ...FTYP,
        ...full("meta", 0, iinf, long("iloc", 2, [0, 0], u32(0x7fffffff))),
      ],
    ],
    // A megabyte of real-looking entries, each with many extents.
    [
      "iloc, a megabyte of entries",
      [
        ...FTYP,
        ...full("meta", 0, iinf, long("iloc", 1, [0x44, 0], u16(0xffff))),
      ],
    ],
    // A content type that runs a megabyte.
    [
      "iinf, a megabyte-long mime entry",
      [
        ...FTYP,
        ...full(
          "meta",
          0,
          full(
            "iinf",
            0,
            u16(1),
            long("infe", 2, u16(4), u16(0), bytes("mime")),
          ),
          full("iloc", 1, [0x44, 0], u16(0)),
        ),
      ],
    ],
    // A reference claiming 65535 targets in a few bytes.
    [
      "iref, a count past its box",
      [
        ...FTYP,
        ...full(
          "meta",
          0,
          iinf,
          full("iloc", 1, [0x44, 0], u16(0)),
          full("iref", 0, box("cdsc", u16(3), u16(0xffff), u16(1))),
        ),
      ],
    ],
  ] as const)("%s: a 1 MB file, well under 200 ms", (_name, file) => {
    const b = atLeastOneMb(file);
    expect(b.length).toBeGreaterThanOrEqual(MB);
    const start = performance.now();
    // Reading, then cleaning, as the page does.
    for (const run of [() => heifMeta(b), () => stripHeic(b, 1)]) {
      try {
        run();
      } catch {
        // Refused is fine; slow isn't.
      }
    }
    expect(performance.now() - start).toBeLessThan(200);
  });

  test("a count past its box is refused, not read from the next box", () => {
    const one = [
      ...u16(3),
      ...u16(0),
      ...u16(0),
      ...u16(1),
      ...u32(0),
      ...u32(4),
    ];
    const file = new Uint8Array([
      ...FTYP,
      ...full("meta", 0, iinf, full("iloc", 1, [0x44, 0], u16(2), one)),
      ...box("free", new Array<number>(64).fill(0)),
    ]);
    expect(() => heifMeta(file)).toThrow(/box/);
  });
});

describe("details bigger than one JPEG segment (64 KB)", () => {
  test("a HEIC's large Exif and large XMP are read in full", async () => {
    const file = heic(
      [
        ...PICTURES,
        {
          id: 3,
          type: "Exif",
          payload: exifPayload([
            [DESCRIPTION, "d".repeat(70_000)],
            [ARTIST, "Exif Person"],
          ]),
        },
        { id: 4, type: "xmp", payload: xmpPacket("Xmp Person", 80_000) },
      ],
      [
        box("cdsc", u16(3), u16(1), u16(1)),
        box("cdsc", u16(4), u16(1), u16(1)),
      ],
    );
    const meta = await readMeta(file, "heic");
    expect(meta?.["Artist"]).toBe("Exif Person");
    expect(summarize(meta).names).toEqual(["Exif Person", "Xmp Person"]);
    expect(await readMeta(stripHeic(file, 1), "heic")).toBeUndefined();
  });

  test("a WebP's large XMP is read in full", async () => {
    const chunk = (type: string, body: number[]) => {
      const out = [...bytes(type), ...u32(body.length).reverse(), ...body];
      return body.length % 2 ? [...out, 0] : out;
    };
    const vp8x = chunk("VP8X", [0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // A lossless picture's header (its bytes aren't drawn here).
    const vp8l = chunk("VP8L", [0x2f, 0, 0, 0, 0]);
    const xmp = chunk("XMP ", xmpPacket("Xmp Person", 80_000));
    const body = [...bytes("WEBP"), ...vp8x, ...vp8l, ...xmp];
    const file = new Uint8Array([
      ...bytes("RIFF"),
      ...u32(body.length).reverse(),
      ...body,
    ]);
    const meta = await readMeta(file, "webp");
    expect(summarize(meta).names).toEqual(["Xmp Person"]);
    expect(await readMeta(stripWebp(file), "webp")).toBeUndefined();
  });
});
