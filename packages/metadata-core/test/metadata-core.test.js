import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMetadataRecord,
  mergeMetadataRecords,
  mergeProviderResults,
  normalizeMetadata,
  providerResult,
  validateProvider,
} from '../src/index.js';

test('normalizes canonical metadata', () => {
  const result = normalizeMetadata({
    title: '  World   War Z ',
    authors: [' Max Brooks ', 'Max Brooks'],
    isbn: '978-0-307-35193-7',
    language: 'EN_us',
    tags: [' Horror ', 'Horror', 'Zombies'],
    seriesIndex: '2',
  });

  assert.equal(result.title, 'World War Z');
  assert.deepEqual(result.authors, ['Max Brooks']);
  assert.equal(result.isbn, '9780307351937');
  assert.equal(result.language, 'en-us');
  assert.deepEqual(result.tags, ['Horror', 'Zombies']);
  assert.equal(result.seriesIndex, 2);
});

test('fill-holes never replaces existing values', () => {
  const base = createMetadataRecord(
    { title: 'Manual title', authors: ['Max Brooks'] },
    'manual',
    1,
  );
  const google = providerResult(
    'googleBooks',
    { title: 'Different title', publisher: 'Crown' },
    0.95,
  );

  const result = mergeMetadataRecords(base, google, { strategy: 'fill-holes' });
  assert.equal(result.metadata.title, 'Manual title');
  assert.equal(result.metadata.publisher, 'Crown');
});

test('manual metadata beats external providers', () => {
  const base = createMetadataRecord({ title: 'Chosen title' }, 'manual', 1);
  const provider = providerResult('openLibrary', { title: 'Provider title' }, 1);

  const result = mergeMetadataRecords(base, provider);
  assert.equal(result.metadata.title, 'Chosen title');
  assert.equal(result.provenance.title.source, 'manual');
});

test('better providers replace filename inference', () => {
  const base = createMetadataRecord(
    { title: 'World War Z Max Brooks final' },
    'filename',
    0.3,
  );
  const provider = providerResult(
    'openLibrary',
    { title: 'World War Z', authors: ['Max Brooks'] },
    0.9,
  );

  const result = mergeMetadataRecords(base, provider);
  assert.equal(result.metadata.title, 'World War Z');
  assert.deepEqual(result.metadata.authors, ['Max Brooks']);
  assert.equal(result.provenance.title.source, 'openLibrary');
});

test('tags and collections are merged without duplicates', () => {
  const base = createMetadataRecord(
    { tags: ['Horror'], collections: ['Unread'] },
    'embedded',
    0.9,
  );
  const provider = providerResult(
    'openLibrary',
    { tags: ['Horror', 'Zombies'], collections: ['Unread', 'Fiction'] },
    0.8,
  );

  const result = mergeMetadataRecords(base, provider);
  assert.deepEqual(result.metadata.tags, ['Horror', 'Zombies']);
  assert.deepEqual(result.metadata.collections, ['Unread', 'Fiction']);
});

test('provider pipelines merge deterministically', () => {
  const base = createMetadataRecord({ title: 'Raw filename' }, 'filename', 0.1);
  const result = mergeProviderResults(base, [
    providerResult('crossref', { publisher: 'Crown' }, 0.6),
    providerResult('googleBooks', { title: 'World War Z' }, 0.8),
    providerResult('openLibrary', { authors: ['Max Brooks'] }, 0.9),
  ]);

  assert.equal(result.metadata.title, 'World War Z');
  assert.equal(result.metadata.publisher, 'Crown');
  assert.deepEqual(result.metadata.authors, ['Max Brooks']);
});

test('provider contracts fail clearly', () => {
  assert.throws(
    () => validateProvider({ id: 'broken' }),
    /requires search/,
  );

  const provider = validateProvider({
    id: 'openLibrary',
    async search() {
      return [];
    },
  });

  assert.equal(provider.id, 'openLibrary');
});
