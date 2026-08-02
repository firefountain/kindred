<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], required: true },
  note: String,
  tone: { type: String, default: 'neutral' },
});
</script>

<template>
  <article :class="['k-stat', `k-stat--${tone}`]">
    <div class="k-stat__icon"><slot name="icon" /></div>
    <div>
      <strong>{{ value }}</strong>
      <span>{{ label }}</span>
      <small v-if="note">{{ note }}</small>
    </div>
  </article>
</template>

<style scoped>
.k-stat {
  display: grid; grid-template-columns: auto 1fr; gap: 13px; align-items: start;
  padding: 16px; background: var(--k-bg-elevated); border: 1px solid var(--k-border);
  border-radius: var(--k-radius-md);
}
.k-stat__icon { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 9px; background: var(--k-bg-soft); color: var(--k-text-muted); }
strong { display: block; font-size: 24px; line-height: 1; letter-spacing: -.03em; }
span { display: block; margin-top: 6px; color: var(--k-text-muted); font-size: 12px; font-weight: 700; }
small { display: block; margin-top: 8px; color: var(--k-text-subtle); }
.k-stat--accent .k-stat__icon { color: var(--k-accent); background: rgba(217,239,111,.09); }
.k-stat--warning .k-stat__icon { color: var(--k-warning); background: rgba(243,199,107,.09); }
.k-stat--danger .k-stat__icon { color: var(--k-danger); background: rgba(255,138,122,.09); }
</style>
