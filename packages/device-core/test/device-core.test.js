import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDeviceRegistry,
  defineDeviceAdapter,
  DeviceCapability,
} from '../src/index.js';

function adapter(id = 'test') {
  return {
    id,
    capabilities: [DeviceCapability.LIST, DeviceCapability.UPLOAD],
    async detect({ connected }) { return connected; },
    async scan() { return { id }; },
    async listBooks() { return []; },
    async upload() {},
    async remove() {},
  };
}

test('validates adapters clearly', () => {
  assert.throws(() => defineDeviceAdapter({ id: 'broken' }), /requires scan/);
  assert.equal(defineDeviceAdapter(adapter()).id, 'test');
});

test('registers and detects adapters', async () => {
  const registry = createDeviceRegistry();
  registry.register(adapter('kindle'));
  assert.equal(registry.get('kindle').id, 'kindle');
  assert.deepEqual((await registry.detect({ connected: true })).map(x => x.id), ['kindle']);
});

test('prevents duplicate adapter ids', () => {
  const registry = createDeviceRegistry();
  registry.register(adapter());
  assert.throws(() => registry.register(adapter()), /already registered/);
});
