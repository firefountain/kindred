import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { expandBookUploads } from '../src/archiveIntake.js';

function upload(name, bytes) {
  return {
    originalname: name,
    buffer: Buffer.from(bytes),
    size: Buffer.byteLength(bytes),
  };
}

function zipUpload(name, entries) {
  const zip = new AdmZip();
  for (const [entryName, bytes] of Object.entries(entries)) {
    zip.addFile(entryName, Buffer.from(bytes));
  }
  return upload(name, zip.toBuffer());
}

test('passes direct book files through and hashes them', () => {
  const result = expandBookUploads([
    upload('World War Z.epub', 'epub-bytes'),
  ]);

  assert.equal(result.books.length, 1);
  assert.equal(result.books[0].fileName, 'World War Z.epub');
  assert.equal(result.books[0].archiveName, null);
  assert.equal(result.books[0].format, 'EPUB');
  assert.equal(result.books[0].sha256.length, 64);
  assert.equal(result.summary.discoveredBooks, 1);
});

test('expands supported books from folders inside a ZIP', () => {
  const result = expandBookUploads([
    zipUpload('library.zip', {
      'Fantasy/A Mark of Kings.epub': 'book-one',
      'Sci-Fi/World War Z.azw3': 'book-two',
      'notes.txt': 'ignore me',
      '__MACOSX/._junk': 'junk',
    }),
  ]);

  assert.equal(result.books.length, 2);
  assert.deepEqual(
    result.books.map(book => book.archivePath),
    ['Fantasy/A Mark of Kings.epub', 'Sci-Fi/World War Z.azw3'],
  );
  assert.equal(result.summary.archiveCount, 1);
  assert.equal(result.summary.ignoredFiles, 2);
});

test('deduplicates books by content hash across direct files and ZIPs', () => {
  const result = expandBookUploads([
    upload('same.epub', 'identical'),
    zipUpload('library.zip', {
      'folder/copy.epub': 'identical',
      'folder/other.epub': 'different',
    }),
  ]);

  assert.equal(result.books.length, 2);
  assert.equal(result.summary.duplicateBooks, 1);
});

test('rejects ZIP path traversal entries', () => {
  const zip = new AdmZip();
  zip.addFile('../escape.epub', Buffer.from('bad'));

  assert.throws(
    () => expandBookUploads([upload('unsafe.zip', zip.toBuffer())]),
    /Unsafe archive path/,
  );
});

test('skips nested archives in the first version', () => {
  const result = expandBookUploads([
    zipUpload('library.zip', {
      'book.epub': 'book',
      'nested/more.zip': 'archive',
    }),
  ]);

  assert.equal(result.books.length, 1);
  assert.equal(result.summary.nestedArchives, 1);
});

test('enforces total expanded size', () => {
  assert.throws(
    () => expandBookUploads([
      zipUpload('library.zip', {
        'one.epub': '12345',
        'two.epub': '67890',
      }),
    ], { maxTotalBytes: 8 }),
    /total uncompressed size limit/,
  );
});
