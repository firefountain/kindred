import crypto from 'node:crypto';

const BOOK_EXTENSIONS = new Set(['.epub', '.mobi', '.azw', '.azw3', '.pdf', '.kfx']);

function extension(name = '') {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
}

function cleanPackageName(name) {
  return name
    .replace(/\.sdr$/i, '')
    .replace(/_[0-9a-f]{8}-[0-9a-f-]{27,}$/i, '')
    .replace(/_B[0-9A-Z]{9}$/i, '')
    .replace(/_OP[0-9A-Z]{20,}$/i, '')
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAsin(name = '') {
  return name.match(/_(B[0-9A-Z]{9})(?:\.sdr)?$/i)?.[1]?.toUpperCase() || '';
}

function inferTitleAndAuthors(name) {
  const title = cleanPackageName(name);
  const parts = title.split(/\s+-\s+/).map(value => value.trim()).filter(Boolean);
  if (parts.length < 2) return { title, authors: [] };
  const final = parts.at(-1);
  const looksLikeAuthor = /^[\p{L}. '-]{3,60}$/u.test(final)
    && final.split(/\s+/).length <= 5
    && !/\b(book|volume|edition|squadron|history|dictionary)\b/i.test(final);
  return looksLikeAuthor
    ? { title: parts.slice(0, -1).join(' - '), authors: [final] }
    : { title, authors: [] };
}

function normalizedKey(value = '') {
  return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizePath(value = '') {
  return String(value)
    .replaceAll('\\\\', '/')
    .replace(/^\/+/, '')
    .replace(/^documents\//i, '')
    .toLowerCase();
}

function calibrePath(entry = {}) {
  return normalizePath(entry.lpath || entry.path || entry.filepath || entry.relativePath || '');
}

function calibreIdentifiers(entry = {}) {
  const identifiers = entry.identifiers && typeof entry.identifiers === 'object' ? entry.identifiers : {};
  return {
    isbn: String(identifiers.isbn || entry.isbn || '').replace(/^isbn:/i, ''),
    asin: String(identifiers.amazon || identifiers.asin || entry.asin || '').replace(/^amazon:/i, '').toUpperCase(),
  };
}

function classify({ title, path, isPackage }) {
  const lowerPath = path.toLowerCase();
  if (lowerPath.includes('/documents/dictionaries/') || /\bdictionary\b/i.test(title)) return 'dictionary';
  if (/^(bbc news|independent, the|economico)\b/i.test(title) || /_op[0-9a-z]{20,}/i.test(path)) return 'periodical';
  if (/^my clippings$/i.test(title) || /my clippings/i.test(path)) return 'document';
  if (extension(path) === '.pdf' && !isPackage) return 'document';
  return 'book';
}

function isImplementationPath(path) {
  const value = path.toLowerCase();
  return value.includes('/.cache/')
    || value.includes('/assets/')
    || value.includes('/data/')
    || value.endsWith('/metadata.kfx')
    || value.endsWith('/voucher')
    || value.endsWith('/.pagination.cache');
}

function itemId(prefix, info, path) {
  return crypto.createHash('sha1')
    .update(`${prefix}:${info.storageId}:${info.handle}:${path}`)
    .digest('hex')
    .slice(0, 16);
}

function makeBase({ info, path, title, authors, format, sourceKind, type }) {
  const asin = extractAsin(info.filename) || extractAsin(path);
  return {
    id: itemId(sourceKind, info, path), type, mtpHandle: info.handle, storageId: info.storageId,
    fileName: info.filename, relativePath: path.replace(/^\/documents\/?/i, ''), format,
    size: info.size || 0, modifiedAt: info.modifiedDate || '', title, subtitle: '', authors,
    isbn: '', asin, publisher: '', language: '', description: '', coverUrl: '', series: '',
    seriesIndex: null, tags: [], collections: [], sourceKind,
    metadataSource: {
      title: 'device filename', authors: authors.length ? 'device filename' : 'missing',
      asin: asin ? 'device filename' : 'missing',
    },
  };
}

function findCalibreEntry(item, entries) {
  const itemPath = normalizePath(item.relativePath);
  const itemBase = normalizedKey(item.fileName.replace(/\.sdr$/i, '').replace(/\.[^.]+$/, ''));
  const itemAsin = item.asin;

  let best = null;
  let bestScore = 0;
  for (const entry of entries) {
    const path = calibrePath(entry);
    const ids = calibreIdentifiers(entry);
    let score = 0;
    if (path && path === itemPath) score += 200;
    if (path && (path.replace(/\.sdr$/i, '') === itemPath.replace(/\.sdr$/i, ''))) score += 160;
    if (itemAsin && ids.asin && itemAsin === ids.asin) score += 180;
    const entryBase = normalizedKey((entry.lpath || entry.path || '').split('/').at(-1)?.replace(/\.[^.]+$/, '') || entry.title || '');
    if (itemBase && entryBase && itemBase === entryBase) score += 100;
    if (entry.title && normalizedKey(entry.title) === normalizedKey(item.title)) score += 80;
    if (score > bestScore) { best = entry; bestScore = score; }
  }
  return bestScore >= 80 ? best : null;
}

function applyCalibreMetadata(item, entry) {
  if (!entry) return item;
  const ids = calibreIdentifiers(entry);
  const title = String(entry.title || '').trim();
  const authors = Array.isArray(entry.authors) ? entry.authors.filter(Boolean).map(String) : [];
  const tags = Array.isArray(entry.tags) ? entry.tags.filter(Boolean).map(String) : [];
  const comments = String(entry.comments || entry.description || '').trim();
  const publisher = String(entry.publisher || '').trim();
  const language = String((Array.isArray(entry.languages) ? entry.languages[0] : entry.language) || '').trim();
  const series = String(entry.series || '').trim();
  const seriesIndex = Number.isFinite(Number(entry.series_index)) ? Number(entry.series_index) : null;
  const collections = Array.isArray(entry.device_collections)
    ? entry.device_collections.filter(Boolean).map(String)
    : Array.isArray(entry.collections) ? entry.collections.filter(Boolean).map(String) : [];

  return {
    ...item,
    title: title || item.title,
    authors: authors.length ? authors : item.authors,
    isbn: ids.isbn || item.isbn,
    asin: ids.asin || item.asin,
    publisher: publisher || item.publisher,
    language: language || item.language,
    description: comments || item.description,
    series: series || item.series,
    seriesIndex: seriesIndex ?? item.seriesIndex,
    tags: tags.length ? tags : item.tags,
    collections: collections.length ? collections : item.collections,
    calibreUuid: entry.uuid || '',
    calibrePath: entry.lpath || entry.path || '',
    metadataSource: {
      ...item.metadataSource,
      ...(title ? { title: 'metadata.calibre' } : {}),
      ...(authors.length ? { authors: 'metadata.calibre' } : {}),
      ...(ids.isbn ? { isbn: 'metadata.calibre' } : {}),
      ...(ids.asin ? { asin: 'metadata.calibre' } : {}),
      ...(publisher ? { publisher: 'metadata.calibre' } : {}),
      ...(language ? { language: 'metadata.calibre' } : {}),
      ...(comments ? { description: 'metadata.calibre' } : {}),
      ...(series ? { series: 'metadata.calibre' } : {}),
      ...(tags.length ? { tags: 'metadata.calibre' } : {}),
      ...(collections.length ? { collections: 'metadata.calibre' } : {}),
    },
  };
}

export function resolveKindleItems(objects, buildPath, calibreMetadata = []) {
  const candidates = [];
  for (const info of objects.values()) {
    const path = buildPath(info, objects);
    if (!path.toLowerCase().startsWith('/documents/')) continue;

    if (info.isFolder && /\.sdr$/i.test(info.filename)) {
      const inferred = inferTitleAndAuthors(info.filename);
      if (!inferred.title) continue;
      candidates.push(makeBase({ info, path, title: inferred.title, authors: inferred.authors,
        format: 'KFX', sourceKind: 'kindle-package',
        type: classify({ title: inferred.title, path, isPackage: true }) }));
      continue;
    }

    if (info.isFolder || !BOOK_EXTENSIONS.has(extension(info.filename))) continue;
    if (isImplementationPath(path) || /\.sdr\//i.test(path)) continue;
    const inferred = inferTitleAndAuthors(info.filename);
    candidates.push(makeBase({ info, path, title: inferred.title, authors: inferred.authors,
      format: extension(info.filename).slice(1).toUpperCase(), sourceKind: 'device-file',
      type: classify({ title: inferred.title, path, isPackage: false }) }));
  }

  const enriched = candidates.map(item => applyCalibreMetadata(item, findCalibreEntry(item, calibreMetadata)));
  const deduped = new Map();
  for (const item of enriched) {
    const key = `${item.type}:${item.asin || normalizedKey(item.title)}`;
    const existing = deduped.get(key);
    const itemHasCalibre = Object.values(item.metadataSource || {}).includes('metadata.calibre');
    const existingHasCalibre = existing && Object.values(existing.metadataSource || {}).includes('metadata.calibre');
    if (!existing || (!existingHasCalibre && itemHasCalibre)
      || (existing.sourceKind === 'kindle-package' && item.sourceKind === 'device-file')) {
      deduped.set(key, item);
    }
  }
  return [...deduped.values()].sort((a, b) => a.title.localeCompare(b.title));
}
