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

// --- .evtx: Windows' own binary log, laid out as `wevtutil epl` writes
// it, with the same week as the XML. A 4 KB header, then 64 KB chunks of
// records; each event is binary XML, a template (written out the first
// time a chunk uses it, pointed back to after that) and its values. The
// checksums are real, so Windows' own reader opens the file too
// (Get-WinEvent -Path system.evtx).
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (...parts) => {
  let c = 0xffffffff;
  for (const part of parts) {
    for (const b of part) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};
// Value types.
const T = {
  string: 0x01,
  u8: 0x04,
  u16: 0x06,
  u32: 0x08,
  u64: 0x0a,
  guid: 0x0f,
  filetime: 0x11,
  sid: 0x13,
  hex64: 0x15,
  binxml: 0x21,
  strings: 0x81,
};
// A template's shape: elements, attributes, text, and numbered slots
// (`optional` ones are left out when they have no value).
const el = (name, attributes, children = []) => ({
  name,
  attributes,
  children,
});
const slot = (n, type, optional = false) => ({ slot: n, type, optional });
const SYSTEM = el(
  "Event",
  [["xmlns", "http://schemas.microsoft.com/win/2004/08/events/event"]],
  [
    el(
      "System",
      [],
      [
        el("Provider", [
          ["Name", slot(0, T.string)],
          ["Guid", slot(1, T.guid, true)],
          ["EventSourceName", slot(2, T.string, true)],
        ]),
        el("EventID", [["Qualifiers", slot(3, T.u16, true)]], [slot(4, T.u16)]),
        el("Version", [], [slot(5, T.u8)]),
        el("Level", [], [slot(6, T.u8)]),
        el("Task", [], [slot(7, T.u16)]),
        el("Opcode", [], [slot(8, T.u8)]),
        el("Keywords", [], [slot(9, T.hex64)]),
        el("TimeCreated", [["SystemTime", slot(10, T.filetime)]]),
        el("EventRecordID", [], [slot(11, T.u64)]),
        el("Correlation", [["ActivityID", slot(12, T.guid, true)]]),
        el("Execution", [
          ["ProcessID", slot(13, T.u32)],
          ["ThreadID", slot(14, T.u32)],
        ]),
        el("Channel", [], [slot(15, T.string)]),
        el("Computer", [], [slot(16, T.string)]),
        el("Security", [["UserID", slot(17, T.sid, true)]]),
      ],
    ),
    slot(18, T.binxml),
  ],
);
// The event's data: one named string, or (as classic sources write it) a
// list of strings, one <Data> each.
const DETAIL = el(
  "EventData",
  [],
  [el("Data", [["Name", "Detail"]], [slot(0, T.string)])],
);
const DETAIL_LIST = el(
  "EventData",
  [],
  [el("Data", [["Name", "Detail"]], [slot(0, T.strings)])],
);

/** A GUID's bytes, from "{xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}". */
function guidBytes(text) {
  const h = text.replace(/[{}-]/g, "");
  const b = Buffer.from(h, "hex");
  return Buffer.concat([
    Buffer.from(b.subarray(0, 4)).reverse(),
    Buffer.from(b.subarray(4, 6)).reverse(),
    Buffer.from(b.subarray(6, 8)).reverse(),
    b.subarray(8),
  ]);
}
const SYSTEM_SID = Buffer.from([1, 1, 0, 0, 0, 0, 0, 5, 18, 0, 0, 0]);
const FILETIME_1970 = 116_444_736_000_000_000n;

class EvtxChunk {
  constructor() {
    this.b = Buffer.alloc(0x10000);
    this.pos = 512;
    this.names = new Map();
    this.templates = new Map();
    this.first = null;
    this.last = null;
    this.lastAt = 0;
  }
  u8(v) {
    this.pos = this.b.writeUInt8(v, this.pos);
  }
  u16(v) {
    this.pos = this.b.writeUInt16LE(v, this.pos);
  }
  u32(v) {
    this.pos = this.b.writeUInt32LE(v, this.pos);
  }
  u64(v) {
    this.pos = this.b.writeBigUInt64LE(BigInt(v), this.pos);
  }
  bytes(buf) {
    if (this.pos + buf.length > this.b.length) throw new RangeError("full");
    this.pos += buf.copy(this.b, this.pos);
  }
  /** A name: written out the first time, pointed back to after that. */
  name(text) {
    if (this.names.has(text)) return this.u32(this.names.get(text));
    const at = this.pos + 4;
    this.names.set(text, at);
    this.u32(at);
    this.u32(0);
    this.u16(0);
    this.u16(text.length);
    this.bytes(Buffer.from(`${text}\0`, "utf16le"));
  }
  text(s) {
    this.u8(0x05);
    this.u8(T.string);
    this.u16(s.length);
    this.bytes(Buffer.from(s, "utf16le"));
  }
  part(p) {
    if (typeof p === "string") return this.text(p);
    if ("slot" in p) {
      this.u8(p.optional ? 0x0e : 0x0d);
      this.u16(p.slot);
      return this.u8(p.type);
    }
    const start = this.pos;
    this.u8(p.attributes.length ? 0x41 : 0x01);
    this.u16(0xffff);
    const sizeAt = this.pos;
    this.u32(0);
    this.name(p.name);
    let listAt = 0;
    if (p.attributes.length) {
      listAt = this.pos;
      this.u32(0);
    }
    p.attributes.forEach(([name, value], i) => {
      this.u8(i < p.attributes.length - 1 ? 0x46 : 0x06);
      this.name(name);
      this.part(value);
    });
    if (listAt) this.b.writeUInt32LE(this.pos - listAt - 4, listAt);
    if (p.children.length) {
      this.u8(0x02);
      for (const child of p.children) this.part(child);
      this.u8(0x04);
    } else {
      this.u8(0x03);
    }
    this.b.writeUInt32LE(this.pos - start - 7, sizeAt);
  }
  /** A template and its values: [type, bytes or a writer] for each slot. */
  instance(id, tree, values) {
    this.u8(0x0c);
    this.u8(0x01);
    this.u32(id);
    if (this.templates.has(id)) {
      this.u32(this.templates.get(id));
    } else {
      const at = this.pos + 4;
      this.templates.set(id, at);
      this.u32(at);
      this.u32(0);
      this.bytes(
        guidBytes(`{00000000-0000-0000-0000-${String(id).padStart(12, "0")}}`),
      );
      const sizeAt = this.pos;
      this.u32(0);
      this.fragment(() => this.part(tree));
      this.b.writeUInt32LE(this.pos - sizeAt - 4, sizeAt);
    }
    this.u32(values.length);
    const descriptors = this.pos;
    for (const [type] of values) {
      this.u16(0);
      this.u8(type);
      this.u8(0);
    }
    values.forEach(([, value], i) => {
      const start = this.pos;
      if (typeof value === "function") value();
      else this.bytes(value);
      this.b.writeUInt16LE(this.pos - start, descriptors + i * 4);
    });
  }
  fragment(body) {
    for (const b of [0x0f, 1, 1, 0]) this.u8(b);
    body();
    this.u8(0x00);
  }
  /** A record, or false (and nothing written) when it doesn't fit. */
  record(id, filetime, body) {
    const saved = [this.pos, new Map(this.names), new Map(this.templates)];
    const start = this.pos;
    try {
      this.u32(0x2a2a);
      this.u32(0);
      this.u64(id);
      this.u64(filetime);
      this.fragment(body);
      const size = this.pos + 4 - start;
      this.u32(size);
      this.b.writeUInt32LE(size, start + 4);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      [this.pos, this.names, this.templates] = saved;
      this.b.fill(0, start);
      return false;
    }
    this.first ??= id;
    this.last = id;
    this.lastAt = start;
    return true;
  }
  /** The chunk, with its header. */
  done() {
    const h = this.b;
    h.write("ElfChnk\0", 0, "latin1");
    // The records' numbers in the log, then their IDs: the same here.
    for (const [at, v] of [
      [8, this.first],
      [16, this.last],
      [24, this.first],
      [32, this.last],
    ]) {
      h.writeBigUInt64LE(BigInt(v), at);
    }
    h.writeUInt32LE(128, 40);
    h.writeUInt32LE(this.lastAt, 44);
    h.writeUInt32LE(this.pos, 48);
    h.writeUInt32LE(crc32(h.subarray(512, this.pos)), 52);
    h.writeUInt32LE(crc32(h.subarray(0, 120), h.subarray(128, 512)), 124);
    return h;
  }
}

function evtx(events) {
  const chunks = [];
  let chunk = new EvtxChunk();
  let id = 1;
  for (const e of events) {
    const provider = PROVIDERS[e.source] ?? `Name="${e.source}"`;
    const attr = (name) => new RegExp(`${name}="([^"]*)"`).exec(provider)?.[1];
    const utf16 = (s) => Buffer.from(s, "utf16le");
    const u = (n, bytes) => {
      const b = Buffer.alloc(bytes);
      b.writeUIntLE(n, 0, bytes);
      return b;
    };
    const u64 = (n) => {
      const b = Buffer.alloc(8);
      b.writeBigUInt64LE(BigInt(n));
      return b;
    };
    // The XML fixture's times end in .1234567.
    const time = BigInt(e.t) * 10_000n + FILETIME_1970 + 1_234_567n;
    const classic = e.source === "EventLog";
    const guid = attr("Guid");
    const sourceName = attr("EventSourceName");
    const none = Buffer.alloc(0);
    const body = (record) => () =>
      chunk.instance(1, SYSTEM, [
        [T.string, utf16(attr("Name"))],
        guid ? [T.guid, guidBytes(guid)] : [0, none],
        sourceName ? [T.string, utf16(sourceName)] : [0, none],
        classic ? [T.u16, u(0x8000, 2)] : [0, none],
        [T.u16, u(e.id, 2)],
        [T.u8, u(0, 1)],
        [T.u8, u(LEVEL_N[e.level], 1)],
        [T.u16, u(0, 2)],
        [T.u8, u(0, 1)],
        [T.hex64, u64(0x8000000000000000n)],
        [T.filetime, u64(time)],
        [T.u64, u64(record)],
        [0, none],
        [T.u32, u(4, 4)],
        [T.u32, u(8, 4)],
        [T.string, utf16("System")],
        [T.string, utf16("EXAMPLE-PC")],
        classic ? [0, none] : [T.sid, SYSTEM_SID],
        [
          T.binxml,
          () =>
            chunk.fragment(() =>
              classic
                ? chunk.instance(3, DETAIL_LIST, [
                    [T.strings, utf16(`${e.message}\0`)],
                  ])
                : chunk.instance(2, DETAIL, [[T.string, utf16(e.message)]]),
            ),
        ],
      ]);
    if (!chunk.record(id, time, body(id))) {
      chunks.push(chunk);
      chunk = new EvtxChunk();
      if (!chunk.record(id, time, body(id))) throw new Error("event too big");
    }
    id++;
  }
  chunks.push(chunk);
  const done = chunks.map((c) => c.done());
  const header = Buffer.alloc(4096);
  header.write("ElfFile\0", 0, "latin1");
  header.writeBigUInt64LE(0n, 8);
  header.writeBigUInt64LE(BigInt(done.length - 1), 16);
  header.writeBigUInt64LE(BigInt(id), 24);
  header.writeUInt32LE(128, 32);
  header.writeUInt16LE(2, 36);
  header.writeUInt16LE(3, 38);
  header.writeUInt16LE(4096, 40);
  header.writeUInt16LE(done.length, 42);
  header.writeUInt32LE(crc32(header.subarray(0, 120)), 124);
  return Buffer.concat([header, ...done]);
}
files["system.evtx"] = evtx(week);

// --- Not readable here: an .evtx header with no events after it.
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
