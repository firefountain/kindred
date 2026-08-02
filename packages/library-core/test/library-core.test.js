import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addFile,
  canonicalFile,
  createLibraryItem,
  libraryStats,
  linkDevice,
  removeFile,
  unlinkDevice,
} from '../src/index.js';

test('models one logical book with multiple formats', () => {
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

test('keeps exactly one canonical file', () => {
  let item = createLibraryItem({ id: 'book', title: 'Book' });
  item = addFile(item, { id: 'one', format: 'epub', canonical: true });
  item = addFile(item, { id: 'two', format: 'epub', canonical: true });

  assert.equal(item.files.filter(file => file.canonical).length, 1);
  assert.equal(canonicalFile(item).id, 'two');
});

test('updates and removes files without mutating the original item', () => {
  const original = createLibraryItem({
    id: 'book',
    title: 'Book',
    files: [{ id: 'epub', format: 'epub', path: '/old.epub' }],
  });

  const updated = addFile(original, {
    id: 'epub',
    format: 'epub',
    path: '/new.epub',
  });

  const removed = removeFile(updated, 'epub');

  assert.equal(original.files[0].path, '/old.epub');
  assert.equal(updated.files[0].path, '/new.epub');
  assert.equal(removed.files.length, 0);
});

test('upserts and removes device links', () => {
  let item = createLibraryItem({ id: 'book', title: 'Book' });

  item = linkDevice(item, {
    deviceId: 'kindle',
    remoteId: '42',
    syncStatus: 'pending',
  });

  item = linkDevice(item, {
    deviceId: 'kindle',
    remoteId: '42',
    syncStatus: 'synced',
  });

  assert.equal(item.deviceLinks.length, 1);
  assert.equal(item.deviceLinks[0].syncStatus, 'synced');

  item = unlinkDevice(item, 'kindle', '42');
  assert.equal(item.deviceLinks.length, 0);
});

test('requires a device id when linking', () => {
  assert.throws(
    () => linkDevice(createLibraryItem({ title: 'Book' }), {}),
    /requires deviceId/,
  );
});

test('calculates dashboard statistics', () => {
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
      deviceLinks: [{
        deviceId: 'kindle',
        remoteId: '2',
        syncStatus: 'pending',
      }],
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
