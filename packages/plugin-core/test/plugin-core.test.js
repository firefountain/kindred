import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginRegistry, defineMetadataPlugin } from '../src/index.js';

test('validates plugins', () => {
  assert.throws(() => defineMetadataPlugin({ id: 'broken' }), /requires search/);
});

test('runs plugins by priority', async () => {
  const registry = createPluginRegistry();
  const order = [];

  registry.register({
    id: 'low',
    priority: 10,
    async enrich(book) { order.push('low'); return { ...book, low: true }; },
  });
  registry.register({
    id: 'high',
    priority: 100,
    async enrich(book) { order.push('high'); return { ...book, high: true }; },
  });

  const result = await registry.enrich({ title: 'Book' });
  assert.deepEqual(order, ['high', 'low']);
  assert.deepEqual(result.history, ['high', 'low']);
});

test('isolates plugin failures', async () => {
  const registry = createPluginRegistry();
  registry.register({
    id: 'broken',
    priority: 100,
    async search() { throw new Error('No internet for you.'); },
  });
  registry.register({
    id: 'working',
    async search() { return [{ title: 'World War Z' }]; },
  });

  const result = await registry.search({ title: 'World War Z' });
  assert.equal(result.results[0].providerId, 'working');
  assert.equal(result.errors[0].pluginId, 'broken');
});
