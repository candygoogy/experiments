// What happens once photos arrive: each is read, summed up and cleaned,
// in its own row. Loaded only when a file is on its way (main.ts), so the
// page itself carries none of this.
import { arrive } from "@exp/shared/arrive";
import { copy, fill, plural, together } from "./copy";
import { detect, type PhotoType } from "./detect";
import { CantClean } from "./heif";
import { readPhoto } from "./read";
import { make as makeIn, noPreview, photoRow } from "./render";
import { clean } from "./strip/index";
import { details, sentences, summarize, type Detail } from "./summary";
import { turnOf } from "./turn";
import { breathe, zip } from "./zip";

const zone = document.querySelector<HTMLLabelElement>(".drop");
const status = document.querySelector<HTMLElement>("[data-status]");
const answer = document.querySelector<HTMLElement>("[data-answer]");
// The answer's column, labelled with the photo's name, or the count.
const yours = document.querySelector<HTMLElement>("[data-yours]");
const yoursLabel = document.querySelector<HTMLElement>("#yours-label");

const EXTENSION: Record<PhotoType, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  heic: "heic",
};
const MIME: Record<PhotoType, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

interface CleanCopy {
  name: string;
  blob: Blob;
}

// The biggest file read. A phone's photo is a few MB (a 48-megapixel HEIC
// or JPEG, 5 to 15), the JPEGs of the biggest cameras (100 megapixels and
// more) a few tens, and a WebP can't pass 16383 pixels a side. Past this
// it's no camera's photo, and the page would hold it twice over (the file
// and its clean copy) while it reads it.
const MAX_MB = 100;
const MAX_BYTES = MAX_MB * 1024 * 1024;

// Object URLs made for the current list, let go when the next one starts.
let urls: string[] = [];
// Each drop starts a new list; an older one still being read stops adding.
let run = 0;

const make = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
) => makeIn(document, tag, className, text);

/** "IMG_0042.jpeg" → "IMG_0042-clean.jpeg"; the extension follows what
 * the file really is, so a PNG named .jpg comes back as .png. */
function cleanName(name: string, type: PhotoType) {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  const same = detectExt(ext) === type;
  return `${base}-clean.${same ? ext : EXTENSION[type]}`;
}

const detectExt = (ext: string): PhotoType | null =>
  /^jpe?g$/i.test(ext)
    ? "jpeg"
    : /^png$/i.test(ext)
      ? "png"
      : /^webp$/i.test(ext)
        ? "webp"
        : /^hei[cf]$/i.test(ext)
          ? "heic"
          : null;

interface Shown {
  /** The picture, or the reason there's none; null for a non-photo. */
  node: HTMLElement | null;
  /** Work that can wait until the row is on the page. */
  later?: (() => Promise<void>) | undefined;
}

/** The photo's preview, ready before its row is shown, so the row arrives
 * at its full size and nothing moves after. The browser draws it when it
 * can (Safari draws HEIC too); for a HEIC it can't, the browser's video
 * decoder may still draw it (heic-preview.ts, loaded only then). */
async function preview(
  file: File,
  type: PhotoType | null,
  bytes: Uint8Array | null,
): Promise<Shown> {
  if (type === null) return { node: null };
  const url = URL.createObjectURL(file);
  urls.push(url);
  const img = make("img", "thumb");
  img.alt = "";
  img.decoding = "async";
  img.src = url;
  try {
    await img.decode();
    return { node: img };
  } catch {
    // Not a picture this browser can draw.
  }
  if (type !== "heic" || !bytes) return { node: null };
  try {
    const { heicPreview } = await import("./heic-preview");
    const drawn = await heicPreview(bytes);
    if (drawn) {
      drawn.canvas.className = "thumb";
      return { node: drawn.canvas, later: drawn.sharpen };
    }
  } catch {
    // The decoder gave up: said below, as when there's none.
  }
  return { node: noPreview(document) };
}

interface Answered {
  row: HTMLLIElement;
  copy: CleanCopy | null;
  lead: string;
  later?: (() => Promise<void>) | undefined;
  /** Whether it's a photo, whether it carries its place, and whether it
   * gives anything else away. */
  photo: boolean;
  place: boolean;
  other: boolean;
}

/** Reads one photo into its row. A photo that can't be read or cleaned
 * says so in its own row and never stops the others. */
async function answerFor(file: File, many: boolean): Promise<Answered> {
  const lead = many ? "h4" : "h3";
  // Too big to read: said in its row, and nothing of it is read.
  if (file.size > MAX_BYTES) {
    const line = fill(copy.tooBig, { n: MAX_MB });
    return {
      row: photoRow(document, {
        name: file.name,
        size: file.size,
        picture: null,
        lines: [line],
        lead,
        details: [],
      }),
      copy: null,
      lead: line,
      photo: false,
      place: false,
      other: false,
    };
  }
  let bytes: Uint8Array | null = null;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    // Unreadable from disk: treated like an unknown file below.
  }
  const type = bytes ? detect(bytes) : null;
  const shown = await preview(file, type, bytes);

  let lines: string[];
  let all: Detail[] = [];
  let cleaned: CleanCopy | null = null;
  let place = false;
  let other = false;
  if (!bytes || !type) {
    lines = [copy.unknownType];
  } else {
    try {
      const read = await readPhoto(bytes, type);
      const summary = summarize(read?.meta, read?.groups);
      lines = sentences(summary);
      all = details(summary);
      place = !!summary.gps;
      other = lines.length > (place ? 1 : 0) && lines[0] !== copy.nothing;
    } catch (error) {
      // Details stored where this page can't reach them: nothing can be
      // said about them, and clean() below refuses too.
      lines = [error instanceof CantClean ? copy.cantClean : copy.unreadable];
    }
    try {
      // The turn a browser shows the photo with, and only that one: the
      // clean copy is shown the same way up.
      const out = clean(bytes, type, turnOf(bytes, type));
      cleaned = {
        name: cleanName(file.name, type),
        blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: MIME[type] }),
      };
    } catch (error) {
      // No clean copy, and the row says why.
      if (lines[0] !== copy.cantClean) {
        lines.push(
          error instanceof CantClean ? copy.noCleanCopy : copy.damaged,
        );
      }
    }
  }
  const row = photoRow(document, {
    name: file.name,
    size: file.size,
    picture: shown.node,
    lines,
    lead,
    details: all,
  });
  return {
    row,
    copy: cleaned,
    lead: lines[0] ?? "",
    later: shown.later,
    photo: !!type,
    place,
    other,
  };
}

