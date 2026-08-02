<script setup>
import { BookOpen } from 'lucide-vue-next';

defineProps({
  src: String,
  alt: { type: String, default: '' },
  title: String,
  author: String,
  size: { type: String, default: 'md' },
});
</script>

<template>
  <div :class="['k-cover', `k-cover--${size}`]">
    <img v-if="src" :src="src" :alt="alt || title" loading="lazy">
    <div v-else class="k-cover__fallback">
      <BookOpen :size="22" />
      <strong>{{ title || 'Untitled' }}</strong>
      <span>{{ author || 'Unknown author' }}</span>
    </div>
  </div>
</template>

<style scoped>
.k-cover {
  overflow: hidden; flex: 0 0 auto; aspect-ratio: 2 / 3; border-radius: 7px;
  background: linear-gradient(145deg, #37372f, #1f1f1b); border: 1px solid var(--k-border);
  box-shadow: 0 8px 22px rgba(0,0,0,.28);
}
.k-cover--sm { width: 44px; }
.k-cover--md { width: 72px; }
.k-cover--lg { width: 118px; }
img { display: block; width: 100%; height: 100%; object-fit: cover; }
.k-cover__fallback { height: 100%; display: flex; flex-direction: column; justify-content: flex-end; gap: 5px; padding: 10px; }
strong { font-size: 10px; line-height: 1.2; }
span { color: var(--k-text-muted); font-size: 8px; }
</style>
