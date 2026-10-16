// Windows events this page can explain, each in one plain sentence. The
// sources are matched as Event Viewer shows them ("Kernel-Power") or as
// the XML names them ("Microsoft-Windows-Kernel-Power", or the classic
// name it gives as EventSourceName: "DCOM", "BugCheck"). Some are common
// noise, never the headline; some mark when the PC started or stopped.
import type { Level } from "./model.ts";

export interface Known {
  plain: string;
  /** The level Windows logs it at, for a log whose level words are in a
   * language this page doesn't know. */
  level: Level;
  /** Common noise: listed apart and never the verdict. */
  noise?: true;
  /** A start of Windows, or a stop without shutting down. */
  marker?: "start" | "unexpected";
  /** A start of Windows when its message matches. */
  startWhen?: RegExp;
}

/** A source as one name: lower case, without "Microsoft-Windows-", and
 * with the drivers that put their version in their name taken together. */
export function canonical(source: string): string {
  const s = source
    .trim()
    .toLowerCase()
    .replace(/^microsoft-windows-/, "");
  if (/^netwtw\d*$/.test(s)) return "netwtw";
  // Intel's wired drivers: e1dexpress, e1rexpress, e2fnexpress (I225 and
  // I226) and the like.
  if (/^e[12][a-z]*(express|\d+x64)$/.test(s)) return "e1express";
  return Object.hasOwn(ALIASES, s) ? (ALIASES[s] ?? s) : s;
}

const ALIASES: Record<string, string> = {
  // The XML's EventSourceName for Microsoft-Windows-DistributedCOM.
  dcom: "distributedcom",
  "dns client events": "dns-client",
  "wer-systemerrorreporting": "bugcheck",
  eventlog: "eventlog",
  "windows update client": "windowsupdateclient",
  "kernel-power": "kernel-power",
  "time service": "time-service",
};

