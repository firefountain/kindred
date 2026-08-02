const REQUIRED_METHODS = ['scan', 'listBooks', 'upload', 'remove'];

export function defineDeviceAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new TypeError('Device adapter must be an object.');
  }
  if (!String(adapter.id || '').trim()) {
    throw new TypeError('Device adapter requires a non-empty id.');
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== 'function') {
      throw new TypeError(`Device adapter "${adapter.id}" requires ${method}().`);
    }
  }
  return Object.freeze({
    capabilities: [],
    ...adapter,
    capabilities: [...new Set(adapter.capabilities || [])],
  });
}

export function createDeviceRegistry() {
  const adapters = new Map();

  return {
    register(adapter) {
      const validated = defineDeviceAdapter(adapter);
      if (adapters.has(validated.id)) {
        throw new Error(`Device adapter "${validated.id}" is already registered.`);
      }
      adapters.set(validated.id, validated);
      return validated;
    },

    unregister(id) {
      return adapters.delete(id);
    },

    get(id) {
      const adapter = adapters.get(id);
      if (!adapter) throw new Error(`Unknown device adapter "${id}".`);
      return adapter;
    },

    list() {
      return [...adapters.values()];
    },

    async detect(context = {}) {
      const matches = [];
      for (const adapter of adapters.values()) {
        if (typeof adapter.detect !== 'function') continue;
        if (await adapter.detect(context)) matches.push(adapter);
      }
      return matches;
    },
  };
}

export const DeviceCapability = Object.freeze({
  LIST: 'list',
  UPLOAD: 'upload',
  REMOVE: 'remove',
  METADATA_WRITE: 'metadata-write',
  COVER_WRITE: 'cover-write',
  READING_STATE: 'reading-state',
  EJECT: 'eject',
});
