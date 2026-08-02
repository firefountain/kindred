import { ref } from 'vue';
import { defineStore } from 'pinia';
import { api } from '../api/client.js';
import { useLibraryStore } from './library.js';

export const useDeviceStore = defineStore('devices', () => {
  const connected = ref([]);
  const scanning = ref(false);
  const error = ref('');

  async function scanKindle() {
    scanning.value = true;
    error.value = '';
    try {
      const payload = await api.devices.scanKindle();
      const library = useLibraryStore();
      library.activeLibraryId = payload.library.id;
      library.activeLibrary = payload.library;
      library.items = payload.items || [];
      connected.value = payload.device ? [payload.device] : [];
      await library.refreshLibraries();
      return payload;
    } catch (cause) {
      error.value = cause.message;
      throw cause;
    } finally {
      scanning.value = false;
    }
  }

  return { connected, scanning, error, scanKindle };
});
