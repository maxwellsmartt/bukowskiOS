// Minimal dependency-free ZIP writer using the STORE method (no compression).
//
// Invoice documents are PNG/JPG/PDF — already compressed — so STORE keeps the
// code tiny and bullet-proof (no async zlib) while producing a fully valid
// .zip that Finder, Windows Explorer and `unzip` all open.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer: Buffer): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

// DOS date/time per the ZIP spec (local time).
const dosDateTime = (date: Date) => {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2));
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: time & 0xffff, day: day & 0xffff };
};

export type ZipEntry = { name: string; data: Buffer };

/** Build a STORE-method ZIP archive from the given entries. */
export const buildZip = (entries: ZipEntry[], now: Date = new Date()): Buffer => {
  const { time, day } = dosDateTime(now);
  const fileParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  entries.forEach((entry) => {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // flags: UTF-8 filename
    localHeader.writeUInt16LE(0, 8); // method: store
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(day, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18); // compressed size
    localHeader.writeUInt32LE(size, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra length

    fileParts.push(localHeader, nameBuf, entry.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central dir signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // flags: UTF-8
    centralHeader.writeUInt16LE(0, 10); // method: store
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(day, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(size, 20);
    centralHeader.writeUInt32LE(size, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // local header offset

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + entry.data.length;
  });

  const centralDir = Buffer.concat(centralParts);
  const fileData = Buffer.concat(fileParts);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central dir signature
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // central dir disk
  end.writeUInt16LE(entries.length, 8); // entries on this disk
  end.writeUInt16LE(entries.length, 10); // total entries
  end.writeUInt32LE(centralDir.length, 12); // central dir size
  end.writeUInt32LE(fileData.length, 16); // central dir offset
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([fileData, centralDir, end]);
};

/** Disambiguate duplicate filenames inside an archive: a.png, a (2).png, … */
export const dedupeZipNames = (names: string[]): string[] => {
  const seen = new Map<string, number>();
  return names.map((rawName) => {
    const name = rawName.replace(/[\\/]/g, "_").trim() || "factura";
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count === 0) return name;
    const dot = name.lastIndexOf(".");
    if (dot <= 0) return `${name} (${count + 1})`;
    return `${name.slice(0, dot)} (${count + 1})${name.slice(dot)}`;
  });
};
