// Minimal ID3v2 (2.2 / 2.3 / 2.4) text-frame reader for the BGM pipeline. The mp3s
// carry clean title / artist / album tags. Used by tools/bgm/sync-metadata.mjs to
// seed each blob's title/artist/album metadata, which the backend then lists to
// build /api/bgm. Returns cleaned, junk-filtered fields — any field may be '' and
// the caller falls back to the filename.

function synchsafe(b, o) {
  return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
}
function u32(b, o) {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function decodeText(d) {
  if (!d || !d.length) return '';
  const enc = d[0];
  const s = d.subarray(1);
  if (enc === 0) return Buffer.from(s).toString('latin1');
  if (enc === 3) return Buffer.from(s).toString('utf8');
  if (enc === 1 || enc === 2) {
    let bytes = s;
    if (enc === 1) {
      if (s[0] === 0xff && s[1] === 0xfe) bytes = s.subarray(2);
      else if (s[0] === 0xfe && s[1] === 0xff) {
        const sw = Buffer.from(s.subarray(2));
        for (let i = 0; i + 1 < sw.length; i += 2) { const t = sw[i]; sw[i] = sw[i + 1]; sw[i + 1] = t; }
        bytes = sw;
      }
    }
    return Buffer.from(bytes).toString('utf16le');
  }
  return Buffer.from(s).toString('latin1');
}

const clean = (v) => (typeof v === 'string' ? v.replace(/\0+$/, '').trim() : '');
// Some tracks ship placeholder junk (e.g. artist + album both "Downloads") — treat as absent.
const JUNK = new Set(['', 'downloads', 'unknown', 'unknown artist', 'untitled', 'track']);
const meaningful = (v) => { const t = clean(v); return JUNK.has(t.toLowerCase()) ? '' : t; };

export function parseId3(buf) {
  const out = { title: '', artist: '', album: '', genre: '', year: '' };
  if (!buf || buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return out;
  const ver = buf[3];
  const end = Math.min(10 + synchsafe(buf, 6), buf.length);
  const idLen = ver === 2 ? 3 : 4;
  const headerLen = ver === 2 ? 6 : 10;
  const frames = {};
  let off = 10;
  while (off + headerLen <= end) {
    const id = buf.toString('latin1', off, off + idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break; // padding / end of frames
    let size;
    if (ver === 2) size = (buf[off + 3] << 16) | (buf[off + 4] << 8) | buf[off + 5];
    else if (ver === 4) size = synchsafe(buf, off + 4);
    else size = u32(buf, off + 4);
    off += headerLen;
    if (size <= 0 || off + size > buf.length) break;
    if (id[0] === 'T') frames[id] = decodeText(buf.subarray(off, off + size));
    off += size;
  }
  out.title = meaningful(frames.TIT2 || frames.TT2);
  out.artist = meaningful(frames.TPE1 || frames.TP1 || frames.TPE2 || frames.TP2);
  out.album = meaningful(frames.TALB || frames.TAL);
  out.genre = meaningful(frames.TCON || frames.TCO);
  out.year = meaningful(frames.TYER || frames.TDRC || frames.TYE);
  return out;
}

// Fetch just enough of a remote mp3 to read its ID3v2 tag, then parse it. Best-effort:
// any network/parse problem yields empty fields.
export async function fetchId3(url, { timeoutMs = 8000 } = {}) {
  try {
    const first = await fetch(url, { headers: { Range: 'bytes=0-65535' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!first.ok && first.status !== 206) return parseId3(Buffer.alloc(0));
    let buf = Buffer.from(await first.arrayBuffer());
    if (buf.length >= 10 && buf.toString('latin1', 0, 3) === 'ID3') {
      const need = 10 + synchsafe(buf, 6);
      if (need > buf.length && need <= 1024 * 1024) {
        const more = await fetch(url, { headers: { Range: `bytes=0-${need - 1}` }, signal: AbortSignal.timeout(timeoutMs) });
        if (more.ok || more.status === 206) buf = Buffer.from(await more.arrayBuffer());
      }
    }
    return parseId3(buf);
  } catch {
    return parseId3(Buffer.alloc(0));
  }
}
