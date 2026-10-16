// The drop zone's behaviour (styles in dropzone.css): files come in from
// the hidden input or from a drop anywhere on the page. A file dropped
// outside the zone is still read, and never opened by the browser in place
// of the page. While files are dragged over the page the zone shows it.
//
// A one-file zone given several reads the first and passes the rest on as
// `skipped`, so the page can say which one it's showing ("One file at a
// time: showing battery-report.html.").

export interface DropZoneOptions {
  /** Pass on every file, or only the first. */
  multiple?: boolean;
}

export function initDropZone(
  zone: HTMLLabelElement,
  input: HTMLInputElement,
  onFiles: (files: File[], skipped: File[]) => void,
  options: DropZoneOptions = {},
): void {
  const take = (list: FileList | null | undefined) => {
    const files = [...(list ?? [])];
    const chosen = options.multiple ? files : files.slice(0, 1);
    if (chosen.length) onFiles(chosen, files.slice(chosen.length));
  };

  input.addEventListener("change", () => {
    take(input.files);
    // The same file can be picked again after it changes on disk.
    input.value = "";
  });

  // dragenter and dragleave fire for every element crossed, so the zone
  // counts them to know when the files have left the page.
  let depth = 0;
  const over = (on: boolean) => zone.classList.toggle("is-over", on);
  const carriesFiles = (event: DragEvent) =>
    event.dataTransfer?.types.includes("Files") ?? false;

  document.addEventListener("dragenter", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth++;
    over(true);
  });
  document.addEventListener("dragover", (event) => {
    if (!carriesFiles(event) || !event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  document.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (!depth) over(false);
  });
  document.addEventListener("drop", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth = 0;
    over(false);
    take(event.dataTransfer?.files);
  });
}
