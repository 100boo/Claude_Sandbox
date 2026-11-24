/*
 * Narrator parsers: turn EPUB / HTML / plain text / Markdown into a book:
 *
 *   { title, author, format, cover: dataURL|null,
 *     chapters: [{ title, paras: [string, ...] }, ...] }
 *
 * Runs in the browser (window.Parsers) and in Node for tests (module.exports).
 * Needs a DOMParser and, for EPUB, JSZip. Both are taken from the global scope
 * unless passed in via Parsers.configure({ DOMParser, JSZip }).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Parsers = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const deps = { DOMParser: null, JSZip: null };
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  const getDOMParser = () => deps.DOMParser || g.DOMParser;
  const getJSZip = () => deps.JSZip || g.JSZip;

  function configure(opts) { Object.assign(deps, opts || {}); }

  // ---------------------------------------------------------------- helpers

  const BLOCK = new Set([
    'p', 'div', 'section', 'article', 'main', 'body', 'blockquote', 'li', 'ul', 'ol',
    'dl', 'dt', 'dd', 'pre', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
    'figure', 'figcaption', 'header', 'footer', 'aside', 'center', 'address', 'details', 'summary',
  ]);
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'math', 'head', 'title', 'nav', 'img', 'video', 'audio', 'iframe', 'button', 'form', 'input', 'select', 'textarea']);
  const HEADING = /^h([1-6])$/;

  function clean(s) {
    return String(s)
      .replace(/[­​‌‍﻿]/g, '') // soft hyphen, zero-width chars
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Text with no letters or digits (e.g. "* * *", "~~~", "———") is a scene break, not speech. */
  function isSpeakable(s) { return /[\p{L}\p{N}]/u.test(s); }

  /**
   * Royal Road inserts hidden "this story was stolen" notices into chapter HTML.
   * They are invisible on the site but show up in saved/converted files.
   */
  const RR_NAME = /royal\s*road|royalroad/i;
  const RR_THEFT = /stolen|steal|taken without|without (the )?(author'?s?'? )?(consent|permission)|unauthori[sz]ed|pirat|misappropriat|report (it|this|the)|lifted|amazon|illicit|infring/i;
  function isAntiPiracyNotice(s) {
    return s.length < 300 && RR_NAME.test(s) && RR_THEFT.test(s);
  }

  function filterParas(paras, opts) {
    const o = Object.assign({ removeNotices: true }, opts);
    return paras.filter((t) => isSpeakable(t) && !(o.removeNotices && isAntiPiracyNotice(t)));
  }

  // ------------------------------------------------------- DOM -> blocks

  /**
   * Walk a DOM subtree and produce a flat list of blocks:
   *   { type: 'h', level: 1-6, text } | { type: 'p', text }
   * Double <br> splits a paragraph (common in sites that don't use <p>).
   */
  function domToBlocks(rootNode) {
    const out = [];
    walk(rootNode, out);
    return out;
  }

  function walk(node, out) {
    let buf = '';
    const flush = () => {
      const t = clean(buf);
      if (t) out.push({ type: 'p', text: t });
      buf = '';
    };
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3 || child.nodeType === 4) { buf += child.nodeValue; continue; }
      if (child.nodeType !== 1) continue;
      const tag = (child.localName || child.nodeName).toLowerCase();
      if (SKIP.has(tag)) continue;
      if (isHidden(child)) continue;
      if (tag === 'br') {
        if (/\n[ \t ]*$/.test(buf)) flush(); else buf += '\n';
        continue;
      }
      if (tag === 'hr') { flush(); continue; }
      const h = HEADING.exec(tag);
      if (h) {
        flush();
        const t = clean(child.textContent);
        if (t) out.push({ type: 'h', level: Number(h[1]), text: t });
        continue;
      }
      if (BLOCK.has(tag) || containsBlock(child)) { flush(); walk(child, out); continue; }
      buf += ' ' + child.textContent + ' ';
    }
    flush();
  }

  function containsBlock(el) {
    for (const c of Array.from(el.children || [])) {
      const t = (c.localName || c.nodeName).toLowerCase();
      if (BLOCK.has(t) || HEADING.test(t)) return true;
    }
    return false;
  }

  function isHidden(el) {
    if (el.hasAttribute && el.hasAttribute('hidden')) return true;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true;
    const st = (el.getAttribute && el.getAttribute('style')) || '';
    return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(st);
  }

  /**
   * Group blocks into chapters. The chapter heading level is the highest-rank
   * heading that appears at least twice (or the only heading, if just one).
   */
  function chapterize(blocks, fallbackTitle, opts) {
    const counts = {};
    for (const b of blocks) if (b.type === 'h') counts[b.level] = (counts[b.level] || 0) + 1;
    const levels = Object.keys(counts).map(Number).sort((a, b) => a - b);
    let split = levels.find((l) => counts[l] >= 2);
    if (split === undefined) split = levels[0];

    const chapters = [];
    let cur = null;
    const start = (title) => { cur = { title, paras: [] }; chapters.push(cur); };

    for (const b of blocks) {
      if (b.type === 'h' && b.level === split) { start(b.text); continue; }
      // Higher-rank headings (book title, "Volume 2") are structure, not narration.
      if (b.type === 'h' && b.level < split) continue;
      if (!cur) start(fallbackTitle || 'Beginning');
      cur.paras.push(b.text);
    }
    return finalizeChapters(chapters, opts);
  }

  function finalizeChapters(chapters, opts) {
    const out = [];
    for (const c of chapters) {
      const paras = filterParas(c.paras, opts);
      if (paras.length) out.push({ title: c.title || `Chapter ${out.length + 1}`, paras });
    }
    return out;
  }

  function parseDoc(text, type) {
    const DP = getDOMParser();
    if (!DP) throw new Error('No DOMParser available');
    const parser = new DP();
    if (type !== 'text/html') {
      const doc = parser.parseFromString(text, type);
      if (!doc.getElementsByTagName('parsererror').length) return doc;
    }
    return parser.parseFromString(text, 'text/html');
  }

  function byLocal(rootNode, name) {
    return Array.from(rootNode.getElementsByTagName('*')).filter((e) => e.localName === name);
  }

  // ------------------------------------------------------------------ HTML

  function parseHtml(html, fallbackTitle, opts) {
    const doc = parseDoc(html, 'text/html');
    const titleEl = doc.querySelector('title');
    const metaAuthor = doc.querySelector('meta[name="author"]');
    const body = doc.body || doc.documentElement;
    const blocks = domToBlocks(body);
    let title = clean(titleEl ? titleEl.textContent : '') || fallbackTitle || 'Untitled';
    const chapters = chapterize(blocks, title, opts);
    return {
      title,
      author: metaAuthor ? clean(metaAuthor.getAttribute('content')) : '',
      format: 'html',
      cover: null,
      chapters,
    };
  }

  // ------------------------------------------------------------ plain text

  const CHAPTER_LINE = /^(?:chapter|ch\.|prologue|epilogue|interlude|part|book|volume|vol\.|side\s*story|afterword|foreword|preface|intermission|bonus)\b.{0,80}$/i;

  function textToBlocks(text) {
    const norm = String(text).replace(/\r\n?/g, '\n');
    const lines = norm.split('\n');
    const nonEmpty = lines.filter((l) => l.trim()).length;
    const blankRuns = (norm.match(/\n[ \t]*\n/g) || []).length;
    // If the file barely uses blank lines, every line is its own paragraph.
    const linePerPara = blankRuns < nonEmpty / 10;

    const blocks = [];
    let buf = [];
    const flush = () => {
      const t = clean(buf.join(' '));
      if (t) blocks.push({ type: 'p', text: t });
      buf = [];
    };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { flush(); continue; }
      if (line.length <= 100 && CHAPTER_LINE.test(line)) {
        flush();
        blocks.push({ type: 'h', level: 1, text: clean(line) });
        continue;
      }
      buf.push(line);
      if (linePerPara) flush();
    }
    flush();
    return blocks;
  }

  function parseText(text, fallbackTitle, opts) {
    const blocks = textToBlocks(text);
    const title = fallbackTitle || 'Untitled';
    return { title, author: '', format: 'txt', cover: null, chapters: chapterize(blocks, title, opts) };
  }

  // -------------------------------------------------------------- Markdown

  function stripInlineMd(s) {
    return s
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')          // images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')      // links
      .replace(/`([^`]*)`/g, '$1')                  // code
      .replace(/(\*\*|__)(.*?)\1/g, '$2')           // bold
      .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?!\w)/g, '$1$2') // italics
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/<[^>]+>/g, '');
  }

  function parseMarkdown(md, fallbackTitle, opts) {
    const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let buf = [];
    let inFence = false;
    const flush = () => {
      const t = clean(stripInlineMd(buf.join(' ')));
      if (t) blocks.push({ type: 'p', text: t });
      buf = [];
    };
    for (const raw of lines) {
      if (/^\s*(```|~~~)/.test(raw)) { flush(); inFence = !inFence; continue; }
      if (inFence) continue;
      const line = raw.trim();
      const h = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
      if (h) { flush(); blocks.push({ type: 'h', level: h[1].length, text: clean(stripInlineMd(h[2])) }); continue; }
      if (!line || /^([-*_]\s*){3,}$/.test(line)) { flush(); continue; }
      const item = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (item) { flush(); buf.push(item[1]); flush(); continue; }
      buf.push(line.replace(/^>\s?/, ''));
    }
    flush();
    let title = fallbackTitle || 'Untitled';
    const h1s = blocks.filter((b) => b.type === 'h' && b.level === 1);
    if (h1s.length === 1 && blocks.some((b) => b.type === 'h' && b.level > 1)) {
      // A single H1 is the book title; chapters are the next level down.
      title = h1s[0].text;
      blocks.splice(blocks.indexOf(h1s[0]), 1);
    }
    return { title, author: '', format: 'md', cover: null, chapters: chapterize(blocks, title, opts) };
  }

  // ------------------------------------------------------------------ EPUB

  function resolvePath(base, href) {
    let path = href.split('#')[0];
    try { path = decodeURIComponent(path); } catch (e) { /* keep as-is */ }
    if (path.startsWith('/')) return path.slice(1);
    const parts = base ? base.split('/') : [];
    for (const seg of path.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '.' && seg !== '') parts.push(seg);
    }
    return parts.join('/');
  }
  const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

  function zipFile(zip, path) {
    return zip.file(path) || zip.file(new RegExp('^' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'))[0] || null;
  }

  async function parseEpub(data, fallbackTitle, opts) {
    const JSZip = getJSZip();
    if (!JSZip) throw new Error('JSZip is not loaded');
    const zip = await JSZip.loadAsync(data);

    const containerFile = zipFile(zip, 'META-INF/container.xml');
    if (!containerFile) throw new Error('Not a valid EPUB (missing META-INF/container.xml)');
    const container = parseDoc(await containerFile.async('string'), 'application/xml');
    const rootfile = byLocal(container, 'rootfile')[0];
    if (!rootfile) throw new Error('Not a valid EPUB (no rootfile)');
    const opfPath = rootfile.getAttribute('full-path');
    const opfDir = dirOf(opfPath);
    const opfFile = zipFile(zip, opfPath);
    if (!opfFile) throw new Error('Not a valid EPUB (missing package file)');
    const opf = parseDoc(await opfFile.async('string'), 'application/xml');

    const title = clean((byLocal(opf, 'title')[0] || {}).textContent || '') || fallbackTitle || 'Untitled';
    const author = clean((byLocal(opf, 'creator')[0] || {}).textContent || '');

    const manifest = {};
    for (const item of byLocal(opf, 'item')) {
      manifest[item.getAttribute('id')] = {
        href: resolvePath(opfDir, item.getAttribute('href') || ''),
        type: item.getAttribute('media-type') || '',
        props: item.getAttribute('properties') || '',
      };
    }

    // Table of contents: map document path -> label (first entry wins).
    const tocTitles = await readToc(zip, opf, manifest);

    const chapters = [];
    const spine = byLocal(opf, 'itemref');
    for (const ref of spine) {
      const item = manifest[ref.getAttribute('idref')];
      if (!item || !/x?html|xml/i.test(item.type || 'xhtml')) continue;
      if (/\bnav\b/.test(item.props)) continue;
      const f = zipFile(zip, item.href);
      if (!f) continue;
      const doc = parseDoc(await f.async('string'), 'application/xhtml+xml');
      const body = doc.body || byLocal(doc, 'body')[0] || doc.documentElement;
      const blocks = domToBlocks(body);
      const tocTitle = tocTitles[item.href];
      const sub = chapterize(blocks, tocTitle || '', opts);
      if (sub.length > 1 && !tocTitle) { chapters.push(...sub); continue; }

      // One chapter per spine document (the Royal Road norm).
      const paras = [];
      let heading = '';
      for (const b of blocks) {
        if (b.type === 'h' && !heading && paras.length === 0) { heading = b.text; continue; }
        paras.push(b.text);
      }
      const chTitle = tocTitle || heading || '';
      // If the TOC title differs from the first heading, keep the heading as text.
      if (heading && tocTitle && clean(heading).toLowerCase() !== clean(tocTitle).toLowerCase()) paras.unshift(heading);
      chapters.push({ title: chTitle, paras });
    }

    return {
      title,
      author,
      format: 'epub',
      cover: await readCover(zip, opf, manifest),
      chapters: finalizeChapters(chapters, opts),
    };
  }

  async function readToc(zip, opf, manifest) {
    const titles = {};
    const add = (href, label) => {
      const key = href.split('#')[0];
      const t = clean(label);
      if (key && t && !titles[key]) titles[key] = t;
    };
    const items = Object.values(manifest);
    const nav = items.find((i) => /\bnav\b/.test(i.props));
    if (nav) {
      const f = zipFile(zip, nav.href);
      if (f) {
        const doc = parseDoc(await f.async('string'), 'application/xhtml+xml');
        const navs = byLocal(doc, 'nav');
        const toc = navs.find((n) => /toc/.test(n.getAttribute('epub:type') || n.getAttribute('type') || '')) || navs[0];
        if (toc) for (const a of byLocal(toc, 'a')) add(resolvePath(dirOf(nav.href), a.getAttribute('href') || ''), a.textContent);
      }
    }
    if (Object.keys(titles).length) return titles;

    const spineEl = byLocal(opf, 'spine')[0];
    const ncxId = spineEl && spineEl.getAttribute('toc');
    const ncx = (ncxId && manifest[ncxId]) || items.find((i) => /ncx/.test(i.type));
    if (ncx) {
      const f = zipFile(zip, ncx.href);
      if (f) {
        const doc = parseDoc(await f.async('string'), 'application/xml');
        for (const np of byLocal(doc, 'navPoint')) {
          const label = byLocal(np, 'text')[0];
          const content = byLocal(np, 'content')[0];
          if (label && content) add(resolvePath(dirOf(ncx.href), content.getAttribute('src') || ''), label.textContent);
        }
      }
    }
    return titles;
  }

  async function readCover(zip, opf, manifest) {
    try {
      let item = Object.values(manifest).find((i) => /cover-image/.test(i.props));
      if (!item) {
        const meta = byLocal(opf, 'meta').find((m) => m.getAttribute('name') === 'cover');
        if (meta) item = manifest[meta.getAttribute('content')];
      }
      if (!item || !/^image\//.test(item.type)) return null;
      const f = zipFile(zip, item.href);
      if (!f) return null;
      const b64 = await f.async('base64');
      if (b64.length > 1.5 * 1024 * 1024) return null; // keep the library light
      return `data:${item.type};base64,${b64}`;
    } catch (e) {
      return null;
    }
  }

  // ------------------------------------------------------------ dispatch

  function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }
  function baseName(name) {
    return (name || 'Untitled').replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim() || 'Untitled';
  }

  /** file: anything with .name and .arrayBuffer() (a browser File, or a test stub). */
  async function parseFile(file, opts) {
    const ext = extOf(file.name);
    const title = baseName(file.name);
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (ext === 'epub' || isZip) return parseEpub(buf, title, opts);

    const text = new TextDecoder('utf-8').decode(bytes);
    if (ext === 'md' || ext === 'markdown') return parseMarkdown(text, title, opts);
    if (['html', 'htm', 'xhtml'].includes(ext) || /^\s*(<!doctype html|<html|<\?xml)/i.test(text)) {
      return parseHtml(text, title, opts);
    }
    return parseText(text, title, opts);
  }

  // ------------------------------------------------------ speech chunking

  /**
   * Split a paragraph into chunks small enough for speechSynthesis to handle
   * reliably (some engines cut off or stall on long utterances).
   */
  function splitForSpeech(text, maxLen) {
    const max = maxLen || 280;
    if (text.length <= max) return [text];
    const sentences = text.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g) || [text];
    const chunks = [];
    let cur = '';
    const push = () => { if (cur.trim()) chunks.push(cur.trim()); cur = ''; };
    for (const s of sentences) {
      if (s.length > max) {
        push();
        for (const piece of splitLong(s, max)) chunks.push(piece);
        continue;
      }
      if ((cur + s).length > max) push();
      cur += s;
    }
    push();
    return chunks;
  }

  function splitLong(s, max) {
    const out = [];
    let rest = s.trim();
    while (rest.length > max) {
      const lim = max - 1; // cut char is kept, so the chunk is at most `max` long
      let cut = Math.max(rest.lastIndexOf(', ', lim), rest.lastIndexOf('; ', lim), rest.lastIndexOf(' — ', lim));
      if (cut < max / 3) cut = rest.lastIndexOf(' ', lim);
      if (cut <= 0) cut = max;
      out.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) out.push(rest);
    return out;
  }

  return {
    configure,
    parseFile,
    parseEpub,
    parseHtml,
    parseText,
    parseMarkdown,
    splitForSpeech,
    isAntiPiracyNotice,
    // exported for tests
    _internal: { domToBlocks, chapterize, textToBlocks, resolvePath, clean },
  };
});
