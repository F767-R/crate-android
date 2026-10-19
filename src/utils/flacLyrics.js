const textDecoder = new TextDecoder('utf-8');

/** @param {Uint8Array} data @param {number} offset @param {number} length */
function requireBytes(data, offset, length) {
  if (offset < 0 || length < 0 || offset + length > data.byteLength) {
    throw new Error('Truncated FLAC metadata');
  }
}

/** @param {Uint8Array} data @param {number} offset */
function readUint32LE(data, offset) {
  requireBytes(data, offset, 4);
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

/** @param {ArrayBuffer | Uint8Array} buffer @returns {Record<string, string>} */
export function parseFlacVorbisComments(buffer) {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  requireBytes(data, 0, 4);
  if (textDecoder.decode(data.subarray(0, 4)) !== 'fLaC') {
    throw new Error('Not a FLAC file');
  }

  let offset = 4;
  while (offset + 4 <= data.byteLength) {
    const header = data[offset++] ?? 0;
    const isLast = (header & 0x80) !== 0;
    const blockType = header & 0x7f;
    requireBytes(data, offset, 3);
    const blockLength = ((data[offset] ?? 0) << 16) | ((data[offset + 1] ?? 0) << 8) | (data[offset + 2] ?? 0);
    offset += 3;
    requireBytes(data, offset, blockLength);

    if (blockType === 4) {
      const end = offset + blockLength;
      let position = offset;
      if (position + 4 > end) throw new Error('Truncated Vorbis vendor length');
      const vendorLength = readUint32LE(data, position);
      position += 4;
      if (position + vendorLength + 4 > end) throw new Error('Truncated Vorbis vendor');
      requireBytes(data, position, vendorLength);
      position += vendorLength;

      const commentCount = readUint32LE(data, position);
      position += 4;
      /** @type {Record<string, string>} */
      const comments = Object.create(null);
      for (let index = 0; index < commentCount; index++) {
        if (position + 4 > end) throw new Error('Truncated Vorbis comment length');
        const commentLength = readUint32LE(data, position);
        position += 4;
        if (position + commentLength > end) throw new Error('Truncated Vorbis comment');
        const field = textDecoder.decode(data.subarray(position, position + commentLength));
        position += commentLength;
        const separator = field.indexOf('=');
        if (separator > 0) {
          comments[field.slice(0, separator).trim().toUpperCase()] = field.slice(separator + 1);
        }
      }
      return comments;
    }

    offset += blockLength;
    if (isLast) break;
  }

  throw new Error('No VORBIS_COMMENT block');
}

/** @param {ArrayBuffer | Uint8Array} buffer @param {string} tag */
export function extractLyricsFromFlac(buffer, tag = '') {
  try {
    const comments = parseFlacVorbisComments(buffer);
    if (tag) {
      const value = comments[tag.trim().toUpperCase()];
      return typeof value === 'string' && value.trim() ? value : null;
    }
    for (const key of ['LYRICS', 'UNSYNCED LYRICS', 'UNSYNCEDLYRICS']) {
      const lyrics = comments[key];
      if (typeof lyrics === 'string' && lyrics.trim()) return lyrics;
    }
    for (const [key, value] of Object.entries(comments)) {
      if (key.includes('LYRIC') && typeof value === 'string' && value.trim()) return value;
    }
  } catch (_) {}
  return null;
}
