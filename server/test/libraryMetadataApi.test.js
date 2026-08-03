import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createLibraryStore } from '../src/libraryStore.js';
import { createLibraryMetadataRouter } from '../src/libraryMetadataApi.js';

async function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindred-metadata-'));
  const store = createLibraryStore(dataDir);
  store.write({
    version: 1,
    activeLibraryId: 'library-1',
    jobs: {},
    libraries: {
      'library-1': {
        id: 'library-1',
        name: 'Test Kindle',
        items: [{ id: 'book-1', type: 'book', title: 'Old title', authors: ['Author'], tags: [] }],
      },
    },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/v2/metadata/library', createLibraryMetadataRouter({ store }));
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { dataDir, store, server, base };
}

test('persists metadata, provenance and history across store reloads', async t => {
  const context = await fixture();
  t.after(() => { context.server.close(); fs.rmSync(context.dataDir, { recursive: true, force: true }); });

  const response = await fetch(`${context.base}/api/v2/metadata/library/items/book-1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      metadata: { title: 'World War Z', authors: ['Max Brooks'], publisher: 'Crown' },
      provenance: { title: { source: 'openLibrary', confidence: 0.9 } },
      decisions: [{ field: 'title', reason: 'highest-weighted-confidence' }],
      providers: [{ providerId: 'openLibrary', resultCount: 1 }],
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.changed, true);
  assert.equal(payload.item.title, 'World War Z');
  assert.equal(payload.item.metadataHistory.length, 1);

  const reloaded = createLibraryStore(context.dataDir).get('library-1').items[0];
  assert.equal(reloaded.publisher, 'Crown');
  assert.equal(reloaded.metadataProvenance.title.source, 'openLibrary');
  assert.equal(reloaded.metadataHistory.length, 1);
});

test('does not create duplicate history for a no-op save', async t => {
  const context = await fixture();
  t.after(() => { context.server.close(); fs.rmSync(context.dataDir, { recursive: true, force: true }); });
  const body = JSON.stringify({ metadata: { title: 'Old title', authors: ['Author'], tags: [] } });
  const response = await fetch(`${context.base}/api/v2/metadata/library/library-1/items/book-1`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body,
  });
  const payload = await response.json();
  assert.equal(payload.changed, false);
  assert.equal(payload.historyEntry, null);
});

test('returns persisted metadata history', async t => {
  const context = await fixture();
  t.after(() => { context.server.close(); fs.rmSync(context.dataDir, { recursive: true, force: true }); });
  await fetch(`${context.base}/api/v2/metadata/library/items/book-1`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadata: { title: 'New title' } }),
  });
  const response = await fetch(`${context.base}/api/v2/metadata/library/items/book-1/history`);
  const payload = await response.json();
  assert.equal(payload.history.length, 1);
  assert.equal(payload.history[0].previous.title, 'Old title');
  assert.equal(payload.history[0].next.title, 'New title');
});
