import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addFile,
  canonicalFile,
  createLibraryItem,
  libraryStats,
  linkDevice,
} from '../src/index.js';

test('models one logical book with multiple files', () => {
  let item = createLibraryItem({
    id: 'world-war-z',
    title: 'World War Z',
    authors: ['Max Brooks'],
  });

  item = addFile(item, {
    id: 'epub',
    format: 'EPUB',
    path: '/books/world-war-z.epub',
    canonical: true,
  });
  item = addFile(item, {
    id: 'azw3',
    format: 'AZW3',
    path: '/exports/world-war-z.azw3',
  });

  assert.equal(item.files.length, 2);
  assert.equal(canonicalFile(item).format, 'epub');
});

test('upserts device links', () => {
  let item = createLibraryItem({ id: 'book', title: 'Book' });
  item = linkDevice(item, { deviceId: 'kindle', remoteId: '1', syncStatus: 'pending' });
  item = linkDevice(item, { deviceId: 'kindle', remoteId: '1', syncStatus: 'synced' });
  assert.equal(item.deviceLinks.length, 1);
  assert.equal(item.deviceLinks[0].syncStatus, 'synced');
});

test('calculates dashboard stats', () => {
  const items = [
    createLibraryItem({
      id: 'one',
      title: 'One',
      authors: ['Author'],
      series: 'Series',
      collections: ['Unread'],
      cover: { url: 'cover' },
    }),
    createLibraryItem({
      id: 'two',
      title: '',
      authors: [],
      deviceLinks: [{ deviceId: 'kindle', syncStatus: 'pending' }],
    }),
  ];

  assert.deepEqual(libraryStats(items), {
    books: 2,
    authors: 1,
    series: 1,
    collections: 1,
    missingCover: 1,
    missingMetadata: 1,
    unsynced: 1,
  });
});
