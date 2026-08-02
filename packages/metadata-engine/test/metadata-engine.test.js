import assert from 'node:assert/strict';
import test from 'node:test';
import {
  metadataCandidates,
  rankCoverCandidates,
  resolveMetadata,
} from '../src/index.js';

test('turns provider records into field candidates', () => {
  const candidates = metadataCandidates({
    id: 'open-library-1',
    providerId: 'openLibrary',
    confidence: 0.9,
    metadata: {
      title: 'World War Z',
      authors: ['Max Brooks'],
      isbn: '9780307351937',
    },
  });

  assert.deepEqual(
    candidates.map(candidate => candidate.field),
    ['title', 'isbn', 'authors', 'identifiers.isbn'],
  );
  assert.equal(candidates[0].source, 'openLibrary');
});

test('protects manual values from providers', () => {
  const result = resolveMetadata([
    {
      source: 'manual',
      confidence: 1,
      metadata: {
        title: 'World War Z: An Oral History',
      },
    },
    {
      providerId: 'openLibrary',
      confidence: 1,
      metadata: {
        title: 'World War Z',
      },
    },
  ]);

  assert.equal(result.metadata.title, 'World War Z: An Oral History');
  assert.equal(result.provenance.title.source, 'manual');
  assert.equal(result.decisions[0].reason, 'manual-value-protected');
});

test('uses weighted confidence for scalar fields', () => {
  const result = resolveMetadata([
    {
      source: 'filename',
      confidence: 1,
      metadata: {
        title: 'world_war_z_final',
      },
    },
    {
      providerId: 'openLibrary',
      confidence: 0.7,
      metadata: {
        title: 'World War Z',
      },
    },
  ]);

  assert.equal(result.metadata.title, 'World War Z');
  assert.equal(result.provenance.title.source, 'openLibrary');
});

test('merges tags and collections without duplicates', () => {
  const result = resolveMetadata([
    {
      providerId: 'openLibrary',
      confidence: 0.8,
      metadata: {
        tags: ['Horror', 'Zombies'],
        collections: ['Unread'],
      },
    },
    {
      providerId: 'googleBooks',
      confidence: 0.9,
      metadata: {
        tags: ['Zombies', 'Post-apocalyptic'],
        collections: ['Unread', 'Fiction'],
      },
    },
  ]);

  assert.deepEqual(result.metadata.tags, [
    'Horror',
    'Zombies',
    'Post-apocalyptic',
  ]);
  assert.deepEqual(result.metadata.collections, [
    'Unread',
    'Fiction',
  ]);
  assert.equal(result.provenance.tags.source, 'merged');
});

test('reports identifier conflicts instead of hiding them', () => {
  const result = resolveMetadata([
    {
      providerId: 'openLibrary',
      confidence: 0.9,
      metadata: {
        identifiers: {
          goodreads: '123',
        },
      },
    },
    {
      providerId: 'googleBooks',
      confidence: 0.8,
      metadata: {
        identifiers: {
          goodreads: '456',
        },
      },
    },
  ]);

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].field, 'identifiers.goodreads');
});

test('ranks higher-resolution covers while respecting source quality', () => {
  const ranked = rankCoverCandidates([
    {
      source: 'googleBooks',
      confidence: 0.9,
      url: 'small.jpg',
      width: 300,
      height: 450,
    },
    {
      source: 'openLibrary',
      confidence: 0.8,
      url: 'large.jpg',
      width: 1000,
      height: 1500,
    },
  ]);

  assert.equal(ranked[0].url, 'large.jpg');
  assert.ok(ranked[0].score > ranked[1].score);
});

test('returns a complete decision trace', () => {
  const result = resolveMetadata([
    {
      providerId: 'openLibrary',
      confidence: 0.9,
      metadata: {
        title: 'World War Z',
        authors: ['Max Brooks'],
        publisher: 'Crown',
      },
    },
  ]);

  assert.deepEqual(
    result.decisions.map(decision => decision.field),
    ['title', 'publisher', 'authors'],
  );
});
