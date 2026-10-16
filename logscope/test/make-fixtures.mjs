// Makes the synthetic logs in test/fixtures/ and the page's example,
// src/example.csv. Every machine, person, address and message is made up
// (addresses from the documentation ranges, 192.0.2.0/24, 198.51.100.0/24,
// 203.0.113.0/24). Run: node logscope/test/make-fixtures.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(import.meta.dirname, "fixtures");
const SRC = join(import.meta.dirname, "..", "src");
mkdirSync(OUT, { recursive: true });

// A fixed sequence of "random" numbers, so every run writes the same files.
let seed = 42;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return seed / 2 ** 31;
};
const pick = (list) => list[Math.floor(random() * list.length)];

const LRM = "\u200e";
const pad = (n) => String(n).padStart(2, "0");

// --- Windows events, as a list the writers below turn into each format.

/** Made-up Windows events from `start` (UTC ms) over `days`. */
function windowsEvents(start, days, shape) {
  const events = [];
  const at = (t, e) => events.push({ t, ...e });
  for (let d = 0; d < days; d++) {
    const day = start + d * 86_400_000;
    for (let i = 0; i < shape.perDay; i++) {
      const t = day + Math.floor(random() * 86_400_000);
      const kind = random();
      if (kind < shape.dcom) {
        at(t, DCOM());
      } else if (kind < shape.dcom + 0.05) {
        at(t, {
          level: "Warning",
          source: "DNS Client Events",
          id: 1014,
          task: "(1014)",
          message: `Name resolution for the name host${Math.floor(random() * 9)}.example.net timed out after none of the configured DNS servers responded.`,
        });
      } else {
        at(t, {
          level: "Information",
          source: "Service Control Manager",
          id: 7036,
          task: "None",
          message: `The ${pick(["Windows Update", "Print Spooler", "Background Intelligent Transfer Service"])} service entered the ${pick(["running", "stopped"])} state.`,
        });
      }
    }
  }
  for (const t of shape.crashes) {
    at(t, {
      level: "Critical",
      source: "Kernel-Power",
      id: 41,
      task: "(63)",
      message:
        "The system has rebooted without cleanly shutting down first. This error could be caused if the system stopped responding, crashed, or lost power unexpectedly.",
    });
    at(t + 20_000, {
      level: "Information",
      source: "Kernel-General",
      id: 12,
      task: "(1)",
      message: `The operating system started at system time ${LRM}${new Date(t).toISOString().slice(0, 10).split("-").join(`${LRM}-${LRM}`)}${LRM}T${new Date(t).toISOString().slice(11, 19)}.500000000Z.`,
    });
    at(t + 60_000, {
      level: "Error",
      source: "EventLog",
      id: 6008,
      task: "None",
      message: `The previous system shutdown at ${new Date(t - 300_000).toISOString().slice(11, 19)} on ${LRM}${new Date(t).toISOString().slice(0, 10)} was unexpected.`,
    });
  }
  for (const t of shape.blue ?? []) {
    at(t, {
      level: "Error",
      source: "BugCheck",
      id: 1001,
      task: "None",
      message:
        "The computer has rebooted from a bugcheck.  The bugcheck was: 0x0000009f (0x0000000000000003, 0xffffc40bd2a3e060, 0xfffff8050e267850, 0xffffc40bd7bc6010). A dump was saved in: C:\\WINDOWS\\MEMORY.DMP. Report Id: 7c1d3a41-2b5e-4f0a-9c3d-1e2f3a4b5c6d.",
    });
  }
  for (const t of shape.disk ?? []) {
    at(t, {
      level: "Warning",
      source: "disk",
      id: 153,
      task: "None",
      message: `The IO operation at logical block address 0x${Math.floor(random() * 0xffffff).toString(16)} for Disk 1 (PDO name: \\Device\\0000004a) was retried.`,
    });
  }
  for (const t of shape.service ?? []) {
    at(t, {
      level: "Error",
      source: "Service Control Manager",
      id: 7031,
      task: "None",
      message:
        "The Example Sync service terminated unexpectedly.  It has done this 1 time(s).  The following corrective action will be taken in 60000 milliseconds: Restart the service.\r\n\r\nDetails are in the service's own log.",
    });
  }
  return events.sort((a, b) => a.t - b.t);
}

