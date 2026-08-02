import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { api } from '../api/client.js';

export const useLibraryStore = defineStore('library', () => {
  const libraries = ref([]);
  const activeLibraryId = ref('');
  const activeLibrary = ref(null);
  const items = ref([]);
  const loading = ref(false);
  const error = ref('');

  const books = computed(() => items.value.filter(item => item.type === 'book'));

  async function refreshLibraries() {
    const payload = await api.libraries.list();
    libraries.value = payload.libraries || [];
    activeLibraryId.value = payload.activeLibraryId || activeLibraryId.value || libraries.value[0]?.id || '';
    return payload;
  }

  async function open(id = activeLibraryId.value, persist = true) {
    if (!id) return null;
    loading.value = true;
    error.value = '';
    try {
      const payload = persist
        ? await api.libraries.open(id)
        : await api.libraries.get(id);
      activeLibraryId.value = id;
      activeLibrary.value = payload.library;
      items.value = payload.items || [];
      return payload;
    } catch (cause) {
      error.value = cause.message;
      throw cause;
    } finally {
      loading.value = false;
    }
  }

  async function bootstrap() {
    await refreshLibraries();
    if (activeLibraryId.value) await open(activeLibraryId.value, false);
  }

  function replaceItem(item) {
    const index = items.value.findIndex(existing => existing.id === item.id);
    if (index >= 0) items.value[index] = item;
    else items.value.push(item);
  }

  async function saveItem(item) {
    const saved = await api.libraries.updateItem(activeLibraryId.value, item.id, item);
    replaceItem(saved.item || saved);
    return saved;
  }

  return {
    libraries,
    activeLibraryId,
    activeLibrary,
    items,
    books,
    loading,
    error,
    refreshLibraries,
    open,
    bootstrap,
    replaceItem,
    saveItem,
  };
});
