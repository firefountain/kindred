function normalizeId(value) {
  return String(value || '').trim();
}

export function defineMetadataPlugin(plugin) {
  if (!plugin || typeof plugin !== 'object') {
    throw new TypeError('Metadata plugin must be an object.');
  }

  const id = normalizeId(plugin.id);
  if (!id) {
    throw new TypeError('Metadata plugin requires a non-empty id.');
  }

  if (typeof plugin.search !== 'function' && typeof plugin.enrich !== 'function') {
    throw new TypeError(
      `Metadata plugin "${id}" requires search() or enrich().`,
    );
  }

  return Object.freeze({
    enabled: true,
    priority: 0,
    ...plugin,
    id,
    priority: Number(plugin.priority) || 0,
  });
}

export function createPluginRegistry() {
  const plugins = new Map();

  function ordered() {
    return [...plugins.values()]
      .filter(plugin => plugin.enabled !== false)
      .sort((left, right) =>
        right.priority - left.priority || left.id.localeCompare(right.id),
      );
  }

  return {
    register(plugin) {
      const validated = defineMetadataPlugin(plugin);

      if (plugins.has(validated.id)) {
        throw new Error(
          `Metadata plugin "${validated.id}" is already registered.`,
        );
      }

      plugins.set(validated.id, validated);
      return validated;
    },

    unregister(id) {
      return plugins.delete(id);
    },

    has(id) {
      return plugins.has(id);
    },

    get(id) {
      const plugin = plugins.get(id);

      if (!plugin) {
        throw new Error(`Unknown metadata plugin "${id}".`);
      }

      return plugin;
    },

    list() {
      return ordered();
    },

    async search(query, context = {}) {
      const results = [];
      const errors = [];

      for (const plugin of ordered()) {
        if (typeof plugin.search !== 'function') continue;

        try {
          const matches = await plugin.search(query, context);

          for (const match of matches || []) {
            results.push({
              ...match,
              providerId: match.providerId || plugin.id,
            });
          }
        } catch (error) {
          errors.push({
            pluginId: plugin.id,
            message: error.message,
          });
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
          errors.push({
            pluginId: plugin.id,
            message: error.message,
          });
        }
      }

      return {
        book: current,
        history,
        errors,
      };
    },
  };
}
