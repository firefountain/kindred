<script setup>
defineProps({
  tone: { type: String, default: 'neutral' },
  dot: Boolean,
});
</script>

<template>
  <span :class="['k-badge', `k-badge--${tone}`]">
    <span v-if="dot" class="k-badge__dot" />
    <slot />
  </span>
</template>

<style scoped>
.k-badge {
  display: inline-flex; align-items: center; gap: 6px; min-height: 24px; padding: 3px 8px;
  border-radius: 999px; font-size: 11px; font-weight: 800; letter-spacing: .02em;
  background: var(--k-bg-soft); color: var(--k-text-muted); border: 1px solid var(--k-border);
}
.k-badge__dot { width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
.k-badge--success { color: var(--k-success); background: rgba(137,212,155,.09); }
.k-badge--warning { color: var(--k-warning); background: rgba(243,199,107,.09); }
.k-badge--danger { color: var(--k-danger); background: rgba(255,138,122,.09); }
.k-badge--info { color: var(--k-info); background: rgba(141,184,238,.09); }
.k-badge--accent { color: var(--k-accent); background: rgba(217,239,111,.09); }
</style>
