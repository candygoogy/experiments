// The HEIC preview's parsing: where the picture's tiles are, how the
// decoder is set up, and which way up the picture goes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  asMain,
  codecString,
  heicPictures,
  stepsMatrix,
  turnedSize,
  type Step,
} from "../src/heic-picture";
import { box, bytes, heic, PICTURES } from "./craft";
import { hvcC, picture } from "./picture";

const record = (level = 93) => new Uint8Array(hvcC(level).slice(8));
const at = (
  m: [number, number, number, number, number, number],
  x: number,
  y: number,
) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

describe("codec strings", () => {
  test("an iPhone's tiles and thumbnail", () => {
    // The values an iPhone 16 Pro writes: Main Still Picture, compatible
    // with Main and Main 10, level 3.1 (93) for the tiles, 3 (90) for the
    // thumbnail.
    expect(codecString(record())).toBe("hvc1.3.E.L93.B0");
    expect(codecString(record(90))).toBe("hvc1.3.E.L90.B0");
    expect(asMain("hvc1.3.E.L93.B0", record())).toBe("hvc1.1.6.L93.B0");
  });

  test("Main profile, high tier, a profile space, no constraints", () => {
    const main = record();
    main[1] = 0x01;
    main[2] = 0x60;
    expect(codecString(main)).toBe("hvc1.1.6.L93.B0");
    expect(asMain("hvc1.1.6.L93.B0", main)).toBeNull();
    const odd = record(120);
    odd[1] = 0x40 | 0x20 | 0x02;
    odd[2] = 0x20;
    odd[6] = 0;
    expect(codecString(odd)).toBe("hvc1.A2.4.H120");
  });

  test("a record too short to be one", () => {
    expect(() => codecString(new Uint8Array(10))).toThrow();
  });
});

describe("the picture", () => {
  test("a grid of tiles, in order, with a thumbnail", () => {
    const file = picture({
      rows: 2,
      columns: 3,
      tile: [64, 32],
      size: [180, 60],
      thumbnail: [45, 15],
    });
    const found = heicPictures(file);
    expect(found).not.toBeNull();
    const { primary, thumbnail } = found ?? {};
    expect(primary).toMatchObject({
      width: 180,
      height: 60,
      columns: 3,
      tileWidth: 64,
      tileHeight: 32,
      steps: [],
    });
    expect(primary?.tiles.map((t) => t.data[4])).toEqual([1, 2, 3, 4, 5, 6]);
    expect(primary?.tiles[0]?.settings.codec).toBe("hvc1.3.E.L93.B0");
    expect(primary?.tiles[0]?.settings.description.length).toBe(23);
    // One set of settings for every tile: the decoder is set up once.
    expect(new Set(primary?.tiles.map((t) => t.settings)).size).toBe(1);
    expect(thumbnail).toMatchObject({ width: 45, height: 15, columns: 1 });
    expect(thumbnail?.tiles[0]?.settings.codec).toBe("hvc1.3.E.L90.B0");
  });

  test("the turn and flip, in the order stored", () => {
    const found = heicPictures(
      picture({ rows: 1, columns: 2, tile: [8, 8], turn: 3, flip: 0 }),
    );
    expect(found?.primary.steps).toEqual([{ turn: 270 }, { flip: "across" }]);
    expect(found?.thumbnail).toBeUndefined();
  });

  test("tiles that don't cover the picture: no preview", () => {
    expect(
      heicPictures(
        picture({ rows: 1, columns: 2, tile: [8, 8], size: [20, 8] }),
      ),
    ).toBeNull();
  });

  test("a HEIC without picture properties: no preview, no error", () => {
    expect(heicPictures(heic(PICTURES))).toBeNull();
    expect(heicPictures(new Uint8Array([...box("ftyp", bytes("heic"))]))).toBe(
      null,
    );
  });

  test("the iPhone-shaped fixture's structure is followed", () => {
    // Its hvcC holds filler, but the grid, tiles and thumbnail are found.
    const file = readFileSync(
      join(import.meta.dirname, "fixtures/iphone.heic"),
    );
    const found = heicPictures(new Uint8Array(file));
    expect(found?.primary).toMatchObject({ width: 64, height: 64, columns: 2 });
    expect(found?.primary.steps).toEqual([{ turn: 270 }]);
    expect(found?.thumbnail).toMatchObject({ width: 32, height: 32 });
  });
});

describe("turning the picture", () => {
  // Where the picture's corners land: top left, top right, bottom left.
  const corners = (steps: Step[]) => {
    const m = stepsMatrix(4, 2, steps);
    return [at(m, 0, 0), at(m, 4, 0), at(m, 0, 2)];
  };

  test("a quarter turn anticlockwise", () => {
    expect(turnedSize(4, 2, [{ turn: 90 }])).toEqual({ width: 2, height: 4 });
    // The top edge becomes the left edge, read upwards.
    expect(corners([{ turn: 90 }])).toEqual([
      [0, 4],
      [0, 0],
      [2, 4],
    ]);
  });

  test("three quarters (an iPhone held upright)", () => {
    expect(corners([{ turn: 270 }])).toEqual([
      [2, 0],
      [2, 4],
      [0, 0],
    ]);
  });

  test("a half turn, and flips", () => {
    expect(turnedSize(4, 2, [{ turn: 180 }])).toEqual({ width: 4, height: 2 });
    expect(corners([{ turn: 180 }])).toEqual([
      [4, 2],
      [0, 2],
      [4, 0],
    ]);
    expect(corners([{ flip: "across" }])).toEqual([
      [4, 0],
      [0, 0],
      [4, 2],
    ]);
    expect(corners([{ flip: "down" }])).toEqual([
      [0, 2],
      [4, 2],
      [0, 0],
    ]);
  });

  test("a turn, then a flip: the flip is across the turned picture", () => {
    expect(corners([{ turn: 90 }, { flip: "across" }])).toEqual([
      [2, 4],
      [2, 0],
      [0, 4],
    ]);
  });
});
