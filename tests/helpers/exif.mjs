// Build a minimal EXIF (APP1) block with GPS + DateTimeOriginal and splice it into a JPEG.
// Used to test Grove's photo-location reading without committing real photos.

/** @returns {Buffer} the APP1 segment (marker included) */
export function makeExifSegment({ lat, lng, takenAt, littleEndian = true } = {}) {
  const le = littleEndian;
  const tiff = Buffer.alloc(512);
  let free = 8; // next free byte after the header
  const u16 = (o, v) => (le ? tiff.writeUInt16LE(v, o) : tiff.writeUInt16BE(v, o));
  const u32 = (o, v) => (le ? tiff.writeUInt32LE(v, o) : tiff.writeUInt32BE(v, o));
  const alloc = (n) => { const o = free; free += n + (n % 2); return o; };

  tiff.write(le ? 'II' : 'MM', 0, 'ascii');
  u16(2, 42);
  u32(4, 8);

  // entries: [tag, type, count, valueWriter(offsetOrInline)]
  const writeIfd = (entries) => {
    const at = alloc(2 + entries.length * 12 + 4);
    u16(at, entries.length);
    entries.forEach(([tag, type, count, write], i) => {
      const e = at + 2 + i * 12;
      u16(e, tag); u16(e + 2, type); u32(e + 4, count);
      write(e + 8);
    });
    u32(at + 2 + entries.length * 12, 0);
    return at;
  };
  const ascii = (s) => (slot) => {
    if (s.length + 1 <= 4) { tiff.write(s, slot, 'ascii'); return; }
    const o = alloc(s.length + 1); tiff.write(s, o, 'ascii'); u32(slot, o);
  };
  const dms = (deg) => (slot) => {
    const a = Math.abs(deg), d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 60 * 10000);
    const o = alloc(24);
    [[d, 1], [m, 1], [s, 10000]].forEach(([n, den], i) => { u32(o + i * 8, n); u32(o + i * 8 + 4, den); });
    u32(slot, o);
  };
  const ptr = (fn) => (slot) => { u32(slot, 0); pending.push([slot, fn]); };
  const pending = [];

  const ifd0 = [];
  if (lat != null) ifd0.push([0x8825, 4, 1, ptr(() => writeIfd([
    [1, 2, 2, ascii(lat < 0 ? 'S' : 'N')],
    [2, 5, 3, dms(lat)],
    [3, 2, 2, ascii(lng < 0 ? 'W' : 'E')],
    [4, 5, 3, dms(lng)],
  ]))]);
  if (takenAt) {
    const d = new Date(takenAt), p = (n) => String(n).padStart(2, '0');
    const s = `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    ifd0.push([0x8769, 4, 1, ptr(() => writeIfd([[0x9003, 2, 20, ascii(s)]]))]);
  }
  writeIfd(ifd0);
  for (const [slot, fn] of pending) u32(slot, fn());

  const body = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff.subarray(0, free)]);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}

/** Insert an EXIF segment right after the JPEG's SOI marker. */
export function withExif(jpeg, opts) {
  return Buffer.concat([jpeg.subarray(0, 2), makeExifSegment(opts), jpeg.subarray(2)]);
}
