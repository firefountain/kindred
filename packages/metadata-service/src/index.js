import { resolveMetadata } from '@kindred/metadata-engine';
import { createPluginRegistry } from '@kindred/plugin-core';
import { createGoogleBooksPlugin } from '@kindred/provider-google-books';
import { createOpenLibraryPlugin } from '@kindred/provider-open-library';

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function duration(startedAt) {
  return Number((now() - startedAt).toFixed(2));
}

function normalizeProviderResults(results = []) {
  return results
    .filter(Boolean)
    .map(result => ({
      id: result.id || null,
      providerId: result.providerId || result.source || 'unknown',
      confidence: result.confidence ?? 0.5,
      metadata: result.metadata || result,
      evidence: result.evidence || {},
      raw: result.raw ?? null,
    }));
}

export function createMetadataService(options = {}) {
  const registry = options.registry || createPluginRegistry();

  if (!options.registry) {
    registry.register(createOpenLibraryPlugin({
      ...(options.openLibrary || {}),
      fetch: options.openLibrary?.fetch || options.fetch,
    }));

    registry.register(createGoogleBooksPlugin({
      ...(options.googleBooks || {}),
      fetch: options.googleBooks?.fetch || options.fetch,
    }));
  }

  async function search(query, context = {}) {
    const startedAt = now();
    const providers = registry.list();
    const settled = await Promise.all(
      providers.map(async provider => {
        const providerStartedAt = now();

        try {
          const results = typeof provider.search === 'function'
            ? await provider.search(query, context)
            : [];

          return {
            providerId: provider.id,
            durationMs: duration(providerStartedAt),
            results: normalizeProviderResults(results),
            error: null,
          };
        } catch (error) {
          return {
            providerId: provider.id,
            durationMs: duration(providerStartedAt),
            results: [],
            error: {
              name: error.name || 'Error',
              message: error.message,
            },
          };
        }
      }),
    );

    const candidates = settled.flatMap(entry => entry.results);
    const errors = settled
      .filter(entry => entry.error)
      .map(entry => ({
        providerId: entry.providerId,
        ...entry.error,
      }));

    const resolution = resolveMetadata(candidates, {
      priorities: options.priorities,
    });

    return {
      query,
      providers: settled.map(entry => ({
        providerId: entry.providerId,
        durationMs: entry.durationMs,
        resultCount: entry.results.length,
        error: entry.error,
      })),
      candidates,
      errors,
      resolution,
      durationMs: duration(startedAt),
    };
  }

  async function enrich(book, context = {}) {
    const metadata = book?.metadata || book || {};
    const searchResult = await search({
      title: metadata.title,
      authors: metadata.authors,
      isbn: metadata.isbn,
      language: metadata.language,
    }, context);

    const records = [
      {
        id: book?.id || 'embedded',
        source: context.baseSource || 'embedded',
        confidence: context.baseConfidence ?? 0.9,
        metadata,
      },
      ...searchResult.candidates,
    ];

    return {
      ...searchResult,
      resolution: resolveMetadata(records, {
        priorities: options.priorities,
      }),
    };
  }

  return {
    registry,
    search,
    enrich,
  };
}
