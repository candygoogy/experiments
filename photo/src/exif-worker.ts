// Reads a photo's metadata blocks with exifr off the page's thread (read.ts
// starts it, and stops it when a photo takes too long). Gets one photo's
// blocks at a time and answers with what exifr made of each.
import { parse, sidecar } from "exifr";
import { READY, readJobs, type Answer, type Job } from "./exif.ts";

/** exifr's errors as text, so the answer can go back to the page. */
function plain(answer: Answer): Answer {
  const errors = answer?.["errors"];
  if (answer && Array.isArray(errors)) answer["errors"] = errors.map(String);
  return answer;
}

addEventListener("message", (event: MessageEvent<Job[]>) => {
  const jobs = event.data;
  void readJobs({ parse, sidecar }, jobs)
    .then((answers) => postMessage(answers.map(plain)))
    // An answer that can't be sent: none of the blocks could be read.
    .catch(() => postMessage(jobs.map(() => null)));
});

// Here, and exifr with it: the page's clock for the blocks starts now.
postMessage(READY);
