/* Grove pure helpers: distances, place grouping, stats and EXIF GPS reading.
   UMD-style: attaches to `self` in the browser, module.exports in Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Geo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const R = 6371008.8; // mean Earth radius, metres
  const rad = (d) => (d * Math.PI) / 180;

  /** Great-circle distance in metres between {lat, lng} points. */
  function distance(a, b) {
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /**
   * Group entries into "places": an entry joins the first place whose centre
   * is within `radius` metres, otherwise it starts a new place. Oldest first,
   * so a place's centre is where you first logged something there.
   */
  function groupPlaces(entries, radius = 150) {
    const sorted = [...entries].sort((a, b) => a.createdAt - b.createdAt);
    const places = [];
    for (const e of sorted) {
      const hit = places.find((p) => distance(p, e) <= radius);
      if (hit) hit.entries.push(e);
      else places.push({ lat: e.lat, lng: e.lng, entries: [e] });
    }
    return places;
  }

  const normSpecies = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  /** Summary numbers for the header. */
  function stats(entries, radius = 150) {
    const trees = entries.filter((e) => (e.photoCount || 0) > 0 || normSpecies(e.species)).length;
    const species = new Set(entries.map((e) => normSpecies(e.species)).filter(Boolean)).size;
    const places = groupPlaces(entries, radius).length;
    let spanKm = 0;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) spanKm = Math.max(spanKm, distance(entries[i], entries[j]) / 1000);
    }
    return { entries: entries.length, trees, species, places, spanKm };
  }

  /** Previously used species names, most frequent first, original casing of the latest use. */
  function speciesList(entries) {
    const counts = new Map();
    for (const e of [...entries].sort((a, b) => a.createdAt - b.createdAt)) {
      const k = normSpecies(e.species);
      if (!k) continue;
      const c = counts.get(k) || { name: e.species.trim(), n: 0 };
      c.name = e.species.trim();
      c.n++;
      counts.set(k, c);
    }
    return [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map((c) => c.name);
  }

  function formatCoord(lat, lng) {
    const f = (v, pos, neg) => `${Math.abs(v).toFixed(5)}°${v >= 0 ? pos : neg}`;
    return `${f(lat, 'N', 'S')} ${f(lng, 'E', 'W')}`;
  }

  function validLatLng(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  }

  /**
   * Read GPS position and capture time from a JPEG's EXIF block.
   * Returns { lat, lng, takenAt } (any may be missing) or null if there is no EXIF.
   */
  function readExif(buffer) {
    const v = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 <= v.byteLength) {
      const marker = v.getUint16(off);
      if ((marker & 0xff00) !== 0xff00) return null;
      const len = v.getUint16(off + 2);
      if (marker === 0xffe1 && off + 10 <= v.byteLength && v.getUint32(off + 4) === 0x45786966 /* Exif */) {
        try { return parseTiff(v, off + 10); } catch { return null; }
      }
      if (marker === 0xffda) return null; // start of scan: no more metadata
      off += 2 + len;
    }
    return null;
  }

  function parseTiff(v, base) {
    const order = v.getUint16(base);
    if (order !== 0x4949 && order !== 0x4d4d) return null;
    const le = order === 0x4949;
    const u16 = (o) => v.getUint16(base + o, le);
    const u32 = (o) => v.getUint32(base + o, le);
    const readIfd = (o) => {
      const tags = {};
      const n = u16(o);
      for (let i = 0; i < n; i++) {
        const e = o + 2 + i * 12;
        const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
        const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] || 1;
        const dataOff = size * count > 4 ? u32(e + 8) : e + 8;
        tags[tag] = { type, count, off: dataOff };
      }
      return tags;
    };
    const ascii = (t) => {
      let s = '';
      for (let i = 0; i < t.count; i++) {
        const c = v.getUint8(base + t.off + i);
        if (!c) break;
        s += String.fromCharCode(c);
      }
      return s;
    };
    const rationals = (t) => Array.from({ length: t.count }, (_, i) => {
      const d = u32(t.off + i * 8 + 4);
      return d ? u32(t.off + i * 8) / d : 0;
    });

    const out = {};
    const ifd0 = readIfd(u32(4));
    if (ifd0[0x8825]) {
      const gps = readIfd(u32(ifd0[0x8825].off));
      if (gps[2] && gps[4]) {
        const dms = (t) => { const [d = 0, m = 0, s = 0] = rationals(t); return d + m / 60 + s / 3600; };
        let lat = dms(gps[2]), lng = dms(gps[4]);
        if (gps[1] && ascii(gps[1]).toUpperCase() === 'S') lat = -lat;
        if (gps[3] && ascii(gps[3]).toUpperCase() === 'W') lng = -lng;
        if (validLatLng(lat, lng)) { out.lat = lat; out.lng = lng; }
      }
    }
    const exifPtr = ifd0[0x8769];
    const dateTag = exifPtr && readIfd(u32(exifPtr.off))[0x9003] || ifd0[0x0132];
    if (dateTag) {
      const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(ascii(dateTag));
      if (m) {
        const t = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(); // EXIF time is local
        if (Number.isFinite(t)) out.takenAt = t;
      }
    }
    return out;
  }

  return { distance, groupPlaces, stats, speciesList, normSpecies, formatCoord, validLatLng, readExif };
});
