import assert from 'node:assert/strict';
import test from 'node:test';
import { createMetadataStore } from '../src/stores/metadata.js';

function metadataPayload(overrides = {}) {
  return {
    metadata: { title: 'World War Z', publisher: 'Crown' },
    provenance: { publisher: { source: 'googleBooks', confidence: 0.9 } },
    decisions: [],
    conflicts: [],
    coverCandidates: [{ url: 'cover.jpg' }],
    candidates: [],
    providers: [],
    errors: [],
    ...overrides,
  };
}

test('search stores provider results without persisting a book', async () => {
  const store = createMetadataStore({
    async search() {
      return metadataPayload({
        errors: [{ providerId: 'googleBooks', message: 'rate limited' }],
      });
    },
  });

  const result = await store.search({ title: 'World War Z' });

  assert.equal(result.metadata.publisher, 'Crown');
  assert.equal(store.state.errors[0].providerId, 'googleBooks');
  assert.equal(store.state.searching, false);
});

test('enrich tracks the active book and applies only after confirmation', async () => {
  const original = {
    id: 'book-1',
    metadata: { title: 'World War Z' },
  };

  const store = createMetadataStore({
    async enrich() {
      return metadataPayload();
    },
  });

  await store.enrich(original);

  assert.equal(store.state.activeBookId, 'book-1');
  assert.equal(original.metadata.publisher, undefined);

  const updated = store.applyResolvedMetadata(original);
  assert.equal(updated.metadata.publisher, 'Crown');
  assert.equal(updated.metadata.cover.url, 'cover.jpg');
});

test('stale responses are ignored', async () => {
  const resolvers = [];
  const store = createMetadataStore({
    search() {
      return new Promise(resolve => resolvers.push(resolve));
    },
  });

  const first = store.search({ title: 'First' });
  const second = store.search({ title: 'Second' });

  resolvers[1](metadataPayload({ metadata: { title: 'Second' } }));
  await second;
  resolvers[0](metadataPayload({ metadata: { title: 'First' } }));
  await first;

  assert.equal(store.state.result.metadata.title, 'Second');
});

test('store instances do not share state', async () => {
  const first = createMetadataStore({
    async search() {
      return metadataPayload({ metadata: { title: 'First' } });
    },
  });
  const second = createMetadataStore({
    async search() {
      return metadataPayload({ metadata: { title: 'Second' } });
    },
  });

  await first.search({ title: 'First' });

  assert.equal(first.state.result.metadata.title, 'First');
  assert.equal(second.state.result, null);
});
