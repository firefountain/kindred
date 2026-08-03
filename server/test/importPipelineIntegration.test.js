import assert from 'node:assert/strict';
import test from 'node:test';
import { assignUploadNames } from '../src/importPipelineServerPatch.js';

test('keeps the first filename and disambiguates later collisions', () => {
  const books = assignUploadNames([
    { fileName: 'book.epub', sha256: 'aaaaaaaa11111111' },
    { fileName: 'BOOK.epub', sha256: 'bbbbbbbb22222222' },
    { fileName: 'other.epub', sha256: 'cccccccc33333333' },
  ]);

  assert.equal(books[0].uploadFileName, 'book.epub');
  assert.equal(books[1].uploadFileName, 'BOOK - bbbbbbbb.epub');
  assert.equal(books[2].uploadFileName, 'other.epub');
});
