import AdmZip from 'adm-zip';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: false,
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressEmptyNode: false,
});

function scalar(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return scalar(value[0]);
  if (typeof value === 'object') return String(value['#text'] ?? '');
  return String(value);
}

function array(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

function normalizeIsbn(value) {
  const candidate = String(value || '').replace(/[^0-9X]/gi, '');
  return /^(?:\d{9}[\dX]|97[89]\d{10})$/i.test(candidate) ? candidate : '';
}

function findOpfPath(zip) {
  const entry = zip.getEntry('META-INF/container.xml');
  if (!entry) throw new Error('Invalid EPUB: META-INF/container.xml is missing.');
  const container = parser.parse(entry.getData().toString('utf8'));
  const rootfiles = array(container?.container?.rootfiles?.rootfile);
  const opfPath = rootfiles[0]?.['@_full-path'];
  if (!opfPath || !zip.getEntry(opfPath)) throw new Error('Invalid EPUB: OPF package was not found.');
  return opfPath;
}

function findIsbn(metadata) {
  return array(metadata['dc:identifier'])
    .map(scalar)
    .map(normalizeIsbn)
    .find(Boolean) || '';
}

function findSeries(metadata) {
  const metas = array(metadata.meta);
  const calibreSeries = metas.find(item => item?.['@_name'] === 'calibre:series');
  const calibreIndex = metas.find(item => item?.['@_name'] === 'calibre:series_index');
  const belongs = metas.find(item => item?.['@_property'] === 'belongs-to-collection');
  const groupPosition = metas.find(item => item?.['@_property'] === 'group-position');
  return {
    series: scalar(calibreSeries?.['@_content'] || belongs),
    seriesIndex: Number(scalar(calibreIndex?.['@_content'] || groupPosition)) || null,
  };
}

function locateCover(zip, opfPath, packageNode) {
  const metadata = packageNode.metadata || {};
  const manifestItems = array(packageNode.manifest?.item);
  const coverMeta = array(metadata.meta).find(item => item?.['@_name'] === 'cover');
  const coverId = coverMeta?.['@_content'];
  const coverItem = manifestItems.find(item =>
    item?.['@_id'] === coverId || String(item?.['@_properties'] || '').split(/\s+/).includes('cover-image')
  );
  if (!coverItem?.['@_href']) return null;
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const coverPath = decodeURIComponent(`${base}${coverItem['@_href']}`).replace(/\\/g, '/');
  const entry = zip.getEntry(coverPath);
  return entry ? { path: coverPath, mediaType: coverItem['@_media-type'] || 'image/jpeg', bytes: entry.getData() } : null;
}

export function readEpub(input) {
  const zip = input instanceof AdmZip ? input : new AdmZip(input);
  const opfPath = findOpfPath(zip);
  const parsed = parser.parse(zip.getEntry(opfPath).getData().toString('utf8'));
  const packageNode = parsed.package || {};
  const metadata = packageNode.metadata || {};
  const series = findSeries(metadata);
  const cover = locateCover(zip, opfPath, packageNode);
  return {
    metadata: {
      title: scalar(metadata['dc:title']),
      authors: array(metadata['dc:creator']).map(scalar).filter(Boolean),
      language: scalar(metadata['dc:language']),
      publisher: scalar(metadata['dc:publisher']),
      description: scalar(metadata['dc:description']),
      subjects: array(metadata['dc:subject']).map(scalar).filter(Boolean),
      isbn: findIsbn(metadata),
      ...series,
    },
    cover,
    opfPath,
  };
}

function setScalar(metadata, key, value) {
  if (value === undefined) return;
  if (value === null || value === '') delete metadata[key];
  else metadata[key] = value;
}

function removeMeta(metadata, predicate) {
  metadata.meta = array(metadata.meta).filter(item => !predicate(item));
}

function addMeta(metadata, value) {
  metadata.meta = [...array(metadata.meta), value];
}

export function writeEpub(input, patch, options = {}) {
  const zip = new AdmZip(input);
  const opfPath = findOpfPath(zip);
  const parsed = parser.parse(zip.getEntry(opfPath).getData().toString('utf8'));
  const packageNode = parsed.package || {};
  const metadata = packageNode.metadata || (packageNode.metadata = {});

  setScalar(metadata, 'dc:title', patch.title);
  if (patch.authors !== undefined) metadata['dc:creator'] = patch.authors.filter(Boolean);
  setScalar(metadata, 'dc:language', patch.language);
  setScalar(metadata, 'dc:publisher', patch.publisher);
  setScalar(metadata, 'dc:description', patch.description);
  if (patch.subjects !== undefined || patch.tags !== undefined) {
    metadata['dc:subject'] = (patch.subjects || patch.tags || []).filter(Boolean);
  }

  if (patch.isbn !== undefined) {
    const identifiers = array(metadata['dc:identifier']).filter(item => !normalizeIsbn(scalar(item)));
    if (patch.isbn) identifiers.push(normalizeIsbn(patch.isbn) || patch.isbn);
    metadata['dc:identifier'] = identifiers;
  }

  if (patch.series !== undefined || patch.seriesIndex !== undefined) {
    removeMeta(metadata, item =>
      item?.['@_name'] === 'calibre:series' ||
      item?.['@_name'] === 'calibre:series_index' ||
      item?.['@_property'] === 'belongs-to-collection' ||
      item?.['@_property'] === 'group-position'
    );
    if (patch.series) {
      addMeta(metadata, { '@_name': 'calibre:series', '@_content': patch.series });
      addMeta(metadata, { '#text': patch.series, '@_property': 'belongs-to-collection', '@_id': 'kindred-series' });
      addMeta(metadata, { '#text': 'series', '@_property': 'collection-type', '@_refines': '#kindred-series' });
    }
    if (patch.seriesIndex != null) {
      addMeta(metadata, { '@_name': 'calibre:series_index', '@_content': String(patch.seriesIndex) });
      addMeta(metadata, { '#text': String(patch.seriesIndex), '@_property': 'group-position', '@_refines': '#kindred-series' });
    }
  }

  if (options.cover?.bytes) {
    const existing = locateCover(zip, opfPath, packageNode);
    if (existing) zip.updateFile(existing.path, Buffer.from(options.cover.bytes));
  }

  zip.updateFile(opfPath, Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(parsed)}`));
  return zip.toBuffer();
}
