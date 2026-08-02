import AdmZip from 'adm-zip';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressEmptyNode: false,
});

const asArray = value => value == null ? [] : Array.isArray(value) ? value : [value];
const text = value => {
  if (value == null) return '';
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === 'object') return String(value['#text'] ?? '');
  return String(value);
};
const clean = value => String(value ?? '').trim();
const unique = values => [...new Set(asArray(values).map(clean).filter(Boolean))];
const normalizeIsbn = value => {
  const candidate = String(value || '').replace(/[^0-9X]/gi, '');
  return /^(?:\d{9}[\dX]|97[89]\d{10})$/i.test(candidate) ? candidate : '';
};

function openZip(input) {
  try {
    return input instanceof AdmZip ? input : new AdmZip(input);
  } catch (error) {
    throw new Error(`Invalid EPUB archive: ${error.message}`);
  }
}

function packageDocument(zip) {
  const containerEntry = zip.getEntry('META-INF/container.xml');
  if (!containerEntry) throw new Error('Invalid EPUB: META-INF/container.xml is missing.');

  const container = parser.parse(containerEntry.getData().toString('utf8'));
  const opfPath = asArray(container?.container?.rootfiles?.rootfile)[0]?.['@_full-path'];
  const opfEntry = opfPath && zip.getEntry(opfPath);
  if (!opfEntry) throw new Error('Invalid EPUB: OPF package was not found.');

  const parsed = parser.parse(opfEntry.getData().toString('utf8'));
  if (!parsed?.package) throw new Error('Invalid EPUB: OPF package root is missing.');
  return { opfPath, parsed, packageNode: parsed.package };
}

function relativePath(opfPath, href) {
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const parts = `${base}${decodeURIComponent(href)}`.replace(/\\/g, '/').split('/');
  const result = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') result.pop();
    else result.push(part);
  }
  return result.join('/');
}

function coverInfo(zip, opfPath, packageNode) {
  const metadata = packageNode.metadata || {};
  const manifest = asArray(packageNode.manifest?.item);
  const coverId = asArray(metadata.meta).find(item => item?.['@_name'] === 'cover')?.['@_content'];
  const item = manifest.find(candidate =>
    candidate?.['@_id'] === coverId ||
    String(candidate?.['@_properties'] || '').split(/\s+/).includes('cover-image')
  );
  if (!item?.['@_href']) return null;
  const path = relativePath(opfPath, item['@_href']);
  const entry = zip.getEntry(path);
  return entry ? { path, mediaType: item['@_media-type'] || 'image/jpeg', bytes: entry.getData() } : null;
}

function seriesInfo(metadata) {
  const metas = asArray(metadata.meta);
  const name = metas.find(item => item?.['@_name'] === 'calibre:series');
  const index = metas.find(item => item?.['@_name'] === 'calibre:series_index');
  const epub3Name = metas.find(item => item?.['@_property'] === 'belongs-to-collection');
  const epub3Index = metas.find(item => item?.['@_property'] === 'group-position');
  const rawIndex = text(index?.['@_content'] || epub3Index);
  return {
    series: clean(text(name?.['@_content'] || epub3Name)),
    seriesIndex: rawIndex === '' || Number.isNaN(Number(rawIndex)) ? null : Number(rawIndex),
  };
}

