import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeExifSegment, withExif } from '../helpers/exif.mjs';

const Geo = createRequire(import.meta.url)('../../trees/geo.js');

// SOI + EOI: enough of a "JPEG" for the metadata reader.
const BARE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('distance: known pairs', () => {
  assert.equal(Geo.distance({ lat: 10, lng: 10 }, { lat: 10, lng: 10 }), 0);
  near(Geo.distance({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) / 1000, 111.195, 0.01); // one degree of latitude
  near(Geo.distance({ lat: 51.5007, lng: -0.1246 }, { lat: 48.8584, lng: 2.2945 }) / 1000, 340.6, 1); // two landmarks
});

test('groupPlaces: nearby entries share a place, far ones do not', () => {
  const e = (id, lat, lng, t) => ({ id, lat, lng, createdAt: t });
  const places = Geo.groupPlaces([
    e('a', 45, 7, 1),
    e('b', 45.0005, 7, 2), // ~55 m north of a
    e('c', 45.01, 7, 3), // ~1.1 km
  ], 150);
  assert.equal(places.length, 2);
  assert.deepEqual(places[0].entries.map((x) => x.id), ['a', 'b']);
  assert.equal(Geo.groupPlaces([e('a', 45, 7, 1), e('c', 45.01, 7, 2)], 2000).length, 1);
});

test('stats: trees need a photo or a name, species are case-insensitive', () => {
  const s = Geo.stats([
    { lat: 45, lng: 7, createdAt: 1, species: 'Oak', photoCount: 1 },
    { lat: 45.0001, lng: 7, createdAt: 2, species: '  oak ', photoCount: 0 },
    { lat: 46, lng: 7, createdAt: 3, species: 'Birch', photoCount: 2 },
    { lat: 46.0001, lng: 7, createdAt: 4, species: '', photoCount: 0 }, // just a visit
  ]);
  assert.equal(s.entries, 4);
  assert.equal(s.trees, 3);
  assert.equal(s.species, 2);
  assert.equal(s.places, 2);
  near(s.spanKm, 111.2, 0.2);
  assert.deepEqual(Geo.stats([]), { entries: 0, trees: 0, species: 0, places: 0, spanKm: 0 });
});

test('speciesList: most used first, latest spelling wins', () => {
  const list = Geo.speciesList([
    { species: 'birch', createdAt: 1 },
    { species: 'Oak', createdAt: 2 },
    { species: 'oak', createdAt: 3 },
    { species: 'Oak', createdAt: 4 },
    { species: '', createdAt: 5 },
  ]);
  assert.deepEqual(list, ['Oak', 'birch']);
});

test('formatCoord and validLatLng', () => {
  assert.equal(Geo.formatCoord(51.5, -0.12), '51.50000°N 0.12000°W');
  assert.equal(Geo.formatCoord(-33.85, 151.2), '33.85000°S 151.20000°E');
  assert.ok(Geo.validLatLng(1, 2));
  assert.ok(!Geo.validLatLng(91, 0));
  assert.ok(!Geo.validLatLng(0, 0), 'null island is a missing fix, not a place');
  assert.ok(!Geo.validLatLng(NaN, 1));
});

test('readExif: GPS and capture time, little-endian', () => {
  const takenAt = new Date(2026, 4, 17, 9, 30, 5).getTime();
  const out = Geo.readExif(withExif(BARE_JPEG, { lat: 47.6205, lng: -122.3493, takenAt }));
  near(out.lat, 47.6205);
  near(out.lng, -122.3493);
  assert.equal(out.takenAt, takenAt);
});

test('readExif: big-endian and southern/eastern hemispheres', () => {
  const out = Geo.readExif(withExif(BARE_JPEG, { lat: -33.8568, lng: 151.2153, littleEndian: false }));
  near(out.lat, -33.8568);
  near(out.lng, 151.2153);
  assert.equal(out.takenAt, undefined);
});

test('readExif: date only, no EXIF, not a JPEG, truncated', () => {
  assert.deepEqual(Object.keys(Geo.readExif(withExif(BARE_JPEG, { takenAt: Date.now() }))), ['takenAt']);
  assert.equal(Geo.readExif(BARE_JPEG), null);
  assert.equal(Geo.readExif(Buffer.from('not an image at all')), null);
  const seg = makeExifSegment({ lat: 1, lng: 2 });
  assert.equal(Geo.readExif(Buffer.concat([BARE_JPEG.subarray(0, 2), seg.subarray(0, 20)])), null);
  assert.equal(Geo.readExif(new ArrayBuffer(0)), null);
});
