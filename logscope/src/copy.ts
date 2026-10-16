// Every word the page says, in one place. The plain sentences about known
// Windows events are in known.ts.
export const copy = {
  title: "logscope",
  intro:
    "Drop a log from Windows or a server, and see what happened, grouped and explained in plain words.",
  example: "Example log",
  // Over the drop zone; the answer's label is the file's name.
  fileLabel: "Your log",
  // Several files dropped at once: the answer opens with this.
  oneAtATime: "One file at a time: showing {name}.",
  drop: "Drop a log here, or choose the file",
  howTo:
    "From Event Viewer: select a log, then Save All Events As… and pick CSV or XML. Server logs (syslog, nginx, Apache) work as they are.",
  reading: "Reading the log… {pct}%",

  // Windows verdicts.
  restarted: "This PC restarted without shutting down {times}.",
  restartedBlue:
    "This PC restarted without shutting down {times}, {blue} after a blue screen.",
  blueScreens: "Windows stopped with a blue screen {times}.",
  hardware: "The hardware hit an error it couldn’t fix {times}.",
  drive:
    "A drive reported problems {times}. It may be failing: back up your files.",
  mainProblem: "The most frequent problem is {name}, {times}.",
  onlyWarnings: "Only warnings here. The most frequent is {name}, {times}.",
  nothing: "Nothing here needs a look.",
  manyKinds:
    "{n} errors and warnings here, of too many kinds to name the most frequent.",
  // A count that may be short: some of these were counted with other
  // messages ("at least 50 times").
  atLeast: "at least {times}",
  nothingButNoise:
    "Nothing here needs a look. The only errors are common noise.",
  lastRestart: "The most recent was on {date} at {time}.",
  levelsUnknown:
    "This log’s level names aren’t in a language this page knows, so it can’t tell errors from information.",

  // Server and web verdicts.
  mostFrequent: "The most frequent {level} is “{message}”, {times}.",
  serverQuiet: "Nothing here needs a look: no errors or warnings.",
  burst:
    "Your server failed {n} requests in one burst on {date}, between {from} and {to}.",
  failed: "Your server failed {n} requests, {share} of all.",
  missing:
    "Nothing failed on the server’s side. The most requested missing page is {path}, {times}.",
  manyMissing:
    "Nothing failed on the server’s side. Many different pages were missing, too many to name the most requested.",
  allAnswered: "Nothing failed: every request was answered.",

  // The line under the verdict.
  aboutWindows: "{n} events in the {log} log, {range}, exported as {as}.",
  aboutWindowsNoName: "{n} events, {range}, exported as {as}.",
  aboutServer: "{n} lines in {what}, {range}.",
  aboutWeb:
    "{n} requests in a web server access log, {range}. {share} of them failed on the server’s side (5xx).",
  timesIn: "Times are in {zone}, as the log writes them.",
  utc: "UTC",
  skipped: "{n} lines couldn’t be read and were left out.",
  skippedOne: "One line couldn’t be read and was left out.",
  syslogName: "a syslog file",
  nginxErrorName: "an nginx error log",

  // The timeline.
  perHour: "{n} an hour",
  perDay: "{n} a day",
  timelineHours: "Events per hour.",
  timelineDays: "Events per day.",
  requestsHours: "Requests per hour.",
  requestsDays: "Requests per day.",
  restartsLine: "The dashed lines are restarts.",

  // Filters and rows.
  levels: "Levels",
  source: "Source",
  path: "Path",
  allSources: "All sources ({n})",
  allPaths: "All paths ({n})",
  search: "Search",
  searchPlaceholder: "Search messages",
  shown: "{n} groups of {total}",
  shownOne: "1 group of {total}",
  noMatch: "Nothing matches. Try another level, source or word.",
  first: "First {when}",
  last: "Last {when}",
  noise: "Usually safe to ignore",
  showMore: "Show {n} more",
  other: "Other messages, too many kinds to list one by one",
  noRequest: "(no request line)",
  // The chips that stand for the parts of a message that change.
  slots: {
    n: "number",
    hex: "hex",
    guid: "ID",
    sid: "SID",
    path: "path",
    url: "URL",
    ip: "IP",
    date: "date",
    time: "time",
    name: "name",
  },
  slotTitle: "This part changes from one event to the next.",
  topClients: "Top clients",
  requests: "{n} requests",
  clientsKept: "Addresses are shown only here, on your screen.",
  kept: "The log stays on this device. Computer and user names in it are shown only here, on your screen.",

  levelNames: {
    critical: "Critical",
    error: "Error",
    warning: "Warning",
    information: "Information",
  },
  webLevelNames: {
    critical: "5xx",
    error: "5xx",
    warning: "4xx",
    information: "2xx and 3xx",
  },
  levelInSentence: {
    critical: "critical message",
    error: "error",
    warning: "warning",
    information: "message",
  },

  // Problems.
  evtx: "This is an .evtx file, which this page can’t read yet.",
  evtxHow:
    "Open it in Event Viewer, then use Save All Events As… and pick CSV or XML. Or, in a terminal: wevtutil qe System /f:RenderedXml /e:Events > system.xml",
  notALog:
    "This doesn’t look like a log this page reads: Event Viewer’s CSV, text or XML, syslog, or a web server’s access or error log.",
  unreadable: "This file couldn’t be read.",
  empty: "This log has no events.",

  // Web: what a status says, and paths bots look for.
  web: {
    "500": "The app behind the server failed on these requests.",
    "502": "The server couldn’t reach the app behind it.",
    "503": "The server, or the app behind it, was overloaded or down.",
    "504": "The app behind the server took too long to answer.",
    "401": "Requests turned away for missing or wrong credentials.",
    "403": "Requests turned away as not allowed.",
    "404": "A page or file that isn’t there.",
    "429": "Requests turned away for coming too fast.",
    wordpress:
      "Bots looking for a WordPress login. Harmless if the site doesn’t run WordPress.",
    secrets:
      "Bots looking for a leaked settings file or code. Make sure it isn’t served.",
    admin:
      "Bots looking for a database admin page. Harmless if there isn’t one.",
    burst: "{n} of these came in one burst, {date} from {from} to {to}.",
  },
} as const;

/** Puts values into a sentence: fill("{n} events", { n: 3 }). */
export const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (all, key: string) =>
    key in values ? String(values[key]) : all,
  );
