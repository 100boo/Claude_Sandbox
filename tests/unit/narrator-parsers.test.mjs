import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Parsers, { fakeFile } from '../helpers/parsers.mjs';
import { makeEpub } from '../helpers/epub.mjs';

const titles = (book) => book.chapters.map((c) => c.title);

describe('EPUB', () => {
  test('one chapter per spine document, titles from the TOC', async () => {
    const data = await makeEpub({
      title: 'Dungeon Core Online',
      author: 'Someone',
      chapters: [
        { title: 'Chapter 1 - Awakening', paras: ['The core woke.', 'It was dark.'] },
        { title: 'Chapter 2 - First Blood', paras: ['A rat wandered in.'] },
      ],
    });
    const book = await Parsers.parseFile(fakeFile('dco.epub', data));
    assert.equal(book.format, 'epub');
    assert.equal(book.title, 'Dungeon Core Online');
    assert.equal(book.author, 'Someone');
    assert.deepEqual(titles(book), ['Chapter 1 - Awakening', 'Chapter 2 - First Blood']);
    // The in-body <h1> duplicates the TOC title, so it is not repeated as a paragraph.
    assert.deepEqual(book.chapters[0].paras, ['The core woke.', 'It was dark.']);
  });

  test('falls back to NCX, then to the first heading', async () => {
    const ncxOnly = await makeEpub({ nav: false, chapters: [{ title: 'From NCX', paras: ['x'] }] });
    assert.deepEqual(titles(await Parsers.parseFile(fakeFile('a.epub', ncxOnly))), ['From NCX']);

    const noToc = await makeEpub({ nav: false, ncx: false, chapters: [{ title: 'From Heading', paras: ['x'] }] });
    const book = await Parsers.parseFile(fakeFile('b.epub', noToc));
    assert.deepEqual(titles(book), ['From Heading']);
    assert.deepEqual(book.chapters[0].paras, ['x']);
  });

  test('handles entities like &nbsp; that are invalid in strict XHTML', async () => {
    const data = await makeEpub({
      chapters: [{ title: 'C1', paras: ['plain'] }],
      extraBodyHtml: () => '<p>Hello&nbsp;there &mdash; friend</p>',
    });
    const book = await Parsers.parseFile(fakeFile('c.epub', data));
    assert.equal(book.chapters[0].paras[1], 'Hello there — friend');
  });

  test('drops Royal Road anti-piracy notices and scene-break glyphs', async () => {
    const data = await makeEpub({
      chapters: [{ title: 'C1', paras: ['Real text.', '* * *', 'More text.'] }],
      extraBodyHtml: () => '<p>This narrative has been unlawfully taken from Royal Road. If you spot it on Amazon, please report it.</p>',
    });
    const book = await Parsers.parseFile(fakeFile('d.epub', data));
    assert.deepEqual(book.chapters[0].paras, ['Real text.', 'More text.']);

    const kept = await Parsers.parseFile(fakeFile('d.epub', data), { removeNotices: false });
    assert.equal(kept.chapters[0].paras.length, 3);
  });

  test('detects EPUB by zip signature even with the wrong extension', async () => {
    const data = await makeEpub();
    const book = await Parsers.parseFile(fakeFile('download.bin', data));
    assert.equal(book.format, 'epub');
  });

  test('rejects zips that are not EPUBs', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('readme.txt', 'hi');
    const data = await zip.generateAsync({ type: 'nodebuffer' });
    await assert.rejects(Parsers.parseFile(fakeFile('x.epub', data)), /Not a valid EPUB/);
  });
});

describe('HTML', () => {
  test('splits chapters on the repeated heading level', () => {
    const html = `<html><head><title>My Story</title><meta name="author" content="Writer"></head><body>
      <h1>My Story</h1>
      <h2>Chapter 1</h2><p>One.</p><p>Two.</p>
      <h2>Chapter 2</h2><div class="chapter-content"><p>Three.</p><h3>A scene</h3><p>Four.</p></div>
      <script>evil()</script><p style="display:none">hidden</p>
    </body></html>`;
    const book = Parsers.parseHtml(html, 'fallback');
    assert.equal(book.title, 'My Story');
    assert.equal(book.author, 'Writer');
    assert.deepEqual(titles(book), ['Chapter 1', 'Chapter 2']);
    assert.deepEqual(book.chapters[1].paras, ['Three.', 'A scene', 'Four.']);
  });

  test('treats double <br> as a paragraph break', () => {
    const book = Parsers.parseHtml('<body><div>Line one<br>still one<br><br>Line two</div></body>', 'T');
    assert.deepEqual(book.chapters[0].paras, ['Line one still one', 'Line two']);
  });
});

