// Reads a dropped log off the page's thread: the file is streamed and
// decoded a piece at a time, so a log of hundreds of megabytes never sits
// in memory whole and the page keeps answering. The text encoding and the
// format are decided from the start of the file; progress goes back to
// the page as the bytes go by. An .evtx file is read a chunk at a time
// instead (evtx.ts).
import { analyzer, type Analyzer } from "./analyze.ts";
import { detect, encoding, isEvtx } from "./detect.ts";
import { EVTX_CHUNK, evtxChunk, evtxStart, isChunk } from "./evtx.ts";
import { lines } from "./lines.ts";
import type { Result } from "./model.ts";

export type FromWorker =
  | { type: "progress"; read: number; total: number }
  | { type: "done"; result: Result }
  | { type: "problem"; reason: "not-a-log" | "unreadable" };

// How much of the file decides the encoding and the format.
const HEAD = 64 * 1024;
// How often progress goes back, at most.
const PROGRESS_MS = 100;

const post = (message: FromWorker) => postMessage(message);

/** An .evtx file, a chunk at a time. Chunks are in the order Windows
 * reused them, not in time order, which the counts don't mind. */
async function readEvtx(file: File, head: Uint8Array) {
  const run = analyzer("evtx");
  let chunks = 0;
  let told = 0;
  for (let at = evtxStart(head); at < file.size; at += EVTX_CHUNK) {
    const bytes = new Uint8Array(
      await file.slice(at, at + EVTX_CHUNK).arrayBuffer(),
    );
    if (isChunk(bytes)) chunks++;
    evtxChunk(bytes, (xml) => run.line(xml), run.skip);
    const now = performance.now();
    if (now - told > PROGRESS_MS) {
      told = now;
      post({ type: "progress", read: at + bytes.length, total: file.size });
    }
  }
  // Not one chunk of events: a header and nothing else, or not an .evtx.
  if (!chunks) {
    post({ type: "problem", reason: "unreadable" });
    return;
  }
  post({ type: "progress", read: file.size, total: file.size });
  post({ type: "done", result: run.end() });
}

async function read(file: File) {
  const start = new Uint8Array(await file.slice(0, HEAD).arrayBuffer());
  if (isEvtx(start)) {
    await readEvtx(file, start);
    return;
  }

  let bytes = 0;
  let told = 0;
  const count = new TransformStream<Uint8Array, AllowSharedBufferSource>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      const now = performance.now();
      if (now - told > PROGRESS_MS) {
        told = now;
        post({ type: "progress", read: bytes, total: file.size });
      }
      controller.enqueue(chunk);
    },
  });
  const text = file
    .stream()
    .pipeThrough(count)
    .pipeThrough(new TextDecoderStream(encoding(start)));

  // Set once the first lines have said what format this is.
  const state: { run: Analyzer | null } = { run: null };
  // The lines read before then, or pieces of a long one (true: it goes
  // on in the next).
  let held: [string, boolean][] = [];
  let heldSize = 0;

  const decide = () => {
    const format = detect(
      held.map(([line, more]) => (more ? line : `${line}\n`)).join(""),
    );
    if (!format) return false;
    const run = analyzer(format);
    for (const [line, more] of held) run.line(line, more);
    state.run = run;
    held = [];
    return true;
  };

  // A file with no line breaks comes in pieces (lines.ts), so the format
  // is still decided after its first HEAD of text.
  const split = lines((line, more) => {
    if (state.run) {
      state.run.line(line, more);
      return true;
    }
    held.push([line, more]);
    heldSize += line.length;
    return heldSize < HEAD || decide();
  });

  for await (const chunk of text) {
    if (!split.push(chunk)) {
      post({ type: "problem", reason: "not-a-log" });
      return;
    }
  }
  split.end();
  if (!state.run && !decide()) {
    post({ type: "problem", reason: "not-a-log" });
    return;
  }
  post({ type: "progress", read: file.size, total: file.size });
  const result = state.run?.end();
  if (result) post({ type: "done", result });
}

addEventListener("message", (event: MessageEvent<File>) => {
  read(event.data).catch(() => post({ type: "problem", reason: "unreadable" }));
});
