import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOpenLibrarySearchUrl,
  calculateConfidence,
  createOpenLibraryPlugin,
  mapOpenLibraryDocument,
} from '../src/index.js';

const DOCUMENT = {
  key: '/works/OL123W',
  title: 'World War Z',
  author_name: ['Max Brooks'],
  author_key: ['OL123A'],
  first_publish_year: 2006,
  publisher: ['Crown'],
  language: ['eng'],
  isbn: ['0307346609', '9780307351937'],
  subject: ['Horror', 'Zombies'],
  cover_i: 12345,
  edition_key: ['OL456M'],
};

test('builds ISBN-first search URLs', () => {
  const url = buildOpenLibrarySearchUrl({
    isbn: '978-0-307-35193-7',
    title: 'Ignored because ISBN is stronger',
  });

  assert.equal(url.pathname, '/search.json');
  assert.equal(url.searchParams.get('isbn'), '9780307351937');
  assert.equal(url.searchParams.has('title'), false);
  assert.equal(url.searchParams.get('limit'), '10');
});

test('falls back to title and author', () => {
  const url = buildOpenLibrarySearchUrl({
    title: 'World War Z',
    authors: ['Max Brooks'],
    language: 'en-US',
  });

  assert.equal(url.searchParams.get('title'), 'World War Z');
  assert.equal(url.searchParams.get('author'), 'Max Brooks');
  assert.equal(url.searchParams.get('lang'), 'en');
});

test('maps Open Library documents into Kindred metadata', () => {
  const result = mapOpenLibraryDocument(DOCUMENT);

  assert.equal(result.providerId, 'openLibrary');
  assert.equal(result.metadata.title, 'World War Z');
  assert.deepEqual(result.metadata.authors, ['Max Brooks']);
  assert.equal(result.metadata.isbn, '9780307351937');
  assert.equal(result.metadata.identifiers.openLibraryWork, 'OL123W');
  assert.equal(result.metadata.identifiers.openLibraryEdition, 'OL456M');
  assert.equal(
    result.metadata.cover.url,
    'https://covers.openlibrary.org/b/id/12345-L.jpg?default=false',
  );
});

test('calculates stronger confidence for richer records', () => {
  assert.ok(calculateConfidence(DOCUMENT) > calculateConfidence({
    title: 'World War Z',
  }));
});

test('searches with identified requests and returns mapped results', async () => {
  let capturedUrl;
  let capturedOptions;

  const plugin = createOpenLibraryPlugin({
    application: 'Kindred',
    contact: 'kindred@example.test',
    fetch: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        async json() {
          return { docs: [DOCUMENT] };
        },
      };
    },
  });

  const results = await plugin.search({
    title: 'World War Z',
    authors: ['Max Brooks'],
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].metadata.title, 'World War Z');
  assert.equal(capturedOptions.headers['User-Agent'], 'Kindred (kindred@example.test)');
  assert.equal(capturedOptions.headers.email, 'kindred@example.test');
  assert.equal(capturedUrl.searchParams.get('title'), 'World War Z');
});

test('reports non-success responses clearly', async () => {
  const plugin = createOpenLibraryPlugin({
    fetch: async () => ({
      ok: false,
      status: 429,
    }),
  });

  await assert.rejects(
    () => plugin.search({ title: 'World War Z' }),
    /status 429/,
  );
});

test('enrich returns the best first result', async () => {
  const plugin = createOpenLibraryPlugin({
    fetch: async () => ({
      ok: true,
      async json() {
        return { docs: [DOCUMENT] };
      },
    }),
  });

  const result = await plugin.enrich({
    metadata: {
      title: 'World War Z',
      authors: ['Max Brooks'],
    },
  });

  assert.equal(result.metadata.publisher, 'Crown');
});
