import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

export const useSyncStore = defineStore('sync', () => {
  const jobs = ref([]);

  const activeJobs = computed(() =>
    jobs.value.filter(job => ['queued', 'running'].includes(job.status)),
  );

  function upsert(job) {
    const index = jobs.value.findIndex(existing => existing.id === job.id);
    if (index >= 0) jobs.value[index] = { ...jobs.value[index], ...job };
    else jobs.value.unshift(job);
  }

  function remove(id) {
    jobs.value = jobs.value.filter(job => job.id !== id);
  }

  function clearFinished() {
    jobs.value = jobs.value.filter(job => ['queued', 'running'].includes(job.status));
  }

  return { jobs, activeJobs, upsert, remove, clearFinished };
});
