export function defineMetadataPlugin(plugin) {
  if (!plugin || typeof plugin !== 'object') {
    throw new TypeError('Metadata plugin must be an object.');
  }
  if (!String(plugin.id || '').trim()) {
    throw new TypeError('Metadata plugin requires a non-empty id.');
  }
  if (typeof plugin.search !== 'function' && typeof plugin.enrich !== 'function') {
    throw new TypeError(`Metadata plugin "${plugin.id}" requires search() or enrich().`);
  }

  return Object.freeze({
    priority: 0,
    enabled: true,
    ...plugin,
    priority: Number(plugin.priority) || 0,
  });
}

export function createPluginRegistry() {
  const plugins = new Map();

  const ordered = () =>
    [...plugins.values()]
      .filter(plugin => plugin.enabled !== false)
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  return {
    register(plugin) {
      const validated = defineMetadataPlugin(plugin);
      if (plugins.has(validated.id)) {
        throw new Error(`Metadata plugin "${validated.id}" is already registered.`);
      }
      plugins.set(validated.id, validated);
      return validated;
    },

    get(id) {
      const plugin = plugins.get(id);
      if (!plugin) throw new Error(`Unknown metadata plugin "${id}".`);
      return plugin;
    },

    list: ordered,

    async search(query, context = {}) {
      const results = [];
      const errors = [];

      for (const plugin of ordered()) {
        if (typeof plugin.search !== 'function') continue;
        try {
          const found = await plugin.search(query, context);
          for (const result of found || []) {
            results.push({ ...result, providerId: result.providerId || plugin.id });
          }
        } catch (error) {
          errors.push({ pluginId: plugin.id, message: error.message });
        }
      }

      return { results, errors };
    },

    async enrich(book, context = {}) {
      let current = book;
      const history = [];
      const errors = [];

      for (const plugin of ordered()) {
        if (typeof plugin.enrich !== 'function') continue;
        try {
          const next = await plugin.enrich(current, context);
          if (next) {
            current = next;
            history.push(plugin.id);
          }
        } catch (error) {
          errors.push({ pluginId: plugin.id, message: error.message });
        }
      }

      return { book: current, history, errors };
    },
  };
}
