import test from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { readEpub, writeEpub } from '../src/index.js';

function fixture() {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.addFile('META-INF/container.xml', Buffer.from(`<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`));
  zip.addFile('OEBPS/content.opf', Buffer.from(`<?xml version="1.0"?><package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Old</dc:title><dc:creator>Old Author</dc:creator><dc:language>en</dc:language></metadata><manifest></manifest></package>`));
  return zip.toBuffer();
}

test('reads and rewrites EPUB metadata', () => {
  const updated = writeEpub(fixture(), {
    title: 'New Title',
    authors: ['New Author'],
    publisher: 'Kindred Press',
    tags: ['science fiction'],
    series: 'Example Series',
    seriesIndex: 2,
    isbn: '9780306406157',
  });
  const result = readEpub(updated).metadata;
  assert.equal(result.title, 'New Title');
  assert.deepEqual(result.authors, ['New Author']);
  assert.equal(result.publisher, 'Kindred Press');
  assert.equal(result.series, 'Example Series');
  assert.equal(result.seriesIndex, 2);
  assert.equal(result.isbn, '9780306406157');
  assert.deepEqual(result.subjects, ['science fiction']);
});