function DCOM() {
  return {
    level: "Error",
    source: "DistributedCOM",
    id: 10016,
    task: "None",
    message: `The application-specific permission settings do not grant Local Activation permission for the COM Server application with CLSID \r\n{2593F8B9-4EAF-457C-B68A-50F6B8EA6B54}\r\n and APPID \r\n{15C20B67-12E7-4BB6-92BB-7AFF07997402}\r\n to the user EXAMPLE-PC\\user SID (S-1-5-21-1000000000-2000000000-3000000000-1001) from address LocalHost (Using LRPC) running in the application container Unavailable SID (Unavailable).`,
  };
}

const csvField = (s) =>
  /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;

/** "10/14/2026 10:51:02 PM" */
const usDate = (t) => {
  const d = new Date(t);
  const h = d.getUTCHours();
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()} ${h % 12 || 12}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${h < 12 ? "AM" : "PM"}`;
};
/** "14/10/2026 22:51:02" */
const euDate = (t) => {
  const d = new Date(t);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

/** Event Viewer's table: newest first, as it saves them. */
function table(events, { header, levels, date, delimiter }) {
  const field =
    delimiter === ","
      ? csvField
      : (s) => (/[\t\r\n"]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
  const lines = [header.join(delimiter)];
  for (const e of [...events].reverse()) {
    lines.push(
      [
        levels[e.level] ?? e.level,
        date(e.t),
        e.source,
        String(e.id),
        e.task,
        e.message,
      ]
        .map(field)
        .join(delimiter),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

const EN = {
  header: ["Level", "Date and Time", "Source", "Event ID", "Task Category"],
  levels: {},
  date: usDate,
  delimiter: ",",
};
const IT = {
  header: [
    "Livello",
    "Data e ora",
    "Origine",
    "ID evento",
    "Categoria attività",
  ],
  levels: {
    Information: "Informazioni",
    Warning: "Avviso",
    Error: "Errore",
    Critical: "Critico",
  },
  date: euDate,
  delimiter: ",",
};
// Polish: a header this page has no names for, so the columns are found
// by their shape; the level words it knows.
const PL = {
  header: [
    "Poziom",
    "Data i godzina",
    "Źródło",
    "Identyfikator zdarzenia",
    "Kategoria zadania",
  ],
  levels: {
    Information: "Informacje",
    Warning: "Ostrzeżenie",
    Error: "Błąd",
    Critical: "Krytyczny",
  },
  date: euDate,
  delimiter: ",",
};

const OCT = (day, h = 0, m = 0) => Date.UTC(2026, 9, day, h, m);
const files = {};

const week = windowsEvents(OCT(8), 7, {
  perDay: 60,
  dcom: 0.45,
  crashes: [OCT(9, 23, 4), OCT(12, 7, 30), OCT(14, 22, 51)],
  blue: [OCT(14, 22, 53)],
  disk: [OCT(11, 14, 2), OCT(12, 9, 0), OCT(13, 16, 20), OCT(14, 22, 49)],
  service: [OCT(10, 8, 12), OCT(13, 19, 40)],
});
files["en-system.csv"] = table(week, EN);
files["it-system.csv"] = table(week, IT);
files["pl-system.csv"] = table(week, PL);
// Event Viewer saves its text export as UTF-16 with a byte order mark.
files["en-system.txt"] = Buffer.concat([
  Buffer.from([0xff, 0xfe]),
  Buffer.from(table(week, { ...EN, delimiter: "\t" }), "utf16le"),
]);

// --- XML: Event Viewer's "Save as XML", and wevtutil's raw events.
const xmlEscape = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const LEVEL_N = { Critical: 1, Error: 2, Warning: 3, Information: 4 };
const PROVIDERS = {
  "Kernel-Power":
    'Name="Microsoft-Windows-Kernel-Power" Guid="{331c3b3a-2005-44c2-ac5e-77220c37d6b4}"',
  "Kernel-General":
    'Name="Microsoft-Windows-Kernel-General" Guid="{a68ca8b7-004f-d7b6-a698-07e2de0f1f5d}"',
  EventLog: 'Name="EventLog"',
  BugCheck:
    'Name="Microsoft-Windows-WER-SystemErrorReporting" Guid="{abce23e7-de45-4366-8631-84fa6c525952}" EventSourceName="BugCheck"',
  disk: 'Name="disk"',
  "Service Control Manager":
    'Name="Service Control Manager" Guid="{555908d1-a6d7-4695-8e1e-26931d2012f4}" EventSourceName="Service Control Manager"',
  DistributedCOM:
    'Name="Microsoft-Windows-DistributedCOM" Guid="{1b562e86-b7aa-4131-badc-b6f3a001407e}" EventSourceName="DCOM"',
  "DNS Client Events":
    'Name="Microsoft-Windows-DNS-Client" Guid="{1c95126e-7eea-49a9-a3fe-a378b03ddb4d}"',
};
function xmlEvent(e, rendered) {
  const time = new Date(e.t).toISOString().replace(".000Z", ".1234567Z");
  const system = `<System><Provider ${PROVIDERS[e.source] ?? `Name="${e.source}"`} /><EventID>${e.id}</EventID><Version>0</Version><Level>${LEVEL_N[e.level]}</Level><Task>0</Task><Opcode>0</Opcode><Keywords>0x8000000000000000</Keywords><TimeCreated SystemTime="${time}" /><EventRecordID>${Math.floor(random() * 1e6)}</EventRecordID><Correlation /><Execution ProcessID="4" ThreadID="8" /><Channel>System</Channel><Computer>EXAMPLE-PC</Computer><Security /></System>`;
  const data = `<EventData><Data Name="Detail">${xmlEscape(e.message)}</Data></EventData>`;
  const info = rendered
    ? `<RenderingInfo Culture="en-US"><Message>${xmlEscape(e.message)}</Message><Level>${e.level}</Level><Task>${e.task}</Task><Opcode>Info</Opcode><Channel>System</Channel><Provider>${e.source}</Provider><Keywords></Keywords></RenderingInfo>`
    : "";
  return `<Event xmlns="http://schemas.microsoft.com/win/2004/08/events/event">${system}${data}${info}</Event>`;
}
files["system.xml"] =
  `<?xml version="1.0" encoding="UTF-8"?>\r\n<Events>\r\n${week.map((e) => xmlEvent(e, true)).join("\r\n")}\r\n</Events>\r\n`;
files["wevtutil.xml"] =
  `${week.map((e) => xmlEvent(e, false)).join("\r\n")}\r\n`;

// --- syslog, three ways.
const HOSTS = ["web-1", "db-1"];
const MON = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
function serverLines(start, hours) {
  const lines = [];
  for (let h = 0; h < hours; h++) {
    for (let i = 0; i < 6; i++) {
      const t = start + h * 3_600_000 + Math.floor(random() * 3_600_000);
      const r = random();
      if (r < 0.15) {
        lines.push({
          t,
          pri: 38,
          app: "sshd",
          msg: `Failed password for invalid user admin from 203.0.113.${Math.floor(random() * 250)} port ${40000 + Math.floor(random() * 20000)} ssh2`,
        });
      } else if (r < 0.2) {
        lines.push({
          t,
          pri: 27,
          app: "kernel",
          msg: `EXT4-fs error (device sda1): ext4_find_entry:1455: inode #${Math.floor(random() * 99999)}: comm example-app: reading directory lblock 0`,
        });
      } else if (r < 0.25) {
        lines.push({
          t,
          pri: 28,
          app: "systemd",
          msg: "example-app.service: Watchdog timeout (limit 30s)!",
        });
      } else {
        lines.push({
          t,
          pri: 30,
          app: "CRON",
          msg: `(root) CMD (/usr/local/bin/backup.sh --quiet)`,
        });
      }
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}
const server = serverLines(OCT(13), 48);
const host = () => pick(HOSTS);
files["syslog-3164.log"] =
  server
    .map((l) => {
      const d = new Date(l.t);
      return `${MON[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, " ")} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${host()} ${l.app}[${1000 + Math.floor(random() * 9000)}]: ${l.msg}`;
    })
    .join("\n") + "\n";
