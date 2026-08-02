import { normalizeMetadata } from '@kindred/metadata-core';
import { defineMetadataPlugin } from '@kindred/plugin-core';

const DEFAULT_BASE_URL = 'https://openlibrary.org';
const DEFAULT_COVERS_URL = 'https://covers.openlibrary.org';

const SEARCH_FIELDS = [
  'key',
  'title',
  'subtitle',
  'author_name',
  'author_key',
  'first_publish_year',
  'publisher',
  'language',
  'isbn',
  'subject',
  'cover_i',
  'edition_key',
].join(',');

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanArray(value) {
  return [...new Set(
    (Array.isArray(value) ? value : value ? [value] : [])
      .map(item => String(item).trim())
      .filter(Boolean),
  )];
}

function normalizeKey(value) {
  const key = String(value || '').trim();
  if (!key) return '';
  return key.startsWith('/') ? key : `/works/${key}`;
}

function coverFromDocument(document, coversUrl) {
  if (!document.cover_i) return null;

  return {
    url: `${coversUrl}/b/id/${document.cover_i}-L.jpg?default=false`,
    sourceUrl: `${coversUrl}/b/id/${document.cover_i}.json`,
    coverId: document.cover_i,
    size: 'large',
  };
}

export function mapOpenLibraryDocument(document, options = {}) {
  const coversUrl = options.coversUrl || DEFAULT_COVERS_URL;
  const isbn = cleanArray(document.isbn);
  const workKey = normalizeKey(document.key);
  const editionKeys = cleanArray(document.edition_key);

  const metadata = normalizeMetadata({
    title: document.title,
    subtitle: document.subtitle,
    authors: cleanArray(document.author_name),
    publisher: first(document.publisher),
    language: first(document.language),
    isbn: isbn.find(value => value.length === 13)
      || isbn.find(value => value.length === 10)
      || '',
    tags: cleanArray(document.subject),
    identifiers: {
      openLibraryWork: workKey.replace('/works/', ''),
      openLibraryEdition: editionKeys[0] || '',
      ...(isbn.length ? { isbn: isbn[0] } : {}),
    },
    cover: coverFromDocument(document, coversUrl),
  });

  return {
    id: workKey || editionKeys[0] || metadata.isbn || metadata.title,
    providerId: 'openLibrary',
    confidence: calculateConfidence(document),
    metadata,
    evidence: {
      title: workKey ? [`Open Library work ${workKey}`] : [],
      isbn: isbn.length ? [`Open Library returned ${isbn.length} ISBN value(s)`] : [],
      cover: document.cover_i ? [`Open Library cover ${document.cover_i}`] : [],
    },
    raw: document,
  };
}

export function calculateConfidence(document) {
  let score = 0.45;

  if (document.key) score += 0.1;
  if (document.title) score += 0.1;
  if (cleanArray(document.author_name).length) score += 0.1;
  if (cleanArray(document.isbn).length) score += 0.15;
  if (document.cover_i) score += 0.05;
  if (cleanArray(document.publisher).length) score += 0.025;
  if (cleanArray(document.language).length) score += 0.025;

  return Math.min(1, Number(score.toFixed(3)));
}

export function buildOpenLibrarySearchUrl(query = {}, options = {}) {
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  const limit = Math.max(1, Math.min(Number(options.limit) || 10, 50));
  const url = new URL('/search.json', baseUrl);

  const isbn = String(query.isbn || '').replace(/[^0-9X]/gi, '');
  const title = String(query.title || '').trim();
  const authors = cleanArray(query.authors || query.author);
  const author = authors[0] || '';

  if (isbn) {
    url.searchParams.set('isbn', isbn);
  } else {
    if (title) url.searchParams.set('title', title);
    if (author) url.searchParams.set('author', author);

    if (!title && !author && query.q) {
      url.searchParams.set('q', String(query.q).trim());
    }
  }

  url.searchParams.set('fields', SEARCH_FIELDS);
  url.searchParams.set('limit', String(limit));

  if (query.language) {
    url.searchParams.set('lang', String(query.language).slice(0, 2).toLowerCase());
  }

  return url;
}

function createHeaders(options) {
  const application = String(options.application || 'Kindred').trim();
  const contact = String(options.contact || '').trim();
  const identity = contact
    ? `${application} (${contact})`
    : application;

  return {
    Accept: 'application/json',
    'User-Agent': identity,
    ...(contact ? { email: contact } : {}),
  };
}

export function createOpenLibraryPlugin(options = {}) {
  const transport = options.fetch || globalThis.fetch;

  if (typeof transport !== 'function') {
    throw new TypeError('Open Library provider requires fetch().');
  }

  async function search(query, context = {}) {
    const controller = new AbortController();
    const timeoutMs = Number(context.timeoutMs || options.timeoutMs) || 8000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = buildOpenLibrarySearchUrl(query, options);
      const response = await transport(url, {
        headers: createHeaders(options),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Open Library request failed with status ${response.status}.`);
      }

      const payload = await response.json();

      return (payload.docs || [])
        .map(document => mapOpenLibraryDocument(document, options))
        .filter(result => result.metadata.title);
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Open Library request timed out after ${timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function enrich(book, context = {}) {
    const metadata = book.metadata || book;
    const results = await search({
      title: metadata.title,
      authors: metadata.authors,
      isbn: metadata.isbn,
      language: metadata.language,
    }, {
      ...context,
      timeoutMs: context.timeoutMs || options.timeoutMs,
    });

    return results[0] || null;
  }

  return defineMetadataPlugin({
    id: 'openLibrary',
    priority: Number(options.priority) || 700,
    search,
    enrich,
  });
}
