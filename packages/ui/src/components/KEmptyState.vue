<script setup>
defineProps({
  title: { type: String, required: true },
  description: String,
});
</script>

<template>
  <div class="k-empty">
    <div class="k-empty__icon"><slot name="icon" /></div>
    <h3>{{ title }}</h3>
    <p v-if="description">{{ description }}</p>
    <div v-if="$slots.actions" class="k-empty__actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.k-empty { display: grid; justify-items: center; padding: 54px 24px; text-align: center; }
.k-empty__icon { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 14px; background: var(--k-bg-soft); color: var(--k-accent); }
h3 { margin: 16px 0 0; }
p { max-width: 420px; margin: 8px 0 0; color: var(--k-text-muted); line-height: 1.5; }
.k-empty__actions { margin-top: 20px; }
</style>
