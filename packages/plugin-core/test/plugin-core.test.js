import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPluginRegistry,
  defineMetadataPlugin,
} from '../src/index.js';

test('validates plugin contracts', () => {
  assert.throws(
    () => defineMetadataPlugin({ id: 'broken' }),
    /requires search\(\) or enrich\(\)/,
  );

  const plugin = defineMetadataPlugin({
    id: 'open-library',
    async search() {
      return [];
    },
  });

  assert.equal(plugin.id, 'open-library');
});

test('registers plugins and rejects duplicate ids', () => {
  const registry = createPluginRegistry();

  registry.register({
    id: 'open-library',
    async search() {
      return [];
    },
  });

  assert.equal(registry.has('open-library'), true);
  assert.equal(registry.get('open-library').id, 'open-library');

  assert.throws(
    () => registry.register({
      id: 'open-library',
      async search() {
        return [];
      },
    }),
    /already registered/,
  );
});

test('executes enabled plugins by priority', async () => {
  const registry = createPluginRegistry();
  const order = [];

  registry.register({
    id: 'low',
    priority: 10,
    async enrich(book) {
      order.push('low');
      return { ...book, low: true };
    },
  });

  registry.register({
    id: 'high',
    priority: 100,
    async enrich(book) {
      order.push('high');
      return { ...book, high: true };
    },
  });

  registry.register({
    id: 'disabled',
    enabled: false,
    priority: 1000,
    async enrich(book) {
      order.push('disabled');
      return book;
    },
  });

  const result = await registry.enrich({ title: 'World War Z' });

  assert.deepEqual(order, ['high', 'low']);
  assert.deepEqual(result.history, ['high', 'low']);
  assert.equal(result.book.high, true);
  assert.equal(result.book.low, true);
});

test('isolates search failures and keeps useful results', async () => {
  const registry = createPluginRegistry();

  registry.register({
    id: 'broken',
    priority: 100,
    async search() {
      throw new Error('Provider unavailable.');
    },
  });

  registry.register({
    id: 'working',
    async search() {
      return [{ title: 'World War Z' }];
    },
  });

  const result = await registry.search({
    title: 'World War Z',
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].providerId, 'working');
  assert.deepEqual(result.errors, [{
    pluginId: 'broken',
    message: 'Provider unavailable.',
  }]);
});

test('unregisters plugins', () => {
  const registry = createPluginRegistry();

  registry.register({
    id: 'temporary',
    async search() {
      return [];
    },
  });

  assert.equal(registry.unregister('temporary'), true);
  assert.equal(registry.has('temporary'), false);
});
