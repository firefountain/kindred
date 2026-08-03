import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, apiRequest } from '../src/api/client.js';
import { enrichMetadata, searchMetadata } from '../src/api/metadata.js';

function jsonResponse(payload, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    async json() {
      if (options.invalidJson) throw new SyntaxError('bad json');
      return payload;
    },
  };
}

test('searchMetadata posts to metadata API v2', async () => {
  let request;
  const payload = { metadata: { title: 'World War Z' }, errors: [] };

  const result = await searchMetadata(
    { title: 'World War Z' },
    {
      fetch: async (url, options) => {
        request = { url, options };
        return jsonResponse(payload);
      },
    },
  );

  assert.equal(request.url, '/api/v2/metadata/search');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), { title: 'World War Z' });
  assert.deepEqual(result, payload);
});

test('enrichMetadata preserves source options', async () => {
  let body;

  await enrichMetadata(
    { id: 'book-1', metadata: { title: 'World War Z' } },
    {
      baseSource: 'manual',
      baseConfidence: 1,
      fetch: async (_url, options) => {
        body = JSON.parse(options.body);
        return jsonResponse({ metadata: body.metadata });
      },
    },
  );

  assert.equal(body.id, 'book-1');
  assert.equal(body.baseSource, 'manual');
  assert.equal(body.baseConfidence, 1);
});

test('apiRequest exposes structured HTTP errors', async () => {
  await assert.rejects(
    () => apiRequest('/api/v2/metadata/search', {
      method: 'POST',
      body: {},
      fetch: async () => jsonResponse(
        { error: 'Title required.', code: 'METADATA_QUERY_REQUIRED' },
        { ok: false, status: 400 },
      ),
    }),
    error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.code, 'METADATA_QUERY_REQUIRED');
      return true;
    },
  );
});

test('apiRequest reports invalid JSON separately', async () => {
  await assert.rejects(
    () => apiRequest('/api/v2/metadata/search', {
      fetch: async () => jsonResponse(null, { invalidJson: true }),
    }),
    error => error.code === 'INVALID_JSON_RESPONSE',
  );
});

test('provider partial failures remain in successful payloads', async () => {
  const payload = {
    metadata: { title: 'World War Z' },
    errors: [{ providerId: 'googleBooks', message: 'rate limited' }],
  };

  const result = await searchMetadata(
    { title: 'World War Z' },
    { fetch: async () => jsonResponse(payload) },
  );

  assert.equal(result.metadata.title, 'World War Z');
  assert.equal(result.errors[0].providerId, 'googleBooks');
});
