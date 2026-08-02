import assert from 'node:assert/strict';
import test from 'node:test';
import { createMetadataHandlers } from '../src/metadataApi.js';

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function result(metadata = {}) {
  return {
    query: { title: metadata.title || '' },
    candidates: [],
    errors: [],
    providers: [
      {
        providerId: 'openLibrary',
        durationMs: 10,
        resultCount: 1,
        error: null,
      },
    ],
    durationMs: 12,
    resolution: {
      metadata,
      provenance: {
        title: {
          source: 'openLibrary',
          confidence: 0.9,
        },
      },
      decisions: [],
      conflicts: [],
      coverCandidates: [],
    },
  };
}

test('search validates empty requests', async () => {
  const handlers = createMetadataHandlers({
    service: {
      async search() {
        throw new Error('Should not run.');
      },
    },
  });

  const res = response();
  await handlers.search({ body: {} }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.code, 'METADATA_QUERY_REQUIRED');
});

test('search returns the resolved metadata contract', async () => {
  let received;

  const handlers = createMetadataHandlers({
    service: {
      async search(query) {
        received = query;
        return result({
          title: 'World War Z',
          authors: ['Max Brooks'],
        });
      },
    },
  });

  const res = response();
  await handlers.search({
    body: {
      title: ' World War Z ',
      author: ' Max Brooks ',
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(received.authors, ['Max Brooks']);
  assert.equal(res.payload.metadata.title, 'World War Z');
  assert.equal(res.payload.provenance.title.source, 'openLibrary');
  assert.equal(res.payload.providers[0].providerId, 'openLibrary');
});

test('enrich preserves caller source settings', async () => {
  let receivedBook;
  let receivedContext;

  const handlers = createMetadataHandlers({
    service: {
      async enrich(book, context) {
        receivedBook = book;
        receivedContext = context;
        return result({
          title: book.metadata.title,
          publisher: 'Crown',
        });
      },
    },
  });

  const res = response();
  await handlers.enrich({
    body: {
      id: 'book-1',
      baseSource: 'manual',
      baseConfidence: 1,
      metadata: {
        title: 'World War Z',
        authors: ['Max Brooks'],
      },
    },
  }, res);

  assert.equal(receivedBook.id, 'book-1');
  assert.equal(receivedContext.baseSource, 'manual');
  assert.equal(receivedContext.baseConfidence, 1);
  assert.equal(res.payload.metadata.publisher, 'Crown');
});

test('provider failures become gateway errors', async () => {
  const handlers = createMetadataHandlers({
    service: {
      async search() {
        throw new Error('Metadata providers unavailable.');
      },
    },
  });

  const res = response();
  await handlers.search({
    body: { title: 'World War Z' },
  }, res);

  assert.equal(res.statusCode, 502);
  assert.equal(res.payload.code, 'METADATA_SEARCH_FAILED');
  assert.match(res.payload.error, /unavailable/);
});
