<script setup>
import { ref } from 'vue';
import { BookOpen, CircleAlert, FolderHeart, Library, Search, Settings, Tablet, Tags } from 'lucide-vue-next';
import {
  KAppShell,
  KBadge,
  KBookCover,
  KButton,
  KCard,
  KEmptyState,
  KSidebarNav,
  KStatCard,
} from '@kindred/ui';

const active = ref('dashboard');
const navigation = [
  { id: 'dashboard', label: 'Dashboard', icon: Library },
  { id: 'library', label: 'Library', icon: BookOpen, count: 412 },
  { id: 'collections', label: 'Collections', icon: FolderHeart, count: 13 },
  { id: 'tags', label: 'Tags', icon: Tags, count: 47 },
  { id: 'devices', label: 'Devices', icon: Tablet, count: 1 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const books = [
  { title: 'World War Z', author: 'Max Brooks', tags: ['Horror', 'Zombies'], status: 'Synced' },
  { title: 'Alphabet Squadron', author: 'Alexander Freed', tags: ['Science fiction'], status: 'Metadata needed' },
  { title: 'A Mark of Kings', author: 'Bryce O’Connor', tags: ['Fantasy'], status: 'Unsynced' },
];
</script>

<template>
  <KAppShell>
    <template #navigation>
      <KSidebarNav v-model="active" :items="navigation" />
    </template>

    <template #sidebar-footer>
      <KBadge tone="success" dot>Kindle Scribe connected</KBadge>
    </template>

    <template #topbar>
      <div class="preview-topbar">
        <div>
          <strong>Good evening.</strong>
          <span>Your library is in good shape.</span>
        </div>
        <div class="preview-actions">
          <KButton variant="secondary"><template #icon><Search :size="16" /></template>Search</KButton>
          <KButton>Add books</KButton>
        </div>
      </div>
    </template>

    <div class="preview-page">
      <section class="preview-heading">
        <div>
          <p>LIBRARY OVERVIEW</p>
          <h1>Everything you own, properly organised.</h1>
        </div>
        <KBadge tone="accent">EPUB-first</KBadge>
      </section>

      <section class="preview-stats">
        <KStatCard label="Books" :value="412" tone="accent"><template #icon><BookOpen :size="18" /></template></KStatCard>
        <KStatCard label="Collections" :value="13"><template #icon><FolderHeart :size="18" /></template></KStatCard>
        <KStatCard label="Missing covers" :value="18" tone="warning"><template #icon><CircleAlert :size="18" /></template></KStatCard>
        <KStatCard label="Unsynced" :value="3" tone="danger"><template #icon><Tablet :size="18" /></template></KStatCard>
      </section>

      <KCard title="Recently added" subtitle="The latest books in your Kindred library">
        <template #actions><KButton variant="ghost" size="sm">View all</KButton></template>
        <div class="preview-books">
          <article v-for="book in books" :key="book.title" class="preview-book">
            <KBookCover :title="book.title" :author="book.author" size="sm" />
            <div class="preview-book__body">
              <strong>{{ book.title }}</strong>
              <span>{{ book.author }}</span>
              <div>
                <KBadge v-for="tag in book.tags" :key="tag">{{ tag }}</KBadge>
              </div>
            </div>
            <KBadge :tone="book.status === 'Synced' ? 'success' : book.status === 'Unsynced' ? 'warning' : 'info'" dot>
              {{ book.status }}
            </KBadge>
          </article>
        </div>
      </KCard>

      <KEmptyState title="No reading activity yet" description="Reading progress will appear here when device adapters begin reporting it.">
        <template #icon><BookOpen :size="22" /></template>
        <template #actions><KButton variant="secondary">Browse library</KButton></template>
      </KEmptyState>
    </div>
  </KAppShell>
</template>

<style scoped>
.preview-topbar { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 20px; }
.preview-topbar strong, .preview-topbar span { display: block; }
.preview-topbar span { margin-top: 2px; color: var(--k-text-muted); font-size: 12px; }
.preview-actions { display: flex; gap: 8px; }
.preview-page { display: grid; gap: 22px; max-width: 1320px; margin: 0 auto; }
.preview-heading { display: flex; justify-content: space-between; align-items: end; gap: 20px; }
.preview-heading p { margin: 0 0 8px; color: var(--k-accent); font-size: 10px; font-weight: 900; letter-spacing: .16em; }
.preview-heading h1 { max-width: 680px; margin: 0; font-size: clamp(26px, 4vw, 44px); line-height: 1.03; letter-spacing: -.045em; }
.preview-stats { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; }
.preview-books { display: grid; gap: 3px; }
.preview-book { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 13px; align-items: center; min-height: 68px; padding: 9px; border-radius: 9px; }
.preview-book:hover { background: var(--k-bg-soft); }
.preview-book__body strong, .preview-book__body span { display: block; }
.preview-book__body strong { font-size: 13px; }
.preview-book__body span { margin: 4px 0 8px; color: var(--k-text-muted); font-size: 11px; }
.preview-book__body div { display: flex; flex-wrap: wrap; gap: 5px; }
@media (max-width: 980px) { .preview-stats { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) {
  .preview-topbar > div:first-child { display: none; }
  .preview-actions { width: 100%; justify-content: flex-end; }
  .preview-stats { grid-template-columns: 1fr; }
  .preview-book { grid-template-columns: auto 1fr; }
  .preview-book > :last-child { grid-column: 2; justify-self: start; }
}
</style>
