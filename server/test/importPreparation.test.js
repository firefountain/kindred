import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { readEpub } from '@kindred/epub-core';
import { matchReviewedMetadata, prepareReviewedBook } from '../src/importPreparation.js';

function epubFixture() {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.addFile('META-INF/container.xml', Buffer.from(`<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`));
  zip.addFile('OEBPS/chapter.xhtml', Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><body>Hello</body></html>'));
  zip.addFile('OEBPS/content.opf', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">9780307351937</dc:identifier>
    <dc:title>Old title</dc:title>
    <dc:creator>Old Author</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`));
  return zip.toBuffer();
}

test('rewrites and verifies reviewed EPUB metadata before upload', () => {
  const result = prepareReviewedBook({
    fileName: 'book.epub',
    extension: '.epub',
    buffer: epubFixture(),
    sha256: 'original-hash',
  }, {
    title: 'World War Z',
    authors: ['Max Brooks'],
    publisher: 'Crown',
    language: 'en',
    tags: ['Horror'],
  });

  assert.equal(result.writeback.attempted, true);
  assert.equal(result.writeback.verified, true);
  assert.equal(readEpub(result.uploadBuffer).metadata.title, 'World War Z');
  assert.deepEqual(readEpub(result.uploadBuffer).metadata.authors, ['Max Brooks']);
  assert.notEqual(result.writeback.originalSha256, result.writeback.writtenSha256);
});

test('passes non-EPUB formats through unchanged', () => {
  const bytes = Buffer.from('azw3');
  const result = prepareReviewedBook({
    fileName: 'book.azw3',
    extension: '.azw3',
    buffer: bytes,
  }, { title: 'Ignored' });

  assert.equal(result.writeback.attempted, false);
  assert.deepEqual(result.uploadBuffer, bytes);
});

test('matches reviewed metadata by hash before archive origin', () => {
  const books = [{
    fileName: 'book.epub',
    archiveName: 'library.zip',
    archivePath: 'folder/book.epub',
    sha256: 'abc',
  }];
  const matches = matchReviewedMetadata(books, [
    { sha256: 'abc', title: 'Hash match' },
    { archiveName: 'library.zip', archivePath: 'folder/book.epub', title: 'Origin match' },
  ]);

  assert.equal(matches[0].review.title, 'Hash match');
});
