// Every word the page says, in one place.
export const copy = {
  title: "Battery check",
  intro:
    "Drop in the report Windows makes about your battery, and get a plain answer on its health.",
  example: "Example report",
  // Over the drop zone. The answer's label is the PC's maker and model
  // when the report names them; otherwise this, for screen readers only.
  fileLabel: "Your report",
  drop: "Drop the report here, or choose the file",
  // The drop zone once a report is read, one line over the answer. The
  // words after ", or " are the link-coloured part.
  dropAnother: "Drop another report, or choose one",
  howTo:
    "Open Command Prompt, run powercfg /batteryreport, then drop the battery-report.html file it saves here.",
  healthy: "Healthy. It still holds {pct}% of its original charge.",
  // Young batteries often hold a little more than they were built for.
  healthyAbove:
    "Healthy. It holds {pct}% of its original charge. Over 100% is normal for a young battery.",
  worn: "Worn. It holds {pct}% of its original charge, so expect less runtime than when it was new.",
  wornOut:
    "Worn out. It holds only {pct}% of its original charge. Plan a replacement.",
  unknown:
    "Windows didn’t record this battery’s original capacity, so there’s nothing to compare it with.",
  cycles: "It has been through {n} charge cycles.",
  notAReport:
    "This doesn’t look like a battery report. Drop the battery-report.html file that powercfg saves.",
  xml: "This is the XML version of the report. Run powercfg /batteryreport without /xml and drop the HTML file.",
  noBattery:
    "This report lists no battery. It was probably made on a desktop PC.",
  noHistory: "Windows kept no capacity history for this battery.",
  battery: "Battery {n}",
  original: "Original capacity",
  // Where Windows wrote an original capacity of 0.
  notRecorded: "Not recorded",
  now: "Capacity now",
  cycleCount: "Charge cycles",
  chart:
    "Full charge capacity, week by week. Windows re-estimates it over time, so the line can dip and recover. The dashed line is the original capacity.",
  // Beside the chart's guide at 80% of the original capacity, where the
  // verdict turns from healthy to worn.
  wornLine: "Worn below 80%",
  // With more than one battery, the report's history and estimates are
  // for all of them together.
  chartSeveral:
    "Full charge capacity of {which} together, week by week. Windows re-estimates it over time, so the line can dip and recover. The dashed line is their original capacity.",
  estimate:
    "At full charge Windows estimated {full} of use; when new, {design}.",
  estimateSeveral:
    "With {which} at full charge Windows estimated {full} of use; when new, {design}.",
  both: "both batteries",
  allOf: "all {n} batteries",
  kept: "The report also holds your PC’s name and the battery’s serial number. This page never shows or keeps them.",
  // Several files dropped at once: only the first is read.
  oneAtATime: "One file at a time: showing {name}.",
} as const;

/** Puts values into a sentence: fill("{n} cycles", { n: 3 }). */
export const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (all, key: string) =>
    key in values ? String(values[key]) : all,
  );
