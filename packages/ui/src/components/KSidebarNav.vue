<script setup>
defineProps({
  items: { type: Array, default: () => [] },
  modelValue: String,
});
defineEmits(['update:modelValue']);
</script>

<template>
  <nav class="k-nav">
    <button
      v-for="item in items"
      :key="item.id"
      :class="['k-nav__item', { 'k-nav__item--active': modelValue === item.id }]"
      @click="$emit('update:modelValue', item.id)"
    >
      <component :is="item.icon" :size="17" />
      <span>{{ item.label }}</span>
      <small v-if="item.count != null">{{ item.count }}</small>
    </button>
  </nav>
</template>

<style scoped>
.k-nav { display: grid; gap: 3px; }
.k-nav__item {
  display: grid; grid-template-columns: 20px 1fr auto; align-items: center; gap: 9px;
  width: 100%; min-height: 38px; padding: 8px 10px; border: 0; border-radius: 8px;
  background: transparent; color: var(--k-text-muted); text-align: left; cursor: pointer;
}
.k-nav__item:hover { background: var(--k-bg-soft); color: var(--k-text); }
.k-nav__item--active { background: rgba(217,239,111,.1); color: var(--k-accent); }
span { font-size: 13px; font-weight: 700; }
small { color: var(--k-text-subtle); font-size: 11px; }
</style>
