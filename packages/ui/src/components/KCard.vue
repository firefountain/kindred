<script setup>
defineProps({
  title: String,
  subtitle: String,
  interactive: Boolean,
  padded: { type: Boolean, default: true },
});
</script>

<template>
  <section :class="['k-card', { 'k-card--interactive': interactive, 'k-card--padded': padded }]">
    <header v-if="title || subtitle || $slots.actions" class="k-card__header">
      <div>
        <h3 v-if="title">{{ title }}</h3>
        <p v-if="subtitle">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="k-card__actions"><slot name="actions" /></div>
    </header>
    <slot />
  </section>
</template>

<style scoped>
.k-card {
  background: var(--k-bg-elevated);
  border: 1px solid var(--k-border);
  border-radius: var(--k-radius-md);
}
.k-card--padded { padding: 18px; }
.k-card--interactive { transition: border-color 140ms ease, transform 140ms ease, background 140ms ease; }
.k-card--interactive:hover { transform: translateY(-2px); border-color: var(--k-border-strong); background: var(--k-bg-soft); }
.k-card__header { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
h3 { margin: 0; font-size: 15px; }
p { margin: 5px 0 0; color: var(--k-text-muted); font-size: 13px; }
</style>
