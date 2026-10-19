import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as m from "exifr";
import { expect, test } from "vitest";
import { READY, readJobs, type Answer } from "../src/exif";
import { exifWorker, readPhoto, type ExifWorker } from "../src/read";

// exifr in Node: CommonJS, everything on its default.
const exifr = {
  parse: m.parse ?? m.default.parse,
  sidecar: m.sidecar ?? m.default.sidecar,
};

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));

/** A stand-in for exifr's worker: one that answers, one that starts but
 * never answers, or one that never starts. */
function worker(answers: boolean, starts = true) {
  const it: ExifWorker & { stopped: boolean } = {
    onmessage: null,
    onmessageerror: null,
    onerror: null,
    stopped: false,
    postMessage(jobs) {
      if (!answers) return;
      void readJobs(exifr, jobs).then((data) =>
        it.onmessage?.({ data } as MessageEvent<Answer[]>),
      );
    },
    terminate() {
      it.stopped = true;
    },
  };
  if (starts) {
    setTimeout(() =>
      it.onmessage?.({ data: READY } as MessageEvent<typeof READY>),
    );
  }
  return it;
}

test("a photo exifr takes too long over is unreadable, and the next reads", async () => {
  // The first worker gets stuck; any after it answer.
  const started: ReturnType<typeof worker>[] = [];
  const run = exifWorker(() => {
    const it = worker(started.length > 0);
    started.push(it);
    return it;
  }, 50);
  const bytes = fixture("gps.jpg");
  const direct = await readPhoto(bytes, "jpeg");

  // Its Exif and XMP go unread: only its plain comment is left.
  const late = await readPhoto(bytes, "jpeg", run);
  expect(late?.groups.map(([block]) => block)).toEqual(["text"]);
  expect(started[0]?.stopped).toBe(true);

  // The next photo gets a new worker, kept for the one after.
  expect(await readPhoto(bytes, "jpeg", run)).toEqual(direct);
  expect(await readPhoto(bytes, "jpeg", run)).toEqual(direct);
  expect(started.length).toBe(2);
  expect(started[1]?.stopped).toBe(false);

  // A photo with nothing but blocks exifr never answers for can't be read.
  const hung = exifWorker(() => worker(false), 50);
  await expect(
    readPhoto(fixture("rotated.jpg"), "jpeg", hung),
  ).rejects.toThrow();
});

test("the clock starts once the worker is ready, and waits for it only so long", async () => {
  // Slow to start, then quick: the start isn't counted against the photo.
  const slow = worker(true, false);
  const run = exifWorker(() => slow, 50, 1000);
  const bytes = fixture("gps.jpg");
  const answer = readPhoto(bytes, "jpeg", run);
  setTimeout(
    () => slow.onmessage?.({ data: READY } as MessageEvent<typeof READY>),
    100,
  );
  expect(await answer).toEqual(await readPhoto(bytes, "jpeg"));

  // Never ready: stopped, and the photo's Exif and XMP go unread.
  const never = worker(true, false);
  const late = await readPhoto(
    bytes,
    "jpeg",
    exifWorker(() => never, 50, 50),
  );
  expect(late?.groups.map(([block]) => block)).toEqual(["text"]);
  expect(never.stopped).toBe(true);
});
