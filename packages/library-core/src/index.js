import { normalizeMetadata } from '@kindred/metadata-core';

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function unique(values) {
  return [...new Set((values || []).map(value => String(value).trim()).filter(Boolean))];
}

export function normalizeLibraryFile(file = {}) {
  return {
    id: String(file.id || newId('file')),
    format: String(file.format || '').trim().toLowerCase(),
    path: String(file.path || ''),
    fileName: String(file.fileName || ''),
    size: Number(file.size) || 0,
    hash: String(file.hash || ''),
    canonical: Boolean(file.canonical),
    source: String(file.source || 'local'),
    createdAt: file.createdAt || new Date().toISOString(),
    updatedAt: file.updatedAt || new Date().toISOString(),
  };
}

export function normalizeDeviceLink(link = {}) {
  return {
    deviceId: String(link.deviceId || ''),
    remoteId: String(link.remoteId || ''),
    path: String(link.path || ''),
    format: String(link.format || '').toLowerCase(),
    syncStatus: String(link.syncStatus || 'unknown'),
    lastSyncedAt: link.lastSyncedAt || null,
  };
}

export function createLibraryItem(input = {}) {
  const metadata = normalizeMetadata(input.metadata ?? input);
  const files = (input.files || []).map(normalizeLibraryFile);
  const deviceLinks = (input.deviceLinks || []).map(normalizeDeviceLink);

  return {
    id: String(input.id || newId('book')),
    type: String(input.type || 'book'),
    metadata,
    files,
    cover: input.cover ?? metadata.cover ?? null,
    collections: unique(input.collections ?? metadata.collections),
    readingState: {
      status: 'unread',
      progress: 0,
      rating: null,
      startedAt: null,
      finishedAt: null,
      ...(input.readingState || {}),
    },
    deviceLinks,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

export function addFile(item, file) {
  const next = createLibraryItem(item);
  const incoming = normalizeLibraryFile(file);

  const index = next.files.findIndex(existing =>
    existing.id === incoming.id ||
    (incoming.hash && existing.hash === incoming.hash) ||
    (incoming.path && existing.path === incoming.path),
  );

  if (index >= 0) next.files[index] = incoming;
  else next.files.push(incoming);

  if (incoming.canonical) {
    next.files = next.files.map(existing => ({
      ...existing,
      canonical: existing.id === incoming.id,
    }));
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

export function removeFile(item, fileId) {
  const next = createLibraryItem(item);
  next.files = next.files.filter(file => file.id !== fileId);
  next.updatedAt = new Date().toISOString();
  return next;
}

export function canonicalFile(item) {
  return item.files?.find(file => file.canonical)
    || item.files?.find(file => file.format === 'epub')
    || item.files?.[0]
    || null;
}

export function linkDevice(item, link) {
  const next = createLibraryItem(item);
  const incoming = normalizeDeviceLink(link);

  if (!incoming.deviceId) {
    throw new Error('Device link requires deviceId.');
  }

  const index = next.deviceLinks.findIndex(existing =>
    existing.deviceId === incoming.deviceId &&
    (!incoming.remoteId || existing.remoteId === incoming.remoteId),
  );

  if (index >= 0) next.deviceLinks[index] = incoming;
  else next.deviceLinks.push(incoming);

  next.updatedAt = new Date().toISOString();
  return next;
}

export function unlinkDevice(item, deviceId, remoteId = '') {
  const next = createLibraryItem(item);
  next.deviceLinks = next.deviceLinks.filter(link =>
    link.deviceId !== deviceId || (remoteId && link.remoteId !== remoteId),
  );
  next.updatedAt = new Date().toISOString();
  return next;
}

export function libraryStats(items = []) {
  const authors = new Set();
  const series = new Set();
  const collections = new Set();

  let missingCover = 0;
  let missingMetadata = 0;
  let unsynced = 0;

  for (const item of items) {
    for (const author of item.metadata?.authors || []) authors.add(author);
    if (item.metadata?.series) series.add(item.metadata.series);
    for (const collection of item.collections || []) collections.add(collection);

    if (!item.cover && !item.metadata?.cover) missingCover += 1;
    if (!item.metadata?.title || !(item.metadata?.authors || []).length) {
      missingMetadata += 1;
    }

    if ((item.deviceLinks || []).some(link => link.syncStatus !== 'synced')) {
      unsynced += 1;
    }
  }

  return {
    books: items.filter(item => item.type === 'book').length,
    authors: authors.size,
    series: series.size,
    collections: collections.size,
    missingCover,
    missingMetadata,
    unsynced,
  };
}
