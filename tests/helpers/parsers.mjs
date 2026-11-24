// Load app/parsers.js (a UMD script) into Node with jsdom's DOMParser and JSZip.
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);
const Parsers = require('../../app/parsers.js');
Parsers.configure({ DOMParser: new JSDOM('').window.DOMParser, JSZip });

/** Minimal File stand-in: what parseFile() needs. */
export function fakeFile(name, content) {
  const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  return { name, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
}

export default Parsers;
