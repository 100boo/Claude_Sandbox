// Build small EPUB files in memory for tests, shaped like Royal Road exports
// (one chapter per XHTML file, EPUB 3 nav + EPUB 2 NCX).
import JSZip from 'jszip';

export async function makeEpub({
  title = 'Test Story',
  author = 'Test Author',
  chapters = [{ title: 'Chapter 1', paras: ['Hello world.'] }],
  nav = true,
  ncx = true,
  extraBodyHtml = () => '',
  headingInBody = true,
} = {}) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);

  const items = chapters.map((c, i) => ({ id: `ch${i + 1}`, href: `text/chapter ${i + 1}.xhtml`, ...c }));
  for (const [i, c] of items.entries()) {
    const body = (headingInBody ? `<h1>${esc(c.title)}</h1>` : '') + c.paras.map((p) => `<p>${esc(p)}</p>`).join('\n') + extraBodyHtml(i);
    zip.file(`OEBPS/${c.href}`, `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${esc(c.title)}</title></head>
<body>${body}</body></html>`);
  }
  if (nav) {
    zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>TOC</title></head>
<body><nav epub:type="toc"><ol>${items.map((c) => `<li><a href="${encodeURI(c.href)}">${esc(c.title)}</a></li>`).join('')}</ol></nav></body></html>`);
  }
  if (ncx) {
    zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>
${items.map((c, i) => `<navPoint id="np${i}" playOrder="${i + 1}"><navLabel><text>${esc(c.title)}</text></navLabel><content src="${encodeURI(c.href)}"/></navPoint>`).join('\n')}
</navMap></ncx>`);
  }
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">test</dc:identifier>
    <dc:title>${esc(title)}</dc:title>
    <dc:creator>${esc(author)}</dc:creator>
  </metadata>
  <manifest>
    ${nav ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : ''}
    ${ncx ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : ''}
    ${items.map((c) => `<item id="${c.id}" href="${encodeURI(c.href)}" media-type="application/xhtml+xml"/>`).join('\n    ')}
  </manifest>
  <spine${ncx ? ' toc="ncx"' : ''}>
    ${items.map((c) => `<itemref idref="${c.id}"/>`).join('\n    ')}
  </spine>
</package>`);
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
