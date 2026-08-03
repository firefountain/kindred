import express from 'express';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createLibraryStore } from './libraryStore.js';

const METADATA_FIELDS = [
  'title', 'subtitle', 'authors', 'isbn', 'asin', 'publisher', 'language',
  'description', 'coverUrl', 'series', 'seriesIndex', 'tags', 'collections',
];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function metadataSnapshot(item = {}) {
  return Object.fromEntries(METADATA_FIELDS.map(field => [field, clone(item[field])]).filter(([, value]) => value !== undefined));
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function defaultDataDir() {
  if (process.env.KINDRED_DATA_DIR) return path.resolve(process.env.KINDRED_DATA_DIR);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Kindred');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Kindred');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'kindred');
}

function resolveLibrary(store, libraryId) {
  return libraryId ? store.get(libraryId) : store.active();
}

function persist(store, libraryId, itemId, body = {}) {
  const library = resolveLibrary(store, libraryId);
  const current = library?.items?.find(item => item.id === itemId);
  if (!current) return null;

  const incoming = body.metadata || body || {};
  const previous = metadataSnapshot(current);
  const next = { ...previous };
  for (const field of METADATA_FIELDS) {
    if (field in incoming) next[field] = clone(incoming[field]);
  }

  const provenance = clone(body.provenance || incoming.metadataProvenance || current.metadataProvenance || {});
  const decisions = clone(body.decisions || incoming.metadataDecisions || []);
  const conflicts = clone(body.conflicts || incoming.metadataConflicts || []);
  const selectedCover = clone(body.selectedCover || incoming.selectedCover || null);
  const changed = !same(previous, next)
    || !same(current.metadataProvenance || {}, provenance)
    || !same(current.selectedCover || null, selectedCover);

  if (!changed) return { item: current, historyEntry: null, changed: false };

  const historyEntry = {
    id: `metadata_${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    source: String(body.source || 'Kindred metadata inspector'),
    previous,
    next,
    decisions,
    providers: clone(body.providers || []),
    conflicts,
  };

  const item = store.updateItem(library.id, itemId, {
    ...next,
    metadataProvenance: provenance,
    metadataDecisions: decisions,
    metadataConflicts: conflicts,
    selectedCover,
    metadataHistory: [...(current.metadataHistory || []), historyEntry],
    metadataUpdatedAt: historyEntry.timestamp,
  });

  return { item, historyEntry, changed: true };
}

export function createLibraryMetadataRouter(options = {}) {
  const store = options.store || createLibraryStore(options.dataDir || defaultDataDir());
  const router = express.Router();

  router.put('/:libraryId/items/:itemId', (req, res) => {
    const result = persist(store, req.params.libraryId, req.params.itemId, req.body);
    if (!result) return res.status(404).json({ error: 'Library item not found' });
    return res.json(result);
  });

  router.put('/items/:itemId', (req, res) => {
    const result = persist(store, '', req.params.itemId, req.body);
    if (!result) return res.status(404).json({ error: 'Active library item not found' });
    return res.json(result);
  });

  router.get('/:libraryId/items/:itemId/history', (req, res) => {
    const library = store.get(req.params.libraryId);
    const item = library?.items?.find(value => value.id === req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Library item not found' });
    return res.json({ libraryId: library.id, itemId: item.id, history: item.metadataHistory || [] });
  });

  router.get('/items/:itemId/history', (req, res) => {
    const library = store.active();
    const item = library?.items?.find(value => value.id === req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Active library item not found' });
    return res.json({ libraryId: library.id, itemId: item.id, history: item.metadataHistory || [] });
  });

  return router;
}