export function validateEpub(input) {
  const errors = [];
  const warnings = [];
  let zip;
  try { zip = openZip(input); } catch (error) {
    return { valid: false, errors: [error.message], warnings };
  }

  const mimetype = zip.getEntry('mimetype');
  if (!mimetype) warnings.push('EPUB mimetype entry is missing.');
  else if (mimetype.getData().toString('utf8').trim() !== 'application/epub+zip') {
    errors.push('EPUB mimetype entry is invalid.');
  }

  try {
    const { packageNode } = packageDocument(zip);
    const metadata = packageNode.metadata || {};
    if (!clean(text(metadata['dc:title']))) warnings.push('EPUB title is missing.');
    if (!unique(metadata['dc:creator']).length) warnings.push('EPUB author is missing.');
    if (!clean(text(metadata['dc:language']))) warnings.push('EPUB language is missing.');
    if (!asArray(packageNode.manifest?.item).length) errors.push('EPUB manifest is empty.');
    if (!asArray(packageNode.spine?.itemref).length) warnings.push('EPUB spine is empty.');
  } catch (error) {
    errors.push(error.message);
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function readEpub(input) {
  const zip = openZip(input);
  const validation = validateEpub(zip);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  const { opfPath, packageNode } = packageDocument(zip);
  const metadata = packageNode.metadata || {};
  const isbn = asArray(metadata['dc:identifier'])
    .map(text).map(normalizeIsbn).find(Boolean) || '';

  return {
    metadata: {
      title: clean(text(metadata['dc:title'])),
      authors: unique(metadata['dc:creator']),
      language: clean(text(metadata['dc:language'])),
      publisher: clean(text(metadata['dc:publisher'])),
      description: clean(text(metadata['dc:description'])),
      subjects: unique(metadata['dc:subject']),
      isbn,
      ...seriesInfo(metadata),
    },
    cover: coverInfo(zip, opfPath, packageNode),
    opfPath,
    validation,
  };
}

function setValue(metadata, key, value) {
  if (value === undefined) return;
  const normalized = clean(value);
  if (value === null || normalized === '') delete metadata[key];
  else metadata[key] = normalized;
}

export function writeEpub(input, patch, options = {}) {
  const zip = openZip(input);
  const validation = validateEpub(zip);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  const { opfPath, parsed, packageNode } = packageDocument(zip);
  const metadata = packageNode.metadata || (packageNode.metadata = {});

  setValue(metadata, 'dc:title', patch.title);
  if (patch.authors !== undefined) metadata['dc:creator'] = unique(patch.authors);
  setValue(metadata, 'dc:language', patch.language);
  setValue(metadata, 'dc:publisher', patch.publisher);
  setValue(metadata, 'dc:description', patch.description);
  if (patch.subjects !== undefined || patch.tags !== undefined) {
    metadata['dc:subject'] = unique(patch.subjects ?? patch.tags ?? []);
  }

  if (patch.isbn !== undefined) {
    const identifiers = asArray(metadata['dc:identifier'])
      .filter(identifier => !normalizeIsbn(text(identifier)));
    const isbn = normalizeIsbn(patch.isbn);
    if (isbn) identifiers.push(isbn);
    metadata['dc:identifier'] = identifiers;
  }

  if (patch.series !== undefined || patch.seriesIndex !== undefined) {
    metadata.meta = asArray(metadata.meta).filter(item =>
      item?.['@_name'] !== 'calibre:series' &&
      item?.['@_name'] !== 'calibre:series_index' &&
      item?.['@_property'] !== 'belongs-to-collection' &&
      item?.['@_property'] !== 'collection-type' &&
      item?.['@_property'] !== 'group-position'
    );
    const series = clean(patch.series);
    if (series) {
      metadata.meta.push(
        { '@_name': 'calibre:series', '@_content': series },
        { '#text': series, '@_property': 'belongs-to-collection', '@_id': 'kindred-series' },
        { '#text': 'series', '@_property': 'collection-type', '@_refines': '#kindred-series' },
      );
      if (patch.seriesIndex != null && Number.isFinite(Number(patch.seriesIndex))) {
        const index = String(Number(patch.seriesIndex));
        metadata.meta.push(
          { '@_name': 'calibre:series_index', '@_content': index },
          { '#text': index, '@_property': 'group-position', '@_refines': '#kindred-series' },
        );
      }
    }
  }

  if (options.cover?.bytes) {
    const cover = coverInfo(zip, opfPath, packageNode);
    if (!cover) throw new Error('Cannot replace cover: EPUB has no manifest cover image.');
    zip.updateFile(cover.path, Buffer.from(options.cover.bytes));
  }

  zip.updateFile(opfPath, Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(parsed)}`));
  const output = zip.toBuffer();
  const outputValidation = validateEpub(output);
  if (!outputValidation.valid) {
    throw new Error(`EPUB write produced an invalid archive: ${outputValidation.errors.join(' ')}`);
  }
  return output;
}

export function verifyEpubMetadata(input, expected) {
  const actual = readEpub(input).metadata;
  const fields = {
    title: clean,
    authors: unique,
    language: clean,
    publisher: clean,
    description: clean,
    subjects: unique,
    isbn: normalizeIsbn,
    series: clean,
    seriesIndex: value => value == null ? null : Number(value),
  };
  const mismatches = [];
  for (const [field, normalize] of Object.entries(fields)) {
    if (!(field in expected) && !(field === 'subjects' && 'tags' in expected)) continue;
    const wanted = normalize(field === 'subjects' ? expected.subjects ?? expected.tags : expected[field]);
    const found = normalize(actual[field]);
    if (JSON.stringify(wanted) !== JSON.stringify(found)) {
      mismatches.push({ field, expected: wanted, actual: found });
    }
  }
  return { valid: mismatches.length === 0, mismatches, metadata: actual };
}
