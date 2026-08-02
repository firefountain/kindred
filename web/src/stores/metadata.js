import { ref } from 'vue';
import { defineStore } from 'pinia';
import { api } from '../api/client.js';
import { useLibraryStore } from './library.js';

export const useMetadataStore = defineStore('metadata', () => {
  const searching = ref(false);
  const enriching = ref(false);
  const results = ref([]);
  const errors = ref([]);

  async function search(query) {
    searching.value = true;
    errors.value = [];
    try {
      const payload = await api.metadata.search(query);
      results.value = payload.matches || payload.results || [];
      errors.value = payload.errors || [];
      return payload;
    } finally {
      searching.value = false;
    }
  }

  async function enrich(itemId) {
    const library = useLibraryStore();
    enriching.value = true;
    try {
      const payload = await api.metadata.enrichItem(library.activeLibraryId, itemId);
      if (payload.item) library.replaceItem(payload.item);
      return payload;
    } finally {
      enriching.value = false;
    }
  }

  return { searching, enriching, results, errors, search, enrich };
});
