import { apiRequest } from './client.js';

export function searchMetadata(query, options = {}) {
  return apiRequest('/api/v2/metadata/search', {
    method: 'POST',
    body: query,
    signal: options.signal,
    fetch: options.fetch,
  });
}

export function enrichMetadata(book, options = {}) {
  const metadata = book?.metadata || book || {};

  return apiRequest('/api/v2/metadata/enrich', {
    method: 'POST',
    body: {
      id: book?.id || null,
      metadata,
      baseSource: options.baseSource || 'embedded',
      baseConfidence: options.baseConfidence ?? 0.9,
      timeoutMs: options.timeoutMs,
    },
    signal: options.signal,
    fetch: options.fetch,
  });
}
