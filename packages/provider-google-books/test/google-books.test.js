import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGoogleBooksSearchUrl,
  calculateGoogleBooksConfidence,
  createGoogleBooksPlugin,
  mapGoogleBooksVolume,
} from '../src/index.js';

const VOLUME = {
  id: 'google-volume-1',
  volumeInfo: {
    title: 'World War Z',
    subtitle: 'An Oral History of the Zombie War',
    authors: ['Max Brooks'],
    publisher: 'Crown',
    publishedDate: '2006-09-12',
    description: 'An oral history of a fictional global conflict.',
    industryIdentifiers: [
      { type: 'ISBN_10', identifier: '0307346609' },
      { type: 'ISBN_13', identifier: '9780307351937' },
    ],
    categories: ['Fiction / Horror', 'Zombies'],
    language: 'en',
    imageLinks: {
      thumbnail: 'http://example.test/thumb.jpg',
      large: 'http://example.test/large.jpg',
    },
  },
};

test('builds ISBN-first queries', () => {
  const url = buildGoogleBooksSearchUrl({
    isbn: '978-0-307-35193-7',
    title: 'Ignored',
  });

  assert.equal(url.pathname, '/books/v1/volumes');
  assert.equal(url.searchParams.get('q'), 'isbn:9780307351937');
  assert.equal(url.searchParams.get('printType'), 'books');
  assert.equal(url.searchParams.get('orderBy'), 'relevance');
});

test('falls back to title and author queries', () => {
  const url = buildGoogleBooksSearchUrl({
    title: 'World War Z',
    authors: ['Max Brooks'],
    language: 'en-US',
  }, {
    apiKey: 'test-key',
    limit: 50,
  });

  assert.equal(
    url.searchParams.get('q'),
    'intitle:"World War Z" inauthor:"Max Brooks"',
  );
  assert.equal(url.searchParams.get('langRestrict'), 'en');
  assert.equal(url.searchParams.get('maxResults'), '40');
  assert.equal(url.searchParams.get('key'), 'test-key');
});

test('rejects empty searches', () => {
  assert.throws(
    () => buildGoogleBooksSearchUrl({}),
    /requires ISBN, title, author, or q/,
  );
});

test('maps Google volumes into Kindred metadata', () => {
  const result = mapGoogleBooksVolume(VOLUME);

  assert.equal(result.providerId, 'googleBooks');
  assert.equal(result.metadata.title, 'World War Z');
  assert.equal(
    result.metadata.subtitle,
    'An Oral History of the Zombie War',
  );
  assert.deepEqual(result.metadata.authors, ['Max Brooks']);
  assert.equal(result.metadata.isbn, '9780307351937');
  assert.equal(
    result.metadata.identifiers.googleBooks,
    'google-volume-1',
  );
  assert.equal(
    result.metadata.cover.url,
    'https://example.test/large.jpg',
  );
});

test('gives richer volumes stronger confidence', () => {
  assert.ok(
    calculateGoogleBooksConfidence(VOLUME)
      > calculateGoogleBooksConfidence({
        volumeInfo: { title: 'World War Z' },
      }),
  );
});

test('searches and maps API results', async () => {
  let capturedUrl;

  const plugin = createGoogleBooksPlugin({
    apiKey: 'test-key',
    fetch: async url => {
      capturedUrl = url;
      return {
        ok: true,
        async json() {
          return { totalItems: 1, items: [VOLUME] };
        },
      };
    },
  });

  const results = await plugin.search({
    title: 'World War Z',
    authors: ['Max Brooks'],
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].metadata.publisher, 'Crown');
  assert.equal(capturedUrl.searchParams.get('key'), 'test-key');
});

test('reports HTTP failures clearly', async () => {
  const plugin = createGoogleBooksPlugin({
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

test('enrich returns the first relevant result', async () => {
  const plugin = createGoogleBooksPlugin({
    fetch: async () => ({
      ok: true,
      async json() {
        return { items: [VOLUME] };
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
