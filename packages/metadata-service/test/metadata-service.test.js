import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginRegistry } from '@kindred/plugin-core';
import { createMetadataService } from '../src/index.js';

function registryWith(...plugins) {
  const registry = createPluginRegistry();
  for (const plugin of plugins) registry.register(plugin);
  return registry;
}

test('queries providers concurrently and resolves metadata', async () => {
  const registry = registryWith(
    {
      id: 'openLibrary',
      priority: 700,
      async search() {
        await new Promise(resolve => setTimeout(resolve, 20));
        return [{
          id: 'ol',
          providerId: 'openLibrary',
          confidence: 0.9,
          metadata: {
            title: 'World War Z',
            authors: ['Max Brooks'],
            tags: ['Horror'],
          },
        }];
      },
    },
    {
      id: 'googleBooks',
      priority: 650,
      async search() {
        await new Promise(resolve => setTimeout(resolve, 20));
        return [{
          id: 'gb',
          providerId: 'googleBooks',
          confidence: 0.95,
          metadata: {
            title: 'World War Z',
            publisher: 'Crown',
            tags: ['Zombies'],
          },
        }];
      },
    },
  );

  const service = createMetadataService({ registry });
  const result = await service.search({
    title: 'World War Z',
    authors: ['Max Brooks'],
  });

  assert.equal(result.candidates.length, 2);
  assert.equal(result.resolution.metadata.title, 'World War Z');
  assert.equal(result.resolution.metadata.publisher, 'Crown');
  assert.deepEqual(result.resolution.metadata.tags, ['Horror', 'Zombies']);
  assert.equal(result.providers.length, 2);
  assert.equal(result.errors.length, 0);
});

test('isolates provider failures', async () => {
  const registry = registryWith(
    {
      id: 'broken',
      priority: 1000,
      async search() {
        throw new Error('Provider exploded.');
      },
    },
    {
      id: 'working',
      async search() {
        return [{
          providerId: 'working',
          confidence: 0.8,
          metadata: {
            title: 'World War Z',
          },
        }];
      },
    },
  );

  const service = createMetadataService({ registry });
  const result = await service.search({ title: 'World War Z' });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].providerId, 'broken');
  assert.equal(result.resolution.metadata.title, 'World War Z');
});

test('enrich protects embedded metadata while filling holes', async () => {
  const registry = registryWith({
    id: 'googleBooks',
    priority: 650,
    async search() {
      return [{
        providerId: 'googleBooks',
        confidence: 1,
        metadata: {
          title: 'Provider title',
          publisher: 'Crown',
          tags: ['Horror'],
        },
      }];
    },
  });

  const service = createMetadataService({ registry });
  const result = await service.enrich({
    id: 'book-1',
    metadata: {
      title: 'Embedded title',
      authors: ['Max Brooks'],
    },
  });

  assert.equal(result.resolution.metadata.title, 'Embedded title');
  assert.equal(result.resolution.metadata.publisher, 'Crown');
  assert.equal(result.resolution.provenance.title.source, 'embedded');
});

test('manual metadata remains authoritative', async () => {
  const registry = registryWith({
    id: 'openLibrary',
    async search() {
      return [{
        providerId: 'openLibrary',
        confidence: 1,
        metadata: {
          title: 'Provider title',
        },
      }];
    },
  });

  const service = createMetadataService({ registry });
  const result = await service.enrich(
    {
      metadata: {
        title: 'Chosen title',
      },
    },
    {
      baseSource: 'manual',
      baseConfidence: 1,
    },
  );

  assert.equal(result.resolution.metadata.title, 'Chosen title');
  assert.equal(result.resolution.provenance.title.source, 'manual');
});

test('returns provider timing and result counts', async () => {
  const registry = registryWith({
    id: 'provider',
    async search() {
      return [
        { providerId: 'provider', metadata: { title: 'One' } },
        { providerId: 'provider', metadata: { title: 'Two' } },
      ];
    },
  });

  const service = createMetadataService({ registry });
  const result = await service.search({ title: 'Book' });

  assert.equal(result.providers[0].resultCount, 2);
  assert.equal(typeof result.providers[0].durationMs, 'number');
  assert.equal(typeof result.durationMs, 'number');
});

test('supports an injected fetch for default providers', () => {
  const service = createMetadataService({
    fetch: async () => ({
      ok: true,
      async json() {
        return { docs: [], items: [] };
      },
    }),
  });

  assert.deepEqual(
    service.registry.list().map(provider => provider.id),
    ['openLibrary', 'googleBooks'],
  );
});
