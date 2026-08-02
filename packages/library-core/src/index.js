import { normalizeMetadata } from '@kindred/metadata-core';

export function createLibraryItem(input = {}) {
  const metadata = normalizeMetadata(input.metadata ?? input);
  const files = normalizeFiles(input.files ?? []);
  const deviceLinks = normalizeDeviceLinks(input.deviceLinks ?? []);

  return {
    id: String(input.id || crypto.randomUUID()),
    type: input.type || 'book',
    metadata,
    files,
    cover: input.cover ?? metadata.cover ?? null,
    collections: [...new Set(input.collections ?? metadata.collections ?? [])],
    readingState: {
      status: 'unread',
      progress: 0,
      ...(input.readingState ?? {}),
    },
    deviceLinks,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

export function normalizeFiles(files) {
  return files.map(file => ({
    id: String(file.id || crypto.randomUUID()),
    format: String(file.format || '').toLowerCase(),
    path: file.path || '',
    size: Number(file.size) || 0,
    hash: file.hash || '',
    canonical: Boolean(file.canonical),
    source: file.source || 'local',
    ...file,
  }));
}

export function normalizeDeviceLinks(links) {
  return links.map(link => ({
    deviceId: String(link.deviceId || ''),
    remoteId: String(link.remoteId || ''),
    path: link.path || '',
    syncStatus: link.syncStatus || 'unknown',
    lastSyncedAt: link.lastSyncedAt || null,
    ...link,
  }));
}

export function addFile(item, file) {
  const next = createLibraryItem(item);
  const normalized = normalizeFiles([file])[0];
  const duplicateIndex = next.files.findIndex(existing =>
    (normalized.hash && existing.hash === normalized.hash) ||
    (normalized.path && existing.path === normalized.path),
  );

  if (duplicateIndex >= 0) next.files[duplicateIndex] = normalized;
  else next.files.push(normalized);

  if (normalized.canonical) {
    next.files = next.files.map(entry => ({
      ...entry,
      canonical: entry.id === normalized.id,
    }));
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

export function linkDevice(item, link) {
  const next = createLibraryItem(item);
  const normalized = normalizeDeviceLinks([link])[0];
  const index = next.deviceLinks.findIndex(existing => existing.deviceId === normalized.deviceId);

  if (index >= 0) next.deviceLinks[index] = normalized;
  else next.deviceLinks.push(normalized);

  next.updatedAt = new Date().toISOString();
  return next;
}

export function canonicalFile(item) {
  return item.files.find(file => file.canonical) ||
    item.files.find(file => file.format === 'epub') ||
    item.files[0] ||
    null;
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
    if (!item.metadata?.title || !(item.metadata?.authors || []).length) missingMetadata += 1;
    if ((item.deviceLinks || []).some(link => link.syncStatus !== 'synced')) unsynced += 1;
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
