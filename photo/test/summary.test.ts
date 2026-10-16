import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { detect } from "../src/detect";
import { readMeta, readPhoto } from "../src/read";
import { details, sentences, summarize } from "../src/summary";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));

async function summaryOf(name: string) {
  const bytes = fixture(name);
  const type = detect(bytes);
  if (!type) throw new Error("not a photo");
  const read = await readPhoto(bytes, type);
  return summarize(read?.meta, read?.groups);
}

const GPS =
  "This photo carries the exact place it was taken (51.4769°\u00a0N, 0.0005°\u00a0W). Anyone you send it to can see it.";

describe("summary", () => {
  test("everything the GPS photo gives away, in the copy's order", async () => {
    expect(sentences(await summaryOf("gps.jpg"))).toEqual([
      GPS,
      "It names the camera that took it: Example Cam 1. The lens: Example 35mm.",
      "It records when it was taken: Oct 1, 2026, 12:00.",
      "It names the software that last saved it: Example Editor 2.",
      "It names a person: Test Person.",
      "It carries a comment: Made for a test.",
    ]);
  });

  test("the same from a PNG and a WebP (they hold no comment)", async () => {
    const jpeg = sentences(await summaryOf("gps.jpg")).filter(
      (line) => !line.startsWith("It carries a comment"),
    );
    expect(sentences(await summaryOf("meta.png"))).toEqual(jpeg);
    expect(sentences(await summaryOf("meta.webp"))).toEqual(jpeg);
  });

  test("places, owners, serial numbers, contacts and captions are said", () => {
    const said = sentences(
      summarize({
        City: "London",
        Sublocation: "Royal Observatory",
        Country: "United Kingdom",
        OwnerName: "Owner Person",
        XPAuthor: "Windows Person",
        rights: { lang: "x-default", value: "Rights Person" },
        SerialNumber: "SN123",
        LensSerialNumber: "LN456",
        CreatorContactInfo: { CiEmailWork: "someone@example.com" },
        ImageDescription: "A day out",
      }),
    );
    expect(said).toEqual([
      "It names a place: Royal Observatory, London, United Kingdom.",
      "It records serial numbers that can identify the camera or lens: SN123, LN456.",
      "It names a person: Windows Person, Owner Person, Rights Person.",
      "It holds contact details: someone@example.com.",
      "It carries a caption: A day out.",
    ]);
  });

  test("a country's code stands in only when its name is missing", () => {
    expect(sentences(summarize({ CountryCode: "IT" }))).toEqual([
      "It names a place: IT.",
    ]);
  });

  test("a location kept only in XMP is still a location", async () => {
    expect(sentences(await summaryOf("xmp-gps.jpg"))).toEqual([GPS]);
  });

  test("a photo with nothing in it", async () => {
    expect(sentences(await summaryOf("clean.jpg"))).toEqual([
      "Nothing personal found. This photo carries no location, device or name.",
    ]);
  });

  test("the turn is read as a number", async () => {
    expect((await summaryOf("rotated.jpg")).orientation).toBe(6);
  });

  test("a photo whose details can't be read says so", async () => {
    await expect(readMeta(fixture("damaged.jpg"), "jpeg")).rejects.toThrow();
    // A HEIC cut short: its items point past the end of the file.
    const cut = fixture("iphone.heic").subarray(0, 2400);
    await expect(readMeta(cut, "heic")).rejects.toThrow();
  });

  test("names are listed once, however many fields carry them", async () => {
    expect((await summaryOf("gps.jpg")).names).toEqual(["Test Person"]);
  });

  test("a model that already starts with the maker isn't doubled", () => {
    expect(
      sentences(summarize({ Make: "Canon", Model: "Canon EOS R6" })),
    ).toEqual(["It names the camera that took it: Canon EOS R6."]);
    expect(
      sentences(summarize({ Make: "CANON", Model: "Canon EOS R6" })),
    ).toEqual(["It names the camera that took it: Canon EOS R6."]);
    expect(sentences(summarize({ Make: "Apple", Model: "iPhone 15" }))).toEqual(
      ["It names the camera that took it: Apple iPhone 15."],
    );
  });

  test("a version number alone isn't named as software", () => {
    for (const version of ["18.1", "17.0.3", "v2", "26"]) {
      expect(sentences(summarize({ Software: version }))).toEqual([
        "Nothing personal found. This photo carries no location, device or name.",
      ]);
    }
    expect(sentences(summarize({ Software: "Adobe Lightroom 7.1" }))).toEqual([
      "It names the software that last saved it: Adobe Lightroom 7.1.",
    ]);
  });

  test("a version-only Software still shows under Show everything", () => {
    expect(details(summarize({ Software: "18.1" }))).toEqual([
      { block: "exif", rows: [["Software", "18.1"]] },
    ]);
  });

  test("southern and western coordinates", () => {
    const s = summarize({
      GPSLatitude: [33, 51, 54],
      GPSLatitudeRef: "S",
      GPSLongitude: [151, 12, 36],
      GPSLongitudeRef: "W",
    });
    expect(s.gps).toEqual({ lat: -33.865, lon: -151.21 });
    expect(sentences(s)[0]).toContain("(33.8650°\u00a0S, 151.2100°\u00a0W)");
  });
});

describe("details", () => {
  test("every field as text, without exifr's own extra readings", async () => {
    const rows = details(await summaryOf("gps.jpg")).flatMap((d) => d.rows);
    const keys = rows.map(([k]) => k);
    expect(keys).not.toContain("Latitude");
    expect(keys).not.toContain("Longitude");
    expect(Object.fromEntries(rows)).toMatchObject({
      Make: "Example",
      GPSLatitude: "51, 28, 36.84",
      DateTimeOriginal: "2026:10:01 12:00:00",
      ExifVersion: "0210",
    });
  });

  test("grouped by where each value came from, in a fixed order", async () => {
    const blocks = details(await summaryOf("gps.jpg")).map((d) => d.block);
    expect(blocks).toEqual(["exif", "gps", "xmp", "iptc", "text"]);
  });

  test("common codes in words, names with a capital", async () => {
    const all = details(await summaryOf("gps.jpg"));
    const rows = Object.fromEntries(all.flatMap((d) => d.rows));
    expect(rows).toMatchObject({
      Orientation: "upright",
      ResolutionUnit: "inches",
      ColorSpace: "uncalibrated",
      ComponentsConfiguration: "Y, Cb, Cr",
      YCbCrPositioning: "centred",
      Creator: "Test Person",
    });
    const flash = (v: number) =>
      details(summarize({ Flash: v })).flatMap((d) => d.rows);
    expect(flash(16)).toEqual([["Flash", "didn’t fire"]]);
    expect(flash(25)).toEqual([["Flash", "fired"]]);
  });

  test("a value made of parts shows every part", () => {
    const rows = details(
      summarize({}, [
        [
          "xmp",
          {
            CreatorContactInfo: {
              CiEmailWork: "someone@example.com",
              CiAdrCity: "London",
            },
            rights: { lang: "x-default", value: "Rights Person" },
          },
        ],
      ]),
    );
    expect(rows).toEqual([
      {
        block: "xmp",
        rows: [
          ["CreatorContactInfo.CiEmailWork", "someone@example.com"],
          ["CreatorContactInfo.CiAdrCity", "London"],
          ["Rights", "Rights Person"],
        ],
      },
    ]);
  });
});
