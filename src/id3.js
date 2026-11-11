const fs = require('fs');
const https = require('https');
const http = require('http');

/**
 * Creates a synchsafe integer (7 bits per byte) for ID3 header
 */
function encodeSynchsafe(size) {
  const b = Buffer.alloc(4);
  b[0] = (size >> 21) & 0x7f;
  b[1] = (size >> 14) & 0x7f;
  b[2] = (size >> 7) & 0x7f;
  b[3] = size & 0x7f;
  return b;
}

/**
 * Encode an ID3v2.3 text frame (using UTF-16LE with BOM)
 */
function makeTextFrame(id, text) {
  if (!text) return Buffer.alloc(0);
  const textBuffer = Buffer.from(text, 'utf16le');
  const bom = Buffer.from([0xff, 0xfe]);
  const content = Buffer.concat([Buffer.from([0x01]), bom, textBuffer]);

  const frameHeader = Buffer.alloc(10);
  frameHeader.write(id, 0, 4, 'ascii');
  frameHeader.writeUInt32BE(content.length, 4);
  frameHeader.writeUInt16BE(0, 8);

  return Buffer.concat([frameHeader, content]);
}

/**
 * Encode an ID3v2.3 APIC (Attached Picture) frame
 */
function makePictureFrame(imageBuffer, mimeType = 'image/jpeg') {
  if (!imageBuffer || imageBuffer.length === 0) return Buffer.alloc(0);

  const cleanMime = (mimeType || 'image/jpeg').split(';')[0].trim();
  const mimeBuffer = Buffer.concat([Buffer.from(cleanMime, 'latin1'), Buffer.from([0x00])]);
  const picType = Buffer.from([0x03]); // Cover (front)
  const desc = Buffer.from([0x00]); // Empty description
  const content = Buffer.concat([Buffer.from([0x00]), mimeBuffer, picType, desc, imageBuffer]);

  const frameHeader = Buffer.alloc(10);
  frameHeader.write('APIC', 0, 4, 'ascii');
  frameHeader.writeUInt32BE(content.length, 4);
  frameHeader.writeUInt16BE(0, 8);

  return Buffer.concat([frameHeader, content]);
}

/**
 * Build complete ID3v2.3 tag buffer
 */
function createId3Tag(metadata = {}) {
  const frames = [];

  if (metadata.title) frames.push(makeTextFrame('TIT2', metadata.title));
  if (metadata.artist) frames.push(makeTextFrame('TPE1', metadata.artist));
  if (metadata.album) frames.push(makeTextFrame('TALB', metadata.album));
  if (metadata.year) frames.push(makeTextFrame('TYER', String(metadata.year)));
  if (metadata.coverBuffer) {
    frames.push(makePictureFrame(metadata.coverBuffer, metadata.coverMime || 'image/jpeg'));
  }

  const framesBuffer = Buffer.concat(frames);
  if (framesBuffer.length === 0) return Buffer.alloc(0);

  const header = Buffer.alloc(10);
  header.write('ID3', 0, 3, 'ascii');
  header[3] = 3;
  header[4] = 0;
  header[5] = 0;
  encodeSynchsafe(framesBuffer.length).copy(header, 6);

  return Buffer.concat([header, framesBuffer]);
}

/**
 * Fetch image buffer from URL (follows redirects)
 */
function fetchImage(url, redirectCount = 0) {
  return new Promise((resolve) => {
    if (!url || redirectCount > 5) return resolve(null);
    let parsed;
    try { parsed = new URL(url); } catch (_) { return resolve(null); }

    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(parsed, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, url).href;
        res.resume();
        return resolve(fetchImage(nextUrl, redirectCount + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(null);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        buffer: Buffer.concat(chunks),
        mime: (res.headers['content-type'] || 'image/jpeg').split(';')[0].trim()
      }));
    });
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

/**
 * Tag an MP3 file in place
 */
async function tagMp3File(filePath, metadata = {}) {
  try {
    let coverData = null;
    if (metadata.thumbnailUrl) {
      coverData = await fetchImage(metadata.thumbnailUrl);
    }

    const tagBuffer = createId3Tag({
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album,
      year: metadata.year,
      coverBuffer: coverData ? coverData.buffer : null,
      coverMime: coverData ? coverData.mime : 'image/jpeg'
    });

    if (tagBuffer.length === 0) return;

    const originalMp3 = fs.readFileSync(filePath);
    let audioStart = 0;
    if (originalMp3.slice(0, 3).toString('ascii') === 'ID3') {
      const tagSize = ((originalMp3[6] & 0x7f) << 21) |
                      ((originalMp3[7] & 0x7f) << 14) |
                      ((originalMp3[8] & 0x7f) << 7) |
                      (originalMp3[9] & 0x7f);
      audioStart = 10 + tagSize;
    }

    const rawAudio = originalMp3.slice(audioStart);
    const taggedMp3 = Buffer.concat([tagBuffer, rawAudio]);
    fs.writeFileSync(filePath, taggedMp3);
  } catch (err) {
    console.warn(`[ID3 Warning] Could not write ID3 tags for ${filePath}:`, err.message);
  }
}

module.exports = {
  createId3Tag,
  fetchImage,
  tagMp3File
};
