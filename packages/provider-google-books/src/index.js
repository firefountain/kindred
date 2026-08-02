import { normalizeMetadata } from '@kindred/metadata-core';
import { defineMetadataPlugin } from '@kindred/plugin-core';

const DEFAULT_BASE_URL = 'https://www.googleapis.com/books/v1';

function cleanArray(value) {
  return [...new Set(
    (Array.isArray(value) ? value : value ? [value] : [])
      .map(item => String(item).trim())
      .filter(Boolean),
  )];
}

function normalizeIsbn(value) {
  return String(value || '').replace(/[^0-9X]/gi, '').toUpperCase();
}

function chooseIsbn(industryIdentifiers = []) {
  const identifiers = industryIdentifiers
    .map(identifier => ({
      type: String(identifier.type || ''),
      value: normalizeIsbn(identifier.identifier),
    }))
    .filter(identifier => identifier.value);

  return identifiers.find(identifier => identifier.type === 'ISBN_13')?.value
    || identifiers.find(identifier => identifier.type === 'ISBN_10')?.value
    || identifiers[0]?.value
    || '';
}

function identifierMap(volume) {
  const info = volume.volumeInfo || {};
  const identifiers = {};

  for (const entry of info.industryIdentifiers || []) {
    const value = normalizeIsbn(entry.identifier);
    if (!value) continue;

    if (entry.type === 'ISBN_13') identifiers.isbn13 = value;
    else if (entry.type === 'ISBN_10') identifiers.isbn10 = value;
    else identifiers[String(entry.type || 'unknown').toLowerCase()] = value;
  }

  if (volume.id) identifiers.googleBooks = volume.id;
  return identifiers;
}

function bestImage(images = {}) {
  const candidates = [
    ['extraLarge', 1280, 1920],
    ['large', 800, 1200],
    ['medium', 575, 862],
    ['small', 300, 450],
    ['thumbnail', 128, 192],
    ['smallThumbnail', 80, 120],
  ];

  for (const [key, width, height] of candidates) {
    if (!images[key]) continue;
    return {
      url: String(images[key]).replace(/^http:/, 'https:'),
      width,
      height,
      variant: key,
    };
  }

  return null;
}

export function calculateGoogleBooksConfidence(volume) {
  const info = volume.volumeInfo || {};
  let score = 0.4;

  if (volume.id) score += 0.05;
  if (info.title) score += 0.1;
  if (cleanArray(info.authors).length) score += 0.1;
  if ((info.industryIdentifiers || []).length) score += 0.15;
  if (info.publisher) score += 0.025;
  if (info.description) score += 0.05;
  if (cleanArray(info.categories).length) score += 0.025;
  if (bestImage(info.imageLinks)) score += 0.05;
  if (info.language) score += 0.025;
  if (info.publishedDate) score += 0.025;

  return Math.min(1, Number(score.toFixed(3)));
}

export function mapGoogleBooksVolume(volume) {
  const info = volume.volumeInfo || {};
  const isbn = chooseIsbn(info.industryIdentifiers);
  const cover = bestImage(info.imageLinks);

  return {
    id: volume.id || isbn || info.title,
    providerId: 'googleBooks',
    confidence: calculateGoogleBooksConfidence(volume),
    metadata: normalizeMetadata({
      title: info.title,
      subtitle: info.subtitle,
      authors: cleanArray(info.authors),
      publisher: info.publisher,
      language: info.language,
      isbn,
      description: info.description,
      tags: cleanArray(info.categories),
      identifiers: identifierMap(volume),
      cover,
    }),
    evidence: {
      title: volume.id ? [`Google Books volume ${volume.id}`] : [],
      isbn: isbn ? [`Google Books industry identifier ${isbn}`] : [],
      cover: cover ? [`Google Books image variant ${cover.variant}`] : [],
    },
    raw: volume,
  };
}

function quoted(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned) return '';
  return `"${cleaned.replaceAll('"', '\\"')}"`;
}

export function buildGoogleBooksSearchUrl(query = {}, options = {}) {
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  const url = new URL('/books/v1/volumes', baseUrl);
  const isbn = normalizeIsbn(query.isbn);
  const title = String(query.title || '').trim();
  const author = cleanArray(query.authors || query.author)[0] || '';
  const terms = [];

  if (isbn) {
    terms.push(`isbn:${isbn}`);
  } else {
    if (title) terms.push(`intitle:${quoted(title)}`);
    if (author) terms.push(`inauthor:${quoted(author)}`);
    if (!terms.length && query.q) terms.push(String(query.q).trim());
  }

  if (!terms.length) {
    throw new Error('Google Books search requires ISBN, title, author, or q.');
  }

  url.searchParams.set('q', terms.join(' '));
  url.searchParams.set('printType', 'books');
  url.searchParams.set('orderBy', options.orderBy || 'relevance');
  url.searchParams.set(
    'maxResults',
    String(Math.max(1, Math.min(Number(options.limit) || 10, 40))),
  );
  url.searchParams.set('projection', options.projection || 'full');

  if (query.language) {
    url.searchParams.set(
      'langRestrict',
      String(query.language).slice(0, 2).toLowerCase(),
    );
  }

  if (options.apiKey) {
    url.searchParams.set('key', String(options.apiKey));
  }

  return url;
}

export function createGoogleBooksPlugin(options = {}) {
  const transport = options.fetch || globalThis.fetch;

  if (typeof transport !== 'function') {
    throw new TypeError('Google Books provider requires fetch().');
  }

  async function search(query, context = {}) {
    const controller = new AbortController();
    const timeoutMs = Number(context.timeoutMs || options.timeoutMs) || 8000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = buildGoogleBooksSearchUrl(query, options);
      const response = await transport(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Google Books request failed with status ${response.status}.`,
        );
      }

      const payload = await response.json();

      return (payload.items || [])
        .map(mapGoogleBooksVolume)
        .filter(result => result.metadata.title);
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(
          `Google Books request timed out after ${timeoutMs}ms.`,
        );
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
    }, context);

    return results[0] || null;
  }

  return defineMetadataPlugin({
    id: 'googleBooks',
    priority: Number(options.priority) || 650,
    search,
    enrich,
  });
}
