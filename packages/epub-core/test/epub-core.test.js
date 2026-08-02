import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { readEpub, validateEpub, verifyEpubMetadata, writeEpub } from '../src/index.js';

function fixture() {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.addFile('META-INF/container.xml', Buffer.from(`<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`));
  zip.addFile('OEBPS/cover.jpg', Buffer.from([1, 2, 3, 4]));
  zip.addFile('OEBPS/chapter.xhtml', Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><body>Hello</body></html>'));
  zip.addFile('OEBPS/content.opf', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">9780307351937</dc:identifier>
    <dc:title>Old title</dc:title>
    <dc:creator>Old Author</dc:creator>
    <dc:language>en</dc:language>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`));
  return zip.toBuffer();
}

test('reads embedded EPUB metadata and cover', () => {
  const book = readEpub(fixture());
  assert.equal(book.metadata.title, 'Old title');
  assert.deepEqual(book.metadata.authors, ['Old Author']);
  assert.equal(book.metadata.isbn, '9780307351937');
  assert.equal(book.cover.path, 'OEBPS/cover.jpg');
  assert.deepEqual([...book.cover.bytes], [1, 2, 3, 4]);
});

test('rewrites metadata and verifies the round trip', () => {
  const patch = {
    title: 'World War Z',
    authors: ['Max Brooks'],
    language: 'en',
    publisher: 'Crown',
    description: 'An oral history.',
    tags: ['Horror', 'Zombies', 'Horror'],
    isbn: '9780307351937',
    series: 'World War Z',
    seriesIndex: 1,
  };
  const output = writeEpub(fixture(), patch, { cover: { bytes: Buffer.from([9, 8, 7]) } });
  const verification = verifyEpubMetadata(output, patch);
  assert.equal(verification.valid, true, JSON.stringify(verification.mismatches));
  assert.deepEqual(readEpub(output).metadata.subjects, ['Horror', 'Zombies']);
  assert.deepEqual([...readEpub(output).cover.bytes], [9, 8, 7]);
});

test('reports invalid EPUBs instead of exploding mysteriously', () => {
  const result = validateEpub(Buffer.from('not a zip'));
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});
