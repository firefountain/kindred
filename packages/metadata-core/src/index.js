const TEXT_FIELDS = [
  'title',
  'subtitle',
  'publisher',
  'language',
  'description',
  'series',
  'isbn',
  'asin',
];

const ARRAY_FIELDS = ['authors', 'tags', 'collections'];

export const DEFAULT_PROVIDER_PRIORITY = {
  manual: 1000,
  embedded: 900,
  calibreImport: 800,
  openLibrary: 700,
  googleBooks: 650,
  crossref: 550,
  filename: 100,
  unknown: 0,
};

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map(cleanText)
    .filter(Boolean))];
}

export function normalizeIsbn(value) {
  const candidate = String(value ?? '').replace(/[^0-9X]/gi, '').toUpperCase();
  return /^(?:\d{9}[\dX]|97[89]\d{10})$/.test(candidate) ? candidate : '';
}

export function normalizeLanguage(value) {
  return cleanText(value).toLowerCase().replace('_', '-');
}

export function normalizeMetadata(input = {}) {
  const normalized = {
    title: cleanText(input.title),
    subtitle: cleanText(input.subtitle),
    authors: unique(input.authors ?? input.author ?? []),
    series: cleanText(input.series),
    seriesIndex:
      input.seriesIndex == null || input.seriesIndex === ''
        ? null
        : Number.isFinite(Number(input.seriesIndex))
          ? Number(input.seriesIndex)
          : null,
    publisher: cleanText(input.publisher),
    language: normalizeLanguage(input.language),
    isbn: normalizeIsbn(input.isbn),
    asin: cleanText(input.asin).toUpperCase(),
    description: cleanText(input.description),
    tags: unique(input.tags ?? input.subjects ?? []),
    collections: unique(input.collections ?? []),
    identifiers: { ...(input.identifiers ?? {}) },
    cover: input.cover ?? null,
  };

  if (normalized.isbn) normalized.identifiers.isbn = normalized.isbn;
  if (normalized.asin) normalized.identifiers.amazon = normalized.asin;

  return normalized;
}

export function createMetadataRecord(metadata = {}, source = 'unknown', confidence = 0.5) {
  const normalized = normalizeMetadata(metadata);
  const provenance = {};

  for (const field of [...TEXT_FIELDS, ...ARRAY_FIELDS, 'seriesIndex', 'cover', 'identifiers']) {
    const value = normalized[field];
    const present =
      Array.isArray(value) ? value.length > 0 :
      value && typeof value === 'object' ? Object.keys(value).length > 0 :
      value !== '' && value !== null && value !== undefined;

    if (present) {
      provenance[field] = {
        source,
        confidence: clampConfidence(confidence),
        updatedAt: new Date().toISOString(),
      };
    }
  }

  return { metadata: normalized, provenance };
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function isEmpty(value) {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function sourceWeight(source, priorities) {
  return priorities[source] ?? priorities.unknown ?? 0;
}

function shouldReplace({
  currentValue,
  incomingValue,
  currentProvenance,
  incomingProvenance,
  strategy,
  priorities,
}) {
  if (isEmpty(incomingValue)) return false;
  if (isEmpty(currentValue)) return true;
  if (strategy === 'fill-holes') return false;

  const currentSource = currentProvenance?.source ?? 'unknown';
  const incomingSource = incomingProvenance?.source ?? 'unknown';

  if (currentSource === 'manual' && incomingSource !== 'manual') return false;

  const currentScore =
    sourceWeight(currentSource, priorities) +
    clampConfidence(currentProvenance?.confidence ?? 0) * 100;

  const incomingScore =
    sourceWeight(incomingSource, priorities) +
    clampConfidence(incomingProvenance?.confidence ?? 0) * 100;

  return incomingScore > currentScore;
}

export function mergeMetadataRecords(baseRecord, incomingRecord, options = {}) {
  const strategy = options.strategy ?? 'prefer-better';
  const priorities = { ...DEFAULT_PROVIDER_PRIORITY, ...(options.priorities ?? {}) };

  const base = createMetadataRecord(
    baseRecord?.metadata ?? baseRecord ?? {},
    'unknown',
    0,
  );
  base.provenance = { ...base.provenance, ...(baseRecord?.provenance ?? {}) };

  const incoming = createMetadataRecord(
    incomingRecord?.metadata ?? incomingRecord ?? {},
    options.source ?? 'unknown',
    options.confidence ?? 0.5,
  );
  incoming.provenance = { ...incoming.provenance, ...(incomingRecord?.provenance ?? {}) };

  const metadata = structuredClone(base.metadata);
  const provenance = structuredClone(base.provenance);

  for (const field of [...TEXT_FIELDS, 'seriesIndex', 'cover']) {
    if (shouldReplace({
      currentValue: metadata[field],
      incomingValue: incoming.metadata[field],
      currentProvenance: provenance[field],
      incomingProvenance: incoming.provenance[field],
      strategy,
      priorities,
    })) {
      metadata[field] = incoming.metadata[field];
      provenance[field] = incoming.provenance[field];
    }
  }

  for (const field of ARRAY_FIELDS) {
    const incomingValue = incoming.metadata[field];
    if (!incomingValue.length) continue;

    if (strategy === 'fill-holes' && metadata[field].length) continue;

    if (field === 'tags' || field === 'collections') {
      metadata[field] = unique([...metadata[field], ...incomingValue]);
      provenance[field] = incoming.provenance[field] ?? provenance[field];
      continue;
    }

    if (shouldReplace({
      currentValue: metadata[field],
      incomingValue,
      currentProvenance: provenance[field],
      incomingProvenance: incoming.provenance[field],
      strategy,
      priorities,
    })) {
      metadata[field] = incomingValue;
      provenance[field] = incoming.provenance[field];
    }
  }

  metadata.identifiers = {
    ...metadata.identifiers,
    ...incoming.metadata.identifiers,
  };

  if (Object.keys(incoming.metadata.identifiers).length) {
    provenance.identifiers = incoming.provenance.identifiers ?? provenance.identifiers;
  }

  return { metadata: normalizeMetadata(metadata), provenance };
}

export function mergeProviderResults(baseRecord, results, options = {}) {
  return results
    .filter(Boolean)
    .reduce(
      (record, result) =>
        mergeMetadataRecords(record, result, {
          strategy: options.strategy ?? 'prefer-better',
          priorities: options.priorities,
        }),
      baseRecord,
    );
}

export function validateProvider(provider) {
  if (!provider || typeof provider !== 'object') {
    throw new TypeError('Metadata provider must be an object.');
  }
  if (!cleanText(provider.id)) {
    throw new TypeError('Metadata provider requires a non-empty id.');
  }
  if (typeof provider.search !== 'function') {
    throw new TypeError(`Metadata provider "${provider.id}" requires search().`);
  }
  return provider;
}

export function providerResult(providerId, metadata, confidence = 0.5, raw = null) {
  return {
    ...createMetadataRecord(metadata, providerId, confidence),
    providerId,
    confidence: clampConfidence(confidence),
    raw,
  };
}
