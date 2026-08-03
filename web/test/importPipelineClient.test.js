import assert from 'node:assert/strict';
import test from 'node:test';
import { rewriteImportUrl } from '../src/importPipelineClient.js';

test('routes inspection through the v2 archive pipeline', () => {
  assert.equal(
    rewriteImportUrl('/api/v1/libraries/kindle-1/books/inspect', { method: 'POST' }),
    '/api/v2/import/libraries/kindle-1/inspect',
  );
});

test('routes reviewed commits through the verified pipeline', () => {
  assert.equal(
    rewriteImportUrl('/api/v1/libraries/kindle-1/books', { method: 'POST' }),
    '/api/v2/import/libraries/kindle-1/commit',
  );
});

test('does not rewrite reads or unrelated requests', () => {
  assert.equal(
    rewriteImportUrl('/api/v1/libraries/kindle-1/books', { method: 'GET' }),
    '/api/v1/libraries/kindle-1/books',
  );
  assert.equal(
    rewriteImportUrl('/api/v1/libraries', { method: 'POST' }),
    '/api/v1/libraries',
  );
});
