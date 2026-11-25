/*
 * Narrator search: find chapters by number/title and passages by text.
 * Pure functions; runs in the browser (self.Search) and in Node for tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Search = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Case-fold and straighten quotes. Never changes string length, so offsets map back to the original. */
  function fold(s) {
    const lower = String(s).toLowerCase();
    const out = lower.length === s.length ? lower : String(s); // rare chars whose case-fold changes length
    return out.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');
  }

  const words = (q) => fold(q).trim().split(/\s+/).filter(Boolean);

  /**
   * Chapters whose title matches every word of the query. A bare number also
   * matches that chapter's position ("42" -> the 42nd chapter), listed first.
   * Returns chapter indexes.
   */
  function matchChapters(titles, query) {
    const q = String(query || '').trim();
    if (!q) return titles.map((_, i) => i);
    const out = [];
    if (/^\d+$/.test(q)) {
      const n = Number(q) - 1;
      if (n >= 0 && n < titles.length) out.push(n);
    }
    const ws = words(q);
    titles.forEach((t, i) => {
      if (i === out[0]) return;
      const ft = fold(t);
      // Numbers match whole numbers only, so "4" finds "Chapter 4", not "Chapter 14".
      if (ws.every((w) => (/^\d+$/.test(w) ? new RegExp(`(^|\\D)${w}(\\D|$)`).test(ft) : ft.includes(w)))) out.push(i);
    });
    return out;
  }

  /**
   * Full-text search. Returns up to `limit` hits in reading order:
   *   { ch, p, before, match, after }  (before/after are trimmed context for display)
   * Queries shorter than `minLength` characters return nothing (too many hits to be useful).
   * Pass a cache object to reuse folded text across searches of the same book.
   */
  function searchText(chapters, query, opts) {
    const o = Object.assign({ limit: 50, minLength: 3, context: 40, cache: null }, opts);
    const q = fold(String(query || '').trim());
    const hits = [];
    if (q.length < o.minLength) return hits;
    for (let ch = 0; ch < chapters.length && hits.length < o.limit; ch++) {
      const paras = chapters[ch].paras;
      let folded = o.cache && o.cache[ch];
      if (!folded) {
        folded = paras.map(fold);
        if (o.cache) o.cache[ch] = folded;
      }
      for (let p = 0; p < paras.length && hits.length < o.limit; p++) {
        const at = folded[p].indexOf(q);
        if (at < 0) continue;
        hits.push(snippet(paras[p], at, q.length, o.context, ch, p));
      }
    }
    return hits;
  }

  function snippet(text, at, len, ctx, ch, p) {
    let start = Math.max(0, at - ctx);
    let end = Math.min(text.length, at + len + ctx);
    // Don't cut words in half.
    if (start > 0) { const sp = text.indexOf(' ', start); if (sp > -1 && sp < at) start = sp + 1; }
    if (end < text.length) { const sp = text.lastIndexOf(' ', end); if (sp > at + len) end = sp; }
    return {
      ch,
      p,
      before: (start > 0 ? '…' : '') + text.slice(start, at),
      match: text.slice(at, at + len),
      after: text.slice(at + len, end) + (end < text.length ? '…' : ''),
    };
  }

  return { fold, matchChapters, searchText };
});