files["syslog-5424.log"] =
  server
    .map(
      (l) =>
        `<${l.pri}>1 ${new Date(l.t).toISOString()} ${host()}.example.net ${l.app} ${1000 + Math.floor(random() * 9000)} - - ${l.msg}`,
    )
    .join("\n") + "\n";
files["syslog-iso.log"] =
  server
    .map(
      (l) =>
        `${new Date(l.t).toISOString().replace("Z", "+00:00")} ${host()} ${l.app}[${1000 + Math.floor(random() * 9000)}]: ${l.msg}`,
    )
    .join("\n") + "\n";

// --- A web server: steady traffic, bots, a burst of 502s.
const accessTime = (t) => {
  const d = new Date(t);
  return `${pad(d.getUTCDate())}/${MON[d.getUTCMonth()]}/${d.getUTCFullYear()}:${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
};
const CLIENTS = [
  "203.0.113.9",
  "198.51.100.23",
  "192.0.2.144",
  "203.0.113.77",
  "198.51.100.5",
];
const requests = [];
for (let h = 0; h < 7 * 24; h++) {
  for (let i = 0; i < 20; i++) {
    const t = OCT(8) + h * 3_600_000 + Math.floor(random() * 3_600_000);
    const r = random();
    const ip = r < 0.4 ? CLIENTS[0] : pick(CLIENTS);
    if (r < 0.04)
      requests.push({ t, ip, req: "POST /wp-login.php HTTP/1.1", status: 404 });
    else if (r < 0.05)
      requests.push({ t, ip, req: "GET /.env HTTP/1.1", status: 404 });
    else if (r < 0.06)
      requests.push({
        t,
        ip,
        req: "GET /images/team-photo.jpg HTTP/1.1",
        status: 404,
      });
    else if (r < 0.1)
      requests.push({
        t,
        ip,
        req: `GET /api/orders/${Math.floor(random() * 900)}?page=${1 + Math.floor(random() * 5)} HTTP/1.1`,
        status: 200,
      });
    else
      requests.push({
        t,
        ip,
        req: pick([
          "GET / HTTP/1.1",
          "GET /about HTTP/1.1",
          "GET /static/site.css HTTP/2.0",
        ]),
        status: random() < 0.1 ? 304 : 200,
      });
  }
}
for (let i = 0; i < 31; i++) {
  requests.push({
    t: OCT(14, 3, 10) + Math.floor((i / 31) * 15 * 60_000),
    ip: pick(CLIENTS),
    req: `GET /api/orders/${100 + i}?page=1 HTTP/1.1`,
    status: 502,
  });
}
for (const t of [OCT(9, 11), OCT(11, 18), OCT(13, 18, 2), OCT(15, 1)]) {
  requests.push({
    t,
    ip: pick(CLIENTS),
    req: "GET /api/orders/12?page=2 HTTP/1.1",
    status: 502,
  });
}
requests.push({ t: OCT(12, 4), ip: CLIENTS[1], req: "-", status: 400 });
requests.sort((a, b) => a.t - b.t);
files["access.log"] =
  requests
    .map(
      (r) =>
        `${r.ip} - - [${accessTime(r.t)}] "${r.req}" ${r.status} ${r.status === 304 ? 0 : 512 + Math.floor(random() * 4000)} "${r.status === 404 && r.req.includes("team-photo") ? "https://example.com/about" : "-"}" "Mozilla/5.0 (X11; Linux x86_64)"`,
    )
    .join("\n") + "\n";