describe('plain text', () => {
  test('detects chapter lines and blank-line paragraphs', () => {
    const txt = 'Prologue\n\nIt began.\nSame paragraph.\n\nChapter 1: Start\n\nFirst.\n\nSecond.\n\nChapter 2\n\nThird.';
    const book = Parsers.parseText(txt, 'Story');
    assert.deepEqual(titles(book), ['Prologue', 'Chapter 1: Start', 'Chapter 2']);
    assert.deepEqual(book.chapters[0].paras, ['It began. Same paragraph.']);
    assert.deepEqual(book.chapters[1].paras, ['First.', 'Second.']);
  });

  test('one paragraph per line when the file has no blank lines', () => {
    const book = Parsers.parseText('a line\nanother line\na third line', 'T');
    assert.deepEqual(book.chapters[0].paras, ['a line', 'another line', 'a third line']);
    assert.equal(book.chapters[0].title, 'T');
  });

  test('does not mistake prose starting with "Part" for a chapter when it is long', () => {
    const long = 'Part of him wanted to run, but the rest of him knew the dungeon would follow wherever he went, forever and ever and ever.';
    const book = Parsers.parseText(`Chapter 1\n\n${long}`, 'T');
    assert.deepEqual(book.chapters[0].paras, [long]);
  });

  test('handles CRLF and BOM', async () => {
    const book = await Parsers.parseFile(fakeFile('x.txt', '﻿Chapter 1\r\n\r\nHi there.\r\n'));
    assert.deepEqual(titles(book), ['Chapter 1']);
    assert.deepEqual(book.chapters[0].paras, ['Hi there.']);
  });
});

describe('Markdown', () => {
  test('single H1 is the title, H2s are chapters, inline syntax is stripped', () => {
    const md = '# The Book\n\n## One\n\nSome **bold** and _italic_ and [a link](http://x).\n\n- item a\n- item b\n\n## Two\n\n```\ncode is skipped\n```\nDone.';
    const book = Parsers.parseMarkdown(md, 'file');
    assert.equal(book.title, 'The Book');
    assert.deepEqual(titles(book), ['One', 'Two']);
    assert.deepEqual(book.chapters[0].paras, ['Some bold and italic and a link.', 'item a', 'item b']);
    assert.deepEqual(book.chapters[1].paras, ['Done.']);
  });
});

describe('splitForSpeech', () => {
  test('short text is one chunk', () => {
    assert.deepEqual(Parsers.splitForSpeech('Hi.'), ['Hi.']);
  });

  test('long text splits on sentences and never exceeds the limit', () => {
    const s = 'This is a sentence that goes on for a while. '.repeat(30);
    const chunks = Parsers.splitForSpeech(s, 120);
    assert.ok(chunks.length > 5);
    for (const c of chunks) assert.ok(c.length <= 120, `chunk too long: ${c.length}`);
    assert.equal(chunks.join(' ').replace(/\s+/g, ' '), s.trim().replace(/\s+/g, ' '));
  });

  test('a single huge sentence is split on commas/spaces', () => {
    const s = Array.from({ length: 80 }, (_, i) => `word${i}`).join(', ');
    const chunks = Parsers.splitForSpeech(s, 100);
    for (const c of chunks) assert.ok(c.length <= 100);
    assert.equal(chunks.join(' ').replace(/\s+/g, ' '), s);
  });
});

describe('helpers', () => {
  test('resolvePath handles ../ and URL encoding', () => {
    const { resolvePath } = Parsers._internal;
    assert.equal(resolvePath('OEBPS/text', '../images/a%20b.png#x'), 'OEBPS/images/a b.png');
    assert.equal(resolvePath('', 'chapter.xhtml'), 'chapter.xhtml');
  });

  test('anti-piracy detection is narrow', () => {
    assert.ok(Parsers.isAntiPiracyNotice('Stolen from Royal Road. Please report.'));
    assert.ok(Parsers.isAntiPiracyNotice('The story has been taken without consent; if you see it on Amazon, report it to royalroad.'));
    assert.ok(!Parsers.isAntiPiracyNotice('He logged on to Royal Road to read.'));
    assert.ok(!Parsers.isAntiPiracyNotice('The thief stole the royal crown on the road home.'));
  });
});
