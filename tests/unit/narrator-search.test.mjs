import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const Search = createRequire(import.meta.url)('../../apps/narrator/search.js');

const titles = ['Prologue', 'Chapter 1 - The Map That Moved', 'Chapter 2 - Ink and Salt', 'Interlude: Ostrel',
  'Chapter 14 - Tides', 'Chapter 4 - Two Cartographers'];

test('empty query lists every chapter in order', () => {
  assert.deepEqual(Search.matchChapters(titles, '  '), [0, 1, 2, 3, 4, 5]);
});

test('a number jumps to that position first, then titles with that exact number', () => {
  // position 4 is "Interlude: Ostrel"; "Chapter 4" title also matches; "Chapter 14" does not
  assert.deepEqual(Search.matchChapters(titles, '4'), [3, 5]);
  assert.deepEqual(Search.matchChapters(titles, '99'), []);
});

test('words match titles case-insensitively, all words required', () => {
  assert.deepEqual(Search.matchChapters(titles, 'ink'), [2]);
  assert.deepEqual(Search.matchChapters(titles, 'chapter map'), [1]);
  assert.deepEqual(Search.matchChapters(titles, 'CHAPTER 2'), [2]);
});

const chapters = [
  { title: 'A', paras: ['The lantern flickered.', 'Wren didn’t trust the coastline at all, not one bit, not after everything that had happened on the road.'] },
  { title: 'B', paras: ['Nothing here.', 'Another LANTERN, identical to hers.'] },
];

test('text search finds every hit in reading order with context', () => {
  const hits = Search.searchText(chapters, 'lantern');
  assert.deepEqual(hits.map((h) => [h.ch, h.p]), [[0, 0], [1, 1]]);
  assert.equal(hits[1].match, 'LANTERN'); // original casing is kept for display
  assert.equal(hits[1].before + hits[1].match + hits[1].after, 'Another LANTERN, identical to hers.');
});

test('straight quotes match curly ones', () => {
  const [h] = Search.searchText(chapters, "didn't trust");
  assert.equal(h.match, 'didn’t trust');
});

test('long paragraphs are trimmed around the match at word boundaries', () => {
  const [h] = Search.searchText(chapters, 'everything', { context: 15 });
  assert.match(h.before, /^…\S/);
  assert.match(h.after, /\S…$/);
  assert.ok(!h.before.slice(1).startsWith(' '));
});

test('short queries and limits', () => {
  assert.deepEqual(Search.searchText(chapters, 'la'), []);
  assert.equal(Search.searchText(chapters, 'the', { limit: 1 }).length, 1);
});

test('cache is filled and reused', () => {
  const cache = [];
  Search.searchText(chapters, 'lantern', { cache });
  assert.equal(cache.length, 2);
  cache[1] = ['nothing here.', 'cached text only'];
  assert.deepEqual(Search.searchText(chapters, 'lantern', { cache }).map((h) => h.ch), [0]);
});