// --- nginx's error log.
const nginxTime = (t) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
const nginx = [];
for (let i = 0; i < 31; i++) {
  const t = OCT(14, 3, 10) + Math.floor((i / 31) * 15 * 60_000);
  nginx.push(
    `${nginxTime(t)} [error] 1234#1234: *${5000 + i} connect() failed (111: Connection refused) while connecting to upstream, client: ${pick(CLIENTS)}, server: example.com, request: "GET /api/orders/${100 + i}?page=1 HTTP/1.1", upstream: "http://127.0.0.1:3000/api/orders/${100 + i}?page=1", host: "example.com"`,
  );
}
for (let i = 0; i < 12; i++) {
  nginx.push(
    `${nginxTime(OCT(8 + (i % 7), 9, i))} [warn] 1234#1234: *${100 + i} an upstream response is buffered to a temporary file /var/cache/nginx/proxy_temp/${i}/00/000000000${i} while reading upstream, client: ${pick(CLIENTS)}, server: example.com`,
  );
}
nginx.push(`${nginxTime(OCT(8, 0, 1))} [notice] 1#1: signal process started`);
files["nginx-error.log"] = `${nginx.join("\n")}\n`;

// --- Not readable here.
files["fake.evtx"] = Buffer.concat([
  Buffer.from("ElfFile\0", "latin1"),
  Buffer.alloc(120),
]);
files["not-a-log.txt"] = "Shopping list\nMilk\nBread\nCoffee\n";

for (const [name, content] of Object.entries(files)) {
  writeFileSync(join(OUT, name), content);
  console.log(`${name} ${Buffer.byteLength(content)} B`);
}

// --- The page's example: a small System log with three restarts after
// something went wrong, and the DCOM noise every Windows PC logs.
const example = windowsEvents(OCT(6), 7, {
  perDay: 28,
  dcom: 0.25,
  crashes: [OCT(7, 21, 40), OCT(9, 23, 4), OCT(12, 23, 4)],
});
writeFileSync(join(SRC, "example.csv"), table(example, EN));
console.log(`../src/example.csv ${example.length} events`);
