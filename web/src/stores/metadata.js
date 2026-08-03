import { computed, reactive, readonly } from 'vue';
import { enrichMetadata, searchMetadata } from '../api/metadata.js';

function emptyState() {
  return {
    searching: false,
    enriching: false,
    activeBookId: null,
    result: null,
    candidates: [],
    providers: [],
    conflicts: [],
    coverCandidates: [],
    errors: [],
    lastQuery: null,
    selectedCover: null,
    transportError: null,
  };
}

export function createMetadataStore(options = {}) {
  const search = options.search || searchMetadata;
  const enrich = options.enrich || enrichMetadata;
  const state = reactive(emptyState());
  let requestSequence = 0;
  let activeController = null;

  function beginRequest(mode, bookId = null) {
    requestSequence += 1;
    activeController?.abort();
    activeController = new AbortController();

    state.searching = mode === 'search';
    state.enriching = mode === 'enrich';
    state.activeBookId = bookId;
    state.transportError = null;

    return {
      id: requestSequence,
      signal: activeController.signal,
    };
  }

  function finishRequest(requestId) {
    if (requestId !== requestSequence) return;
    state.searching = false;
    state.enriching = false;
  }

  function applyResult(payload) {
    state.result = payload;
    state.candidates = payload?.candidates || [];
    state.providers = payload?.providers || [];
    state.conflicts = payload?.conflicts || [];
    state.coverCandidates = payload?.coverCandidates || [];
    state.errors = payload?.errors || [];
    state.selectedCover = payload?.metadata?.cover || state.coverCandidates[0] || null;
  }

  async function run(mode, operation, context = {}) {
    const request = beginRequest(mode, context.bookId || null);

    try {
      const payload = await operation(request.signal);
      if (request.id !== requestSequence) return null;
      applyResult(payload);
      return payload;
    } catch (error) {
      if (request.id !== requestSequence || error.name === 'AbortError') return null;
      state.transportError = {
        name: error.name,
        message: error.message,
        status: error.status || 0,
        code: error.code || 'UNKNOWN_ERROR',
        payload: error.payload || null,
      };
      throw error;
    } finally {
      finishRequest(request.id);
    }
  }

  return {
    state: readonly(state),
    busy: computed(() => state.searching || state.enriching),

    search(query) {
      state.lastQuery = query;
      return run('search', signal => search(query, { signal }), {});
    },

    enrich(book, enrichOptions = {}) {
      return run(
        'enrich',
        signal => enrich(book, { ...enrichOptions, signal }),
        { bookId: book?.id || null },
      );
    },

    selectCover(cover) {
      state.selectedCover = cover || null;
    },

    applyResolvedMetadata(book) {
      if (!state.result?.metadata) return book;
      return {
        ...book,
        ...state.result.metadata,
        metadata: {
          ...(book?.metadata || {}),
          ...state.result.metadata,
          cover: state.selectedCover || state.result.metadata.cover || null,
        },
        metadataProvenance: state.result.provenance || {},
        metadataDecisions: state.result.decisions || [],
        metadataConflicts: state.result.conflicts || [],
      };
    },

    clear() {
      requestSequence += 1;
      activeController?.abort();
      Object.assign(state, emptyState());
    },
  };
}

export const metadataStore = createMetadataStore();
