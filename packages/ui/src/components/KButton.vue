<script setup>
import { computed } from 'vue';

const props = defineProps({
  variant: { type: String, default: 'primary' },
  size: { type: String, default: 'md' },
  loading: Boolean,
  disabled: Boolean,
  type: { type: String, default: 'button' },
});

const classes = computed(() => [
  'k-button',
  `k-button--${props.variant}`,
  `k-button--${props.size}`,
]);
</script>

<template>
  <button :type="type" :class="classes" :disabled="disabled || loading">
    <span v-if="loading" class="k-button__spinner" aria-hidden="true" />
    <slot name="icon" />
    <span class="k-button__label"><slot /></span>
  </button>
</template>

<style scoped>
.k-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: var(--k-radius-sm);
  cursor: pointer;
  font-weight: 700;
  transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
}
.k-button:hover:not(:disabled) { transform: translateY(-1px); }
.k-button:disabled { cursor: not-allowed; opacity: .5; }
.k-button--sm { min-height: 32px; padding: 6px 10px; font-size: 13px; }
.k-button--md { min-height: 40px; padding: 9px 14px; font-size: 14px; }
.k-button--lg { min-height: 46px; padding: 11px 18px; font-size: 15px; }
.k-button--primary { background: var(--k-accent); color: var(--k-accent-ink); }
.k-button--primary:hover:not(:disabled) { background: var(--k-accent-strong); }
.k-button--secondary { background: var(--k-bg-soft); color: var(--k-text); border-color: var(--k-border); }
.k-button--secondary:hover:not(:disabled) { background: var(--k-bg-hover); border-color: var(--k-border-strong); }
.k-button--ghost { background: transparent; color: var(--k-text-muted); }
.k-button--ghost:hover:not(:disabled) { background: var(--k-bg-soft); color: var(--k-text); }
.k-button--danger { background: rgba(255, 138, 122, .12); color: var(--k-danger); border-color: rgba(255, 138, 122, .25); }
.k-button__spinner {
  width: 14px; height: 14px; border: 2px solid currentColor; border-right-color: transparent;
  border-radius: 999px; animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
