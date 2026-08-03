import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { readEpub } from '@kindred/epub-core';
import { writeEpubFileSafely } from '../src/epubWriteback.js';

function fixture() {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.addFile('META-INF/container.xml', Buffer.from(`<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`));
  zip.addFile('OEBPS/cover.jpg', Buffer.from([1, 2, 3]));
  zip.addFile('OEBPS/chapter.xhtml', Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><body>Hello</body></html>'));
  zip.addFile('OEBPS/content.opf', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">9780307351937</dc:identifier><dc:title>Old title</dc:title><dc:creator>Old Author</dc:creator><dc:language>en</dc:language><meta name="cover" content="cover-image"/></metadata><manifest><item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`));
  return zip.toBuffer();
}

function tempBook() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kindred-epub-'));
  const filePath = path.join(directory, 'book.epub');
  fs.writeFileSync(filePath, fixture());
  return { directory, filePath };
}

test('writes, verifies and backs up an EPUB atomically', () => {
  const { directory, filePath } = tempBook();
  const result = writeEpubFileSafely(filePath, {
    title: 'World War Z', authors: ['Max Brooks'], language: 'en',
    publisher: 'Crown', isbn: '9780307351937', tags: ['Horror'],
  }, { backupDir: path.join(directory, 'backups'), cover: { bytes: Buffer.from([9, 8, 7]) } });

  assert.equal(result.verified, true);
  assert.notEqual(result.originalSha256, result.writtenSha256);
  assert.equal(fs.existsSync(result.backupPath), true);
  const book = readEpub(fs.readFileSync(filePath));
  assert.equal(book.metadata.title, 'World War Z');
  assert.deepEqual(book.metadata.authors, ['Max Brooks']);
  assert.deepEqual([...book.cover.bytes], [9, 8, 7]);
});

test('rejects non-EPUB files without touching them', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kindred-epub-'));
  const filePath = path.join(directory, 'book.pdf');
  fs.writeFileSync(filePath, Buffer.from('unchanged'));
  assert.throws(() => writeEpubFileSafely(filePath, { title: 'Nope' }), /only supports/);
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'unchanged');
});

test('leaves the original untouched when the archive is invalid', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kindred-epub-'));
  const filePath = path.join(directory, 'broken.epub');
  fs.writeFileSync(filePath, Buffer.from('not an epub'));
  assert.throws(() => writeEpubFileSafely(filePath, { title: 'Nope' }), /Invalid EPUB/);
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'not an epub');
});