function save(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = make("a", "");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Enough of a file's start to tell what it is (detect.ts).
const HEAD = 4096;

/** How many of the files are photos this page reads, from their first
 * bytes: what the answer's label counts. */
async function photoCount(files: File[]): Promise<number> {
  const types = await Promise.all(
    files.map((file) =>
      file
        .slice(0, HEAD)
        .arrayBuffer()
        .then(
          (b) => detect(new Uint8Array(b)),
          () => null,
        ),
    ),
  );
  return types.filter((type) => type !== null).length;
}

function button(label: string, onClick: () => void | Promise<void>) {
  const pill = make("button", "download", label);
  pill.type = "button";
  pill.addEventListener("click", () => void onClick());
  return pill;
}

/** What several photos give away together, in a sentence or three. */
function batchLines(answers: Answered[], copies: number): string[] {
  const photos = answers.filter((a) => a.photo);
  const total = photos.length;
  const lines: string[] = [];
  if (total === 1) lines.push(photos[0]?.lead ?? "");
  else if (total > 1) {
    const place = photos.filter((a) => a.place).length;
    const other = photos.filter((a) => a.other).length;
    lines.push(...together({ total, place, other }));
  } else lines.push(copy.batchNoPhotos);
  const missing = answers.length - copies;
  if (total && missing) lines.push(plural(copy.batchNoCopy, { n: missing }));
  return lines;
}

export async function readAll(files: File[]) {
  if (!answer) return;
  const mine = ++run;
  // Several files: the label and the lines count the photos among them.
  const many = files.length > 1;
  const photos = many ? await photoCount(files) : 1;
  if (mine !== run) return; // a newer drop took over
  for (const url of urls) URL.revokeObjectURL(url);
  urls = [];
  const list = make("ol", "photos");
  zone?.classList.add("has-result");

  // Several photos: what they give away together, and the one action,
  // come first; their space is held while they're read.
  const batch = make("div", "batch");
  const get = make("div", "get get-all");
  const note = make("p", "kept", copy.keptMany);
  if (many) {
    batch.append(make("h3", "lead", plural(copy.reading, { n: photos })));
    get.append(
      button(
        photos === 1 ? copy.cleanOne : fill(copy.cleanMany, { n: photos }),
        () => {},
      ),
    );
    get.dataset["waiting"] = "";
    note.dataset["waiting"] = "";
    answer.replaceChildren(batch, get, note, list);
  } else answer.replaceChildren(list);
  if (yoursLabel) {
    yoursLabel.textContent = many
      ? plural(copy.photos, { n: photos })
      : (files[0]?.name ?? "");
  }
  if (yours) yours.hidden = false;

  const answers: Answered[] = [];
  const copies: CleanCopy[] = [];
  const later: (() => Promise<void>)[] = [];
  for (const file of files) {
    const answered = await answerFor(file, many);
    if (mine !== run) return; // a newer drop took over
    list.append(answered.row);
    arrive(answered.row);
    answers.push(answered);
    if (answered.later) later.push(answered.later);
    if (answered.copy) copies.push(answered.copy);
    await breathe();
  }

  const [first] = copies;
  if (!many) {
    const lead = answers[0]?.lead ?? "";
    if (status) status.textContent = lead;
    if (first) {
      const one = make("div", "get");
      one.append(
        button(copy.cleanOne, () => save(first.name, first.blob)),
        make("p", "kept", copy.kept),
      );
      list.querySelector(".what")?.append(one);
    }
  } else {
    const lines = batchLines(answers, copies.length);
    batch.replaceChildren(
      ...lines.map((line, i) =>
        make(i ? "p" : "h3", i ? "line" : "lead", line),
      ),
    );
    if (copies.length) {
      // One clean copy among several files is saved as it is.
      const label =
        copies.length === 1
          ? copy.cleanOne
          : fill(copy.cleanMany, { n: copies.length });
      get.replaceChildren(
        button(label, async () =>
          copies.length === 1 && first
            ? save(first.name, first.blob)
            : save("photos-clean.zip", await zip(copies)),
        ),
      );
      delete get.dataset["waiting"];
      delete note.dataset["waiting"];
    } else {
      get.remove();
      note.remove();
    }
    if (status) {
      status.textContent = [
        ...lines,
        ...answers.map((a, i) => `${files[i]?.name ?? ""}: ${a.lead}`),
      ].join(" ");
    }
  }

  // Sharper HEIC previews, one at a time, once every answer is in.
  for (const sharpen of later) {
    if (mine !== run) return;
    await sharpen().catch(() => undefined);
  }
}
