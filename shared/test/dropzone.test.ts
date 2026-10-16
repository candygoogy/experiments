// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { initDropZone } from "../dropzone";

const file = (name: string) => new File(["x"], name, { type: "text/plain" });

/** A drop of these files on the page, as the browser sends it. */
function drop(files: File[]) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { types: ["Files"], files },
  });
  document.dispatchEvent(event);
}

function zone(multiple?: boolean) {
  document.body.innerHTML = '<label class="drop"><input type="file" /></label>';
  const label = document.querySelector("label") as HTMLLabelElement;
  const input = label.querySelector("input") as HTMLInputElement;
  const calls: [string[], string[]][] = [];
  initDropZone(
    label,
    input,
    (files, skipped) =>
      calls.push([files.map((f) => f.name), skipped.map((f) => f.name)]),
    multiple === undefined ? {} : { multiple },
  );
  return calls;
}

describe("initDropZone", () => {
  test("one file: read, nothing skipped", () => {
    const calls = zone();
    drop([file("a.html")]);
    expect(calls).toEqual([[["a.html"], []]]);
  });

  test("several on a one-file zone: the first is read, the rest skipped", () => {
    const calls = zone();
    drop([file("a.html"), file("b.html"), file("c.html")]);
    expect(calls).toEqual([[["a.html"], ["b.html", "c.html"]]]);
  });

  test("several on a multiple zone: all read, none skipped", () => {
    const calls = zone(true);
    drop([file("a.jpg"), file("b.jpg")]);
    expect(calls).toEqual([[["a.jpg", "b.jpg"], []]]);
  });
});
