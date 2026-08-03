import { apiRequest } from './client.js';

export function searchMetadata(query, options = {}) {
  return apiRequest('/api/v2/metadata/search', {
    method: 'POST', body: query, signal: options.signal, fetch: options.fetch,
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

export function persistMetadata(book, result, options = {}) {
  const path = options.libraryId
    ? `/api/v2/metadata/library/${encodeURIComponent(options.libraryId)}/items/${encodeURIComponent(book.id)}`
    : `/api/v2/metadata/library/items/${encodeURIComponent(book.id)}`;
  return apiRequest(path, {
    method: 'PUT',
    body: {
      metadata: book.metadata || book,
      provenance: result?.provenance || book.metadataProvenance || {},
      decisions: result?.decisions || book.metadataDecisions || [],
      conflicts: result?.conflicts || book.metadataConflicts || [],
      providers: result?.providers || [],
      selectedCover: book.selectedCover || book.metadata?.cover || null,
      source: options.source || 'Kindred metadata inspector',
    },
    signal: options.signal,
    fetch: options.fetch,
  });
}

export function getMetadataHistory(itemId, options = {}) {
  const path = options.libraryId
    ? `/api/v2/metadata/library/${encodeURIComponent(options.libraryId)}/items/${encodeURIComponent(itemId)}/history`
    : `/api/v2/metadata/library/items/${encodeURIComponent(itemId)}/history`;
  return apiRequest(path, { signal: options.signal, fetch: options.fetch });
}
