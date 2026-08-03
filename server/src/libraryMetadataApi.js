import express from 'express';
import crypto from 'node:crypto';

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

export function createLibraryMetadataRouter({ store }) {
  if (!store) throw new TypeError('Library metadata API requires a store.');
  const router = express.Router();

  router.put('/:libraryId/items/:itemId/metadata', (req, res) => {
    const library = store.get(req.params.libraryId);
    const current = library?.items?.find(item => item.id === req.params.itemId);
    if (!current) return res.status(404).json({ error: 'Library item not found' });

    const incoming = req.body?.metadata || req.body || {};
    const previous = metadataSnapshot(current);
    const next = { ...previous };
    for (const field of METADATA_FIELDS) {
      if (field in incoming) next[field] = clone(incoming[field]);
    }

    const provenance = clone(req.body?.provenance || incoming.metadataProvenance || current.metadataProvenance || {});
    const decisions = clone(req.body?.decisions || incoming.metadataDecisions || []);
    const conflicts = clone(req.body?.conflicts || incoming.metadataConflicts || []);
    const selectedCover = clone(req.body?.selectedCover || incoming.selectedCover || null);
    const changed = !same(previous, next)
      || !same(current.metadataProvenance || {}, provenance)
      || !same(current.selectedCover || null, selectedCover);

    if (!changed) {
      return res.json({ item: current, historyEntry: null, changed: false });
    }

    const historyEntry = {
      id: `metadata_${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
      source: String(req.body?.source || 'Kindred metadata inspector'),
      previous,
      next,
      decisions,
      providers: clone(req.body?.providers || []),
      conflicts,
    };

    const item = store.updateItem(req.params.libraryId, req.params.itemId, {
      ...next,
      metadataProvenance: provenance,
      metadataDecisions: decisions,
      metadataConflicts: conflicts,
      selectedCover,
      metadataHistory: [...(current.metadataHistory || []), historyEntry],
      metadataUpdatedAt: historyEntry.timestamp,
    });

    return res.json({ item, historyEntry, changed: true });
  });

  router.get('/:libraryId/items/:itemId/metadata/history', (req, res) => {
    const library = store.get(req.params.libraryId);
    const item = library?.items?.find(value => value.id === req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Library item not found' });
    return res.json({
      libraryId: req.params.libraryId,
      itemId: req.params.itemId,
      history: item.metadataHistory || [],
    });
  });

  return router;
}