const ENTRIES: [string, number[], Known][] = [
  [
    "kernel-power",
    [41],
    {
      level: "critical",
      marker: "unexpected",
      plain:
        "The PC restarted without shutting down first: it crashed or lost power, or it stopped responding and someone held the power button.",
    },
  ],
  [
    "kernel-power",
    [109],
    {
      level: "information",
      plain: "Windows was asked to shut down or restart.",
    },
  ],
  [
    "eventlog",
    [6008],
    {
      level: "error",
      plain:
        "On the next start, Windows noted that the shutdown before it was unexpected.",
    },
  ],
  [
    "eventlog",
    [6005],
    {
      level: "information",
      marker: "start",
      plain: "The event log started, as it does each time Windows starts.",
    },
  ],
  [
    "eventlog",
    [6006],
    {
      level: "information",
      plain:
        "The event log stopped, as it does when Windows shuts down properly.",
    },
  ],
  [
    "kernel-general",
    [12],
    {
      level: "information",
      marker: "start",
      plain: "Windows started.",
    },
  ],
  [
    "kernel-general",
    [13],
    {
      level: "information",
      plain: "Windows shut down.",
    },
  ],
  [
    "kernel-boot",
    [20, 25, 32],
    {
      level: "information",
      plain: "Details of how Windows started.",
    },
  ],
  [
    "kernel-boot",
    [27],
    {
      level: "information",
      // "The boot type was 0x1" (or "BootType: 1" in the XML's data) is a
      // start from Fast Startup, which may log no 6005 or Kernel-General
      // 12.
      startWhen: /\b0x0*1\b|^(?:BootType: )?1(?:[\s;]|$)/,
      plain: "Details of how Windows started.",
    },
  ],
  [
    "user32",
    [1074],
    {
      level: "information",
      plain:
        "A program or a person restarted or shut down the PC. The message says which.",
    },
  ],
  [
    "bugcheck",
    [1001],
    {
      level: "error",
      plain: "Windows stopped with a blue screen and saved a crash report.",
    },
  ],
  [
    "whea-logger",
    [17],
    {
      level: "warning",
      plain:
        "A hardware link (usually PCIe) fixed an error by itself. Once in a while is harmless; often, it can point to a device or its driver.",
    },
  ],
  [
    "whea-logger",
    [18],
    {
      level: "error",
      plain:
        "The hardware hit an error it couldn’t fix, which usually stops the PC. It can point to the processor, the memory or overheating.",
    },
  ],
  [
    "whea-logger",
    [19],
    {
      level: "warning",
      plain:
        "The processor fixed an error by itself. Once in a while is harmless; often, it can point to overheating or an unstable overclock.",
    },
  ],
  [
    "whea-logger",
    [47],
    {
      level: "warning",
      plain:
        "The memory fixed an error by itself. Once in a while is harmless; often, it can point to a failing memory module.",
    },
  ],
  [
    "disk",
    [7],
    {
      level: "error",
      plain:
        "The disk has a bad block: a spot it can’t read or write. Back up your files, then check the drive’s health.",
    },
  ],
  [
    "disk",
    [51],
    {
      level: "warning",
      plain:
        "Windows hit an error moving data to or from the disk. Once in a while is harmless; often, it can point to a failing drive or cable.",
    },
  ],
  [
    "disk",
    [153],
    {
      level: "warning",
      plain:
        "The disk took too long to answer and Windows tried again. Once in a while is harmless; often, it can point to a failing drive or cable.",
    },
  ],
  [
    "ntfs",
    [55],
    {
      level: "error",
      plain:
        "Windows found damage in a drive’s file system. A disk check (chkdsk) can repair it.",
    },
  ],
  [
    "ntfs",
    [98],
    {
      level: "information",
      plain:
        "Windows checked a drive’s file system. The message says whether it needs a repair.",
    },
  ],
  [
    "volmgr",
    [161],
    {
      level: "error",
      plain: "After a blue screen, Windows couldn’t save its crash report.",
    },
  ],
  [
    "service control manager",
    [7000],
    {
      level: "error",
      plain: "A service failed to start.",
    },
  ],
  [
    "service control manager",
    [7001],
    {
      level: "error",
      plain: "A service didn’t start because a service it needs didn’t start.",
    },
  ],
  [
    "service control manager",
    [7009],
    {
      level: "error",
      plain: "A service took too long to start, and Windows stopped waiting.",
    },
  ],
  [
    "service control manager",
    [7023],
    {
      level: "error",
      plain: "A service stopped with an error.",
    },
  ],
  [
    "service control manager",
    [7031],
    {
      level: "error",
      plain:
        "A service stopped unexpectedly. Windows runs the service’s recovery action next; the message says which.",
    },
  ],
  [
    "service control manager",
    [7034],
    {
      level: "error",
      plain: "A service stopped unexpectedly, and Windows didn’t restart it.",
    },
  ],
  [
    "application error",
    [1000],
    {
      level: "error",
      plain:
        "A program crashed. The message names the program and the part of it that failed.",
    },
  ],
  [
    "application hang",
    [1002],
    {
      level: "error",
      plain: "A program stopped responding and was closed.",
    },
  ],
  [
    "windowsupdateclient",
    [20],
    {
      level: "error",
      plain: "An update failed to install. Windows usually tries again later.",
    },
  ],
  [
    "distributedcom",
    [10016],
    {
      level: "error",
      noise: true,
      plain:
        "Common noise, usually safe to ignore: one of Windows’ own parts was denied a permission it asked for, by design.",
    },
  ],
  [
    "schannel",
    [36887],
    {
      level: "error",
      noise: true,
      plain:
        "Common noise, usually safe to ignore: the device at the other end of a secure connection ended it with an error.",
    },
  ],
  [
    "schannel",
    [36874],
    {
      level: "error",
      plain:
        "Another device tried to connect securely to this PC, but the two had no encryption method in common, so the connection failed.",
    },
  ],
  [
    "time-service",
    [129],
    {
      level: "warning",
      plain:
        "This PC belongs to a domain and couldn’t find a domain controller to set its clock from. Harmless unless the clock is wrong.",
    },
  ],
  [
    "time-service",
    [134],
    {
      level: "warning",
      plain:
        "Windows couldn’t look up the time server’s address. Harmless unless the clock is wrong.",
    },
  ],
  [
    "dns-client",
    [1014],
    {
      level: "warning",
      plain:
        "A name lookup timed out. Once in a while is a short network hiccup; many in a row mean the DNS server isn’t answering.",
    },
  ],
  // The Intel Wi-Fi errors Intel documents. Its other events (6062, 7021,
  // 7025 and the like) are routine, and 5007 has no source but forums.
  [
    "netwtw",
    [5002, 5005, 5010],
    {
      level: "warning",
      plain:
        "The Wi-Fi adapter hit an error, which drops the connection for a moment. Many in a row point to the Wi-Fi driver; an updated one often helps.",
    },
  ],
  [
    "e1express",
    [27],
    {
      level: "warning",
      plain:
        "The network cable was unplugged, or the wired connection dropped.",
    },
  ],
];

const TABLE = new Map<string, Known>();
for (const [source, ids, entry] of ENTRIES) {
  for (const id of ids) TABLE.set(`${source}|${id}`, entry);
}

const SOURCES = new Set(ENTRIES.map(([source]) => source));
const bare = (source: string) =>
  source
    .trim()
    .toLowerCase()
    .replace(/^microsoft-windows-/, "");

/** An XML event's source, from its provider's Name and EventSourceName.
 * Event Viewer shows the classic name ("BugCheck" for
 * Microsoft-Windows-WER-SystemErrorReporting), unless that's only a
 * nickname of a known provider ("DCOM" for DistributedCOM) or a name this
 * page doesn't know for one it does. */
export function eventSource(name: string, classic: string | null): string {
  if (!classic) return name;
  if (!name) return classic;
  const c = canonical(classic);
  const n = canonical(name);
  const nickname = c === n && bare(classic) !== c && bare(name) === n;
  return SOURCES.has(n) && (!SOURCES.has(c) || nickname) ? name : classic;
}

/** What this page knows about an event, if anything. */
export function known(source: string, id: string | null): Known | null {
  return id !== null ? (TABLE.get(`${canonical(source)}|${id}`) ?? null) : null;
}

/** Every entry, for the tests. */
export const entries = () => ENTRIES;
