// Several clean copies as one .zip, each stored as it is: the photos are
// compressed already. The archive is put together from the copies
// themselves, so it never holds a second copy of them all: each is read
// once, for its checksum, and only one is in memory at a time.

/** A file to put in the archive. */
export interface Entry {
  name: string;
  blob: Blob;
}

// A checksum's work is cut into pieces this big, with a pause between
// them, so a big photo never holds the page.
const PIECE = 1 << 20;

let table: Uint32Array | undefined;

/** CRC-32 (the checksum zip files keep for each file), carried on from
 * `crc` for a file read in pieces. */
export function crc32(bytes: Uint8Array, crc = 0): number {
  table ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let c = ~crc;
  for (let i = 0; i < bytes.length; i++) {
    c = (table[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return ~c >>> 0;
}

/** Each name once: a second "a.jpg" becomes "a (2).jpg". */
export function uniqueNames(names: string[]): string[] {
  const taken = new Set<string>();
  return names.map((wanted) => {
    let name = wanted;
    const dot = wanted.lastIndexOf(".");
    for (let n = 2; taken.has(name); n++) {
      name =
        dot > 0
          ? `${wanted.slice(0, dot)} (${n})${wanted.slice(dot)}`
          : `${wanted} (${n})`;
    }
    taken.add(name);
    return name;
  });
}

/** The time and date as zip files keep them (local time, to 2 seconds). */
function dosTime(d: Date): [number, number] {
  return [
    (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  ];
}

const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The archive, made of the files' own blobs and the zip records between
 * them (APPNOTE 4.3: a local header before each file, then the central
 * directory and its end). */
export async function zip(entries: Entry[], now = new Date()): Promise<Blob> {
  const encoder = new TextEncoder();
  const [time, date] = dosTime(now);
  const names = uniqueNames(entries.map((e) => e.name));
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const [i, entry] of entries.entries()) {
    const bytes = new Uint8Array(await entry.blob.arrayBuffer());
    let crc = 0;
    for (let at = 0; at < bytes.length; at += PIECE) {
      crc = crc32(bytes.subarray(at, at + PIECE), crc);
      if (at + PIECE < bytes.length) await breathe();
    }
    const name = encoder.encode(names[i] ?? entry.name);
    // Bit 11: the name is UTF-8, said only when it isn't plain ASCII.
    const flags = name.length !== (names[i] ?? entry.name).length ? 0x800 : 0;
    const size = bytes.length;

    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true); // version needed: 2.0
    l.setUint16(6, flags, true);
    l.setUint16(8, 0, true); // stored, not compressed
    l.setUint16(10, time, true);
    l.setUint16(12, date, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, size, true);
    l.setUint32(22, size, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);

    const record = new Uint8Array(46 + name.length);
    const r = new DataView(record.buffer);
    r.setUint32(0, 0x02014b50, true);
    r.setUint16(4, 20, true); // made by: 2.0
    r.setUint16(6, 20, true);
    r.setUint16(8, flags, true);
    r.setUint16(10, 0, true);
    r.setUint16(12, time, true);
    r.setUint16(14, date, true);
    r.setUint32(16, crc, true);
    r.setUint32(20, size, true);
    r.setUint32(24, size, true);
    r.setUint16(28, name.length, true);
    r.setUint32(42, offset, true);
    record.set(name, 46);

    parts.push(local, entry.blob);
    central.push(record);
    offset += local.length + size;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
