/**
 * Zero-dependency streaming ZIP archive builder (STORE method, UTF-8 filenames).
 * Compatible with Windows Explorer, macOS Archive Utility, iOS Files, and Android.
 */

const fs = require('fs');
const path = require('path');

// Precomputed IEEE 802.3 CRC-32 lookup table
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

/**
 * Create a .zip file on disk from a list of { filePath, entryName } items.
 * Uses STORE (uncompressed) so MP3s pack instantaneously with minimal memory.
 */
function createZipFromFiles(entries, outZipPath) {
  const fd = fs.openSync(outZipPath, 'w');
  const centralRecords = [];
  const usedNames = new Set();
  let offset = 0;

  try {
    for (const item of entries) {
      if (!item.filePath || !fs.existsSync(item.filePath)) continue;

      // Ensure unique entry filename inside ZIP
      let baseName = item.entryName || path.basename(item.filePath);
      if (usedNames.has(baseName.toLowerCase())) {
        const ext = path.extname(baseName);
        const stem = path.basename(baseName, ext);
        let n = 2;
        while (usedNames.has(`${stem} (${n})${ext}`.toLowerCase())) n++;
        baseName = `${stem} (${n})${ext}`;
      }
      usedNames.add(baseName.toLowerCase());

      const fileBuf = fs.readFileSync(item.filePath);
      const stat = fs.statSync(item.filePath);
      const { dosTime, dosDate } = dosDateTime(stat.mtime);
      const crc = crc32(fileBuf);
      const nameBuf = Buffer.from(baseName, 'utf8');
      const size = fileBuf.length;

      // Local file header (30 bytes + filename)
      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0); // Signature
      localHeader.writeUInt16LE(20, 4);         // Version needed (2.0)
      localHeader.writeUInt16LE(0x0800, 6);     // UTF-8 filename flag
      localHeader.writeUInt16LE(0, 8);          // Compression: STORE
      localHeader.writeUInt16LE(dosTime, 10);
      localHeader.writeUInt16LE(dosDate, 12);
      localHeader.writeUInt32LE(crc, 14);
      localHeader.writeUInt32LE(size, 18);      // Compressed size
      localHeader.writeUInt32LE(size, 22);      // Uncompressed size
      localHeader.writeUInt16LE(nameBuf.length, 26);
      localHeader.writeUInt16LE(0, 28);         // Extra field length

      fs.writeSync(fd, localHeader);
      fs.writeSync(fd, nameBuf);
      fs.writeSync(fd, fileBuf);

      centralRecords.push({
        localOffset: offset,
        crc,
        size,
        dosTime,
        dosDate,
        nameBuf
      });

      offset += 30 + nameBuf.length + size;
    }

    const centralStart = offset;
    let centralSize = 0;

    for (const rec of centralRecords) {
      const cdHeader = Buffer.alloc(46);
      cdHeader.writeUInt32LE(0x02014b50, 0);     // Central file header signature
      cdHeader.writeUInt16LE(20, 4);             // Version made by
      cdHeader.writeUInt16LE(20, 6);             // Version needed
      cdHeader.writeUInt16LE(0x0800, 8);         // UTF-8 flag
      cdHeader.writeUInt16LE(0, 10);             // Compression: STORE
      cdHeader.writeUInt16LE(rec.dosTime, 12);
      cdHeader.writeUInt16LE(rec.dosDate, 14);
      cdHeader.writeUInt32LE(rec.crc, 16);
      cdHeader.writeUInt32LE(rec.size, 20);
      cdHeader.writeUInt32LE(rec.size, 24);
      cdHeader.writeUInt16LE(rec.nameBuf.length, 28);
      cdHeader.writeUInt16LE(0, 30);             // Extra length
      cdHeader.writeUInt16LE(0, 32);             // Comment length
      cdHeader.writeUInt16LE(0, 34);             // Disk number
      cdHeader.writeUInt16LE(0, 36);             // Internal attrs
      cdHeader.writeUInt32LE(0, 38);             // External attrs
      cdHeader.writeUInt32LE(rec.localOffset, 42);

      fs.writeSync(fd, cdHeader);
      fs.writeSync(fd, rec.nameBuf);
      centralSize += 46 + rec.nameBuf.length;
    }

    // End of central directory record (22 bytes)
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(centralRecords.length, 8);
    eocd.writeUInt16LE(centralRecords.length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(centralStart, 16);
    eocd.writeUInt16LE(0, 20);

    fs.writeSync(fd, eocd);
  } finally {
    fs.closeSync(fd);
  }

  return {
    zipPath: outZipPath,
    size: fs.statSync(outZipPath).size,
    count: centralRecords.length
  };
}

module.exports = { createZipFromFiles, crc32 };

