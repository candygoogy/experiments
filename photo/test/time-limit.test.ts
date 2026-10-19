import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as m from "exifr";
import { expect, test } from "vitest";
import { readJobs, type Answer } from "../src/exif";
import { exifWorker, readPhoto, type ExifWorker } from "../src/read";

// exifr in Node: CommonJS, everything on its default.
const exifr = {
  parse: m.parse ?? m.default.parse,
  sidecar: m.sidecar ?? m.default.sidecar,
};

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));

/** A stand-in for exifr's worker: one that answers, or one that never does. */
function worker(answers: boolean) {
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
  return it;
}

test("a photo exifr takes too long over is unreadable, and the next reads", async () => {
  const stuck = worker(false);
  const fresh = worker(true);
  const started = [stuck, fresh];
  const run = exifWorker(() => started.shift() ?? worker(true), 50);
  const bytes = fixture("gps.jpg");
  const direct = await readPhoto(bytes, "jpeg");

  // Its Exif and XMP go unread: only its plain comment is left.
  const late = await readPhoto(bytes, "jpeg", run);
  expect(late?.groups.map(([block]) => block)).toEqual(["text"]);
  expect(stuck.stopped).toBe(true);

  // The next photo gets a new worker, kept for the one after.
  expect(await readPhoto(bytes, "jpeg", run)).toEqual(direct);
  expect(await readPhoto(bytes, "jpeg", run)).toEqual(direct);
  expect(started).toEqual([]);
  expect(fresh.stopped).toBe(false);

  // A photo with nothing but blocks exifr never answers for can't be read.
  const hung = exifWorker(() => worker(false), 50);
  await expect(
    readPhoto(fixture("rotated.jpg"), "jpeg", hung),
  ).rejects.toThrow();
});
