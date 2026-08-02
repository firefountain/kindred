<script setup>
import { computed, onMounted, ref, toRaw } from 'vue';
import { BookOpen, Cable, Check, Database, FileText, HardDrive, Library, Newspaper, RefreshCw, Search, Sparkles, Tags, UploadCloud, X } from 'lucide-vue-next';

const items = ref([]);
const libraries = ref([]);
const activeLibraryId = ref('');
const activeLibrary = ref(null);
const device = ref({ connected: false });
const selected = ref(null);
const activeType = ref('book');
const filter = ref('');
const loading = ref(false);
const saving = ref(false);
const metadataResults = ref([]);
const metadataLoading = ref(false);
const metadataErrors = ref([]);
const metadataProviders = ref([]);
const tagInput = ref('');
const scanMessage = ref('');
const enrichmentJob = ref(null);
const syncing = ref(false);
const goodreadsImporting = ref(false);
const goodreadsInput = ref(null);
const addBooksInput = ref(null);
const addingBooks = ref(false);
const importDrafts = ref([]);
const importFiles = ref([]);
const reviewingImport = ref(false);

const types = [
  { id: 'book', label: 'Books', icon: BookOpen },
  { id: 'periodical', label: 'Periodicals', icon: Newspaper },
  { id: 'dictionary', label: 'Dictionaries', icon: Library },
  { id: 'document', label: 'Documents', icon: FileText },
];

const counts = computed(() => Object.fromEntries(types.map(type => [type.id, items.value.filter(item => item.type === type.id).length])));
const tagsCount = computed(() => new Set(items.value.flatMap(item => item.tags || [])).size);
const filtered = computed(() => {
  const needle = filter.value.toLowerCase().trim();
  return items.value.filter(item => item.type === activeType.value).filter(item => {
    if (!needle) return true;
    return [item.title, item.subtitle, ...(item.authors || []), ...(item.tags || []), item.series, item.format, item.asin]
      .join(' ').toLowerCase().includes(needle);
  });
});
const formatCount = computed(() => new Set(filtered.value.map(item => item.format)).size);
const activeLabel = computed(() => types.find(type => type.id === activeType.value)?.label || 'Library');
const enriching = computed(() => enrichmentJob.value && ['queued', 'running'].includes(enrichmentJob.value.status));

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(toRaw(value))); }

async function loadLibraries() {
  const response = await fetch('/api/v1/libraries');
  const payload = await response.json();
  libraries.value = payload.libraries || [];
  activeLibraryId.value = payload.activeLibraryId || libraries.value[0]?.id || '';
  if (activeLibraryId.value) await openLibrary(activeLibraryId.value, false);
}

async function openLibrary(id, persist = true) {
  if (!id) return;
  loading.value = true;
  try {
    const response = await fetch(`/api/v1/libraries/${id}${persist ? '/open' : ''}`, { method: persist ? 'POST' : 'GET' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Unable to open library');
    activeLibraryId.value = id;
    activeLibrary.value = payload.library;
    items.value = payload.items || [];
    device.value = payload.device || { connected: false };
    if (selected.value) selected.value = clone(items.value.find(item => item.id === selected.value.id) || null);
  } catch (error) {
    scanMessage.value = error.message;
  } finally { loading.value = false; }
}

async function scanKindle() {
  loading.value = true;
  scanMessage.value = 'Opening Kindle over MTP…';
  try {
    const response = await fetch('/api/v1/devices/kindle/scan', { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Kindle scan failed');
    activeLibrary.value = payload.library;
    activeLibraryId.value = payload.library.id;
    items.value = payload.items || [];
    device.value = payload.device || { connected: true };
    await refreshLibraryList();
    scanMessage.value = '';
  } catch (error) { scanMessage.value = error.message; }
  finally { loading.value = false; }
}

async function refreshLibraryList() {
  const response = await fetch('/api/v1/libraries');
  const payload = await response.json();
  libraries.value = payload.libraries || [];
}

function choose(item) { selected.value = clone(item); metadataResults.value = []; metadataErrors.value = []; metadataProviders.value = []; tagInput.value = ''; }
function closeEditor() { selected.value = null; metadataResults.value = []; metadataErrors.value = []; }

async function save() {
  saving.value = true;
  scanMessage.value = 'Saving locally and writing metadata.calibre to Kindle…';
  try {
    const response = await fetch(`/api/v1/libraries/${activeLibraryId.value}/items/${selected.value.id}?sync=true`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(selected.value),
    });
    const payload = await response.json();
    if (!response.ok && response.status !== 207) throw new Error(payload.error || 'Unable to save metadata');
    const index = items.value.findIndex(item => item.id === selected.value.id);
    if (index >= 0) items.value[index] = clone(payload.item);
    selected.value = clone(payload.item);
    if (payload.sync?.verified) {
      scanMessage.value = `Saved and verified ${payload.sync.verifiedEntries || payload.sync.changedEntries || 1} catalogue entr${(payload.sync.verifiedEntries || payload.sync.changedEntries || 1) === 1 ? 'y' : 'ies'} on Kindle.`;
    } else if (payload.warning) {
      scanMessage.value = payload.warning;
    } else {
      scanMessage.value = 'Saved locally.';
    }
  } catch (error) {
    scanMessage.value = error.message;
  } finally { saving.value = false; }
}

async function refreshSelectedMetadata() {
  metadataLoading.value = true;
  try {
    const response = await fetch(`/api/v1/libraries/${activeLibraryId.value}/items/${selected.value.id}/enrich`, { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Unable to enrich metadata');
    selected.value = clone(payload.item);
    const index = items.value.findIndex(item => item.id === payload.item.id);
    if (index >= 0) items.value[index] = clone(payload.item);
  } finally { metadataLoading.value = false; }
}



async function addBooks(event) {
  const files = [...(event.target.files || [])];
  event.target.value = '';
  if (!files.length || !activeLibraryId.value) return;
  addingBooks.value = true;
  scanMessage.value = `Reading metadata for ${files.length} book${files.length === 1 ? '' : 's'}…`;
  try {
    const form = new FormData();
    for (const file of files) form.append('books', file, file.name);
    const response = await fetch(`/api/v1/libraries/${activeLibraryId.value}/books/inspect`, { method: 'POST', body: form });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Unable to inspect books');
    importFiles.value = files;
    importDrafts.value = (payload.drafts || []).map(draft => clone(draft));
    reviewingImport.value = true;
    scanMessage.value = '';
  } catch (error) {
    scanMessage.value = error.message;
  } finally {
    addingBooks.value = false;
  }
}

function cancelBookImport() {
  reviewingImport.value = false;
  importDrafts.value = [];
  importFiles.value = [];
}

async function sendReviewedBooks() {
  if (!importFiles.value.length) return;
  addingBooks.value = true;
  scanMessage.value = `Sending ${importFiles.value.length} reviewed book${importFiles.value.length === 1 ? '' : 's'} to Kindle…`;
  try {
    const form = new FormData();
    for (const file of importFiles.value) form.append('books', file, file.name);
    form.append('metadata', JSON.stringify(importDrafts.value));
    const response = await fetch(`/api/v1/libraries/${activeLibraryId.value}/books`, { method: 'POST', body: form });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Unable to add books');
    activeLibrary.value = payload.library.library;
    items.value = payload.library.items || [];
    device.value = payload.library.device || device.value;
    await refreshLibraryList();
    const failed = payload.errors?.length || 0;
    scanMessage.value = `Added ${payload.added.length} reviewed book${payload.added.length === 1 ? '' : 's'} to Kindle${failed ? `; ${failed} failed` : ''}.`;
    cancelBookImport();
  } catch (error) {
    scanMessage.value = error.message;
  } finally {
    addingBooks.value = false;
  }
}

async function importGoodreads(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !activeLibraryId.value) return;
  goodreadsImporting.value = true;
  scanMessage.value = 'Importing Goodreads shelves and reading data…';
  try {
    const csv = await file.text();
    const response = await fetch(`/api/v1/libraries/${activeLibraryId.value}/imports/goodreads`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Unable to import Goodreads export');
    items.value = payload.library.items || [];
    activeLibrary.value = payload.library.library;
    const { matched, unmatched } = payload.summary;
    scanMessage.value = `Goodreads imported: ${matched} matched, ${unmatched} unmatched.`;
  } catch (error) {
    scanMessage.value = error.message;
  } finally {
    goodreadsImporting.value = false;
  }
}

async function syncMetadataToKindle() {
  if (!activeLibraryId.value || syncing.value) return;
  syncing.value = true;
  scanMessage.value = 'Preparing Calibre catalogue sync preview…';
  try {
    const previewResponse = await fetch(`/api/v1/libraries/${activeLibraryId.value}/sync-preview`, { method: 'POST' });
    const previewPayload = await previewResponse.json();
    if (!previewResponse.ok) throw new Error(previewPayload.error || 'Unable to preview Kindle sync');
    const preview = previewPayload.preview;
    if (!preview.changedEntries) {
      scanMessage.value = `Nothing to sync. ${preview.skippedEntries || 0} unmatched Calibre entries.`;
      return;
    }
    const approved = window.confirm(
      `Write ${preview.changedEntries} changed entr${preview.changedEntries === 1 ? 'y' : 'ies'} to metadata.calibre on the connected Kindle?\n\n`
      + `${preview.skippedEntries || 0} books cannot be matched. A local backup will be created before writing.`,
    );
    if (!approved) { scanMessage.value = 'Kindle metadata sync cancelled.'; return; }
    scanMessage.value = 'Writing and verifying metadata.calibre on Kindle…';
    const response = await fetch(`/api/v1/libraries/${activeLibraryId.value}/sync`, { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Unable to sync metadata to Kindle');
    if (!payload.result.verified) throw new Error('The Kindle did not verify the written catalogue.');
    scanMessage.value = `Verified ${payload.result.changedEntries} Calibre catalogue changes on Kindle. Kindle display metadata is unchanged.`;
    await refreshLibraryList();
  } catch (error) {
    scanMessage.value = error.message;
  } finally {
    syncing.value = false;
  }
}

async function enrichMissing() {
  if (!activeLibraryId.value || enriching.value) return;
  const response = await fetch(`/api/v1/libraries/${activeLibraryId.value}/enrichment-jobs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ onlyMissing: true }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Unable to start enrichment');
  enrichmentJob.value = payload.job;
  pollJob(payload.job.id);
}

async function pollJob(id) {
  const response = await fetch(`/api/v1/jobs/${id}`);
  const payload = await response.json();
  enrichmentJob.value = payload.job;
  if (['queued', 'running'].includes(payload.job.status)) return setTimeout(() => pollJob(id), 800);
  await openLibrary(activeLibraryId.value, false);
}

async function lookup() {
  metadataLoading.value = true;
  metadataErrors.value = [];
  try {
    const response = await fetch('/api/v1/metadata/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: selected.value.title, authors: selected.value.authors, isbn: selected.value.isbn }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Metadata lookup failed');
    metadataResults.value = payload.items || [];
    metadataErrors.value = payload.errors || [];
    metadataProviders.value = payload.providers || [];
  } catch (error) { metadataErrors.value = [error.message]; }
  finally { metadataLoading.value = false; }
}

function applyMetadata(match) {
  for (const key of ['title', 'authors', 'isbn', 'publisher', 'language', 'description', 'coverUrl']) if (match[key]) selected.value[key] = match[key];
  selected.value.tags = [...new Set([...(selected.value.tags || []), ...(match.tags || [])])].slice(0, 30);
  selected.value.metadataSource = { ...(selected.value.metadataSource || {}), title: match.source, authors: match.source, external: match.source };
  selected.value.description = selected.value.description?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '';
}
function addTag() { const value = tagInput.value.trim(); if (!value) return; selected.value.tags = [...new Set([...(selected.value.tags || []), value])]; tagInput.value = ''; }
function removeTag(tag) { selected.value.tags = selected.value.tags.filter(value => value !== tag); }
function formatBytes(bytes = 0) { if (!bytes) return ''; return bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`; }
function sourceLabel(field) { return selected.value?.metadataSource?.[field] || 'not available'; }

onMounted(loadLibraries);
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="logo"><BookOpen :size="22" /></div><div><strong>Kindred</strong><span>API-first library manager</span></div></div>
      <div class="library-picker">
        <label>Library</label>
        <select v-model="activeLibraryId" @change="openLibrary(activeLibraryId)">
          <option v-for="library in libraries" :key="library.id" :value="library.id">{{ library.name }} · {{ library.itemCount }}</option>
        </select>
      </div>
      <nav>
        <button v-for="type in types" :key="type.id" :class="{ 'nav-active': activeType === type.id }" @click="activeType = type.id">
          <component :is="type.icon" :size="18" /> {{ type.label }} <span>{{ counts[type.id] || 0 }}</span>
        </button>
        <button><Tags :size="18" /> Tags <span>{{ tagsCount }}</span></button>
      </nav>
      <div class="device" :class="{ online: device.connected || activeLibrary }">
        <div class="device-icon"><Cable v-if="device.connected" :size="20"/><HardDrive v-else :size="20"/></div>
        <div><strong>{{ activeLibrary?.name || 'No saved library' }}</strong><span>{{ device.connected ? `Connected · ${device.objectCount || 0} objects` : (activeLibrary ? `Offline · ${activeLibrary.itemCount || items.length} saved items` : 'Scan a Kindle once') }}</span></div>
      </div>
    </aside>

    <main>
      <header><div><h1>{{ activeLabel }}</h1><p>{{ activeLibrary ? `${activeLibrary.name} · available offline` : 'Scan a Kindle to create a remembered library.' }}</p></div><div class="header-actions"><input ref="addBooksInput" type="file" accept=".epub,.mobi,.azw,.azw3,.pdf,.kfx" multiple hidden @change="addBooks" /><input ref="goodreadsInput" type="file" accept=".csv,text/csv" hidden @change="importGoodreads" /><button v-if="activeLibrary" class="primary" :disabled="addingBooks || loading" @click="addBooksInput?.click()"><UploadCloud :size="17" :class="{ spin: addingBooks }" /> {{ addingBooks ? 'Adding…' : 'Add books' }}</button><button v-if="activeLibrary" class="secondary" :disabled="goodreadsImporting" @click="goodreadsInput?.click()"><UploadCloud :size="17" /> {{ goodreadsImporting ? 'Importing…' : 'Import Goodreads export' }}</button><button v-if="activeLibrary" class="secondary" :disabled="syncing || loading" @click="syncMetadataToKindle"><UploadCloud :size="17" :class="{ spin: syncing }" /> {{ syncing ? 'Syncing…' : 'Sync Calibre catalogue' }}</button><button v-if="activeLibrary" class="secondary" :disabled="enriching" @click="enrichMissing"><Sparkles :size="17" :class="{ spin: enriching }" /> {{ enriching ? `${enrichmentJob.current}/${enrichmentJob.total}` : 'Fill metadata holes' }}</button><button class="secondary" @click="scanKindle"><RefreshCw :size="17" :class="{ spin: loading }" /> {{ loading ? 'Scanning…' : 'Scan Kindle' }}</button></div></header>
      <section class="toolbar"><label><Search :size="18"/><input v-model="filter" :placeholder="`Search ${activeLabel.toLowerCase()}, authors, tags…`" /></label><div class="summary"><span>{{ filtered.length }} items</span><span>{{ formatCount }} formats</span></div></section>

      <section v-if="!activeLibrary" class="empty"><div><Cable :size="38"/><h2>No saved library yet</h2><p>Connect and unlock a Kindle, close OpenMTP, then scan it once. Kindred will remember it afterwards.</p><p v-if="scanMessage"><code>{{ scanMessage }}</code></p></div></section>
      <section v-else-if="!filtered.length" class="empty"><div><Database :size="38"/><h2>No {{ activeLabel.toLowerCase() }} found</h2><p>The resolver found nothing in this category.</p></div></section>
      <section v-else class="grid">
        <button v-for="item in filtered" :key="item.id" class="book-card" @click="choose(item)">
          <div class="cover" :style="item.coverUrl ? { backgroundImage: `url(${item.coverUrl})` } : {}"><BookOpen v-if="!item.coverUrl" :size="28"/><span>{{ item.format }}</span></div>
          <div class="book-info"><h3>{{ item.title }}</h3><p>{{ item.authors?.join(', ') || (item.asin ? `ASIN ${item.asin}` : 'Metadata not extracted yet') }}</p><div class="chips"><span v-for="tag in (item.tags || []).slice(0, 2)" :key="tag">{{ tag }}</span><small>{{ formatBytes(item.size) }}</small></div></div>
        </button>
      </section>
    </main>

    <div v-if="reviewingImport" class="scrim import-scrim">
      <section class="import-review">
        <header class="drawer-header"><div><span>Review before transfer</span><h2>Add books to Kindle</h2><p>Embedded metadata was read first. Free providers only filled missing fields.</p></div><button class="icon" @click="cancelBookImport"><X/></button></header>
        <div class="import-list">
          <article v-for="draft in importDrafts" :key="draft.clientId" class="import-book">
            <div class="import-cover" :style="draft.coverUrl ? { backgroundImage: `url(${draft.coverUrl})` } : {}"><BookOpen v-if="!draft.coverUrl" :size="28"/><span>{{ draft.format }}</span></div>
            <div class="import-fields">
              <small>{{ draft.fileName }} · {{ formatBytes(draft.size) }}</small>
              <label>Title<input v-model="draft.title" /></label>
              <label>Authors<input :value="draft.authors?.join(', ')" @input="draft.authors = $event.target.value.split(',').map(x => x.trim()).filter(Boolean)" /></label>
              <div class="two"><label>Series<input v-model="draft.series" /></label><label>Number<input v-model.number="draft.seriesIndex" type="number" step="0.1" /></label></div>
              <div class="two"><label>ISBN<input v-model="draft.isbn" /></label><label>Language<input v-model="draft.language" /></label></div>
              <label>Publisher<input v-model="draft.publisher" /></label>
              <label>Tags<input :value="draft.tags?.join(', ')" @input="draft.tags = $event.target.value.split(',').map(x => x.trim()).filter(Boolean)" /></label>
              <label>Description<textarea v-model="draft.description" rows="3" /></label>
              <p v-if="draft.inspectionWarning" class="import-warning">{{ draft.inspectionWarning }}</p>
            </div>
          </article>
        </div>
        <footer class="drawer-footer"><button class="secondary" @click="cancelBookImport">Cancel</button><button class="primary" :disabled="addingBooks" @click="sendReviewedBooks"><UploadCloud :size="17"/> {{ addingBooks ? 'Sending…' : `Send ${importDrafts.length} to Kindle` }}</button></footer>
      </section>
    </div>

    <div v-if="selected" class="scrim" @click.self="closeEditor">
      <section class="drawer">
        <header class="drawer-header"><div><span>{{ selected.type }} · {{ selected.format }} · {{ selected.fileName }}</span><h2>Edit metadata</h2></div><button class="icon" @click="closeEditor"><X/></button></header>
        <div class="drawer-body">
        <div class="editor">
          <div class="cover-column">
            <div class="cover-large" :style="selected.coverUrl ? { backgroundImage: `url(${selected.coverUrl})` } : {}"><BookOpen v-if="!selected.coverUrl" :size="42"/></div>
            <button class="secondary" :disabled="metadataLoading" @click="refreshSelectedMetadata"><RefreshCw :size="15" :class="{ spin: metadataLoading }"/> {{ metadataLoading ? 'Matching…' : 'Auto-match metadata' }}</button>
            <button class="secondary" :disabled="metadataLoading" @click="lookup"><Search :size="15"/> Choose another match</button>
            <small>Automatic matches are scored by title, author and ISBN. Your saved edits still win.</small>
          </div>
          <div class="fields">
            <label>Type<select v-model="selected.type"><option v-for="type in types" :key="type.id" :value="type.id">{{ type.label }}</option></select></label>
            <label>Title <small>{{ sourceLabel('title') }}</small><input v-model="selected.title" /></label>
            <label>Authors <small>{{ sourceLabel('authors') }}</small><input :value="selected.authors?.join(', ')" @input="selected.authors = $event.target.value.split(',').map(x => x.trim()).filter(Boolean)" /></label>
            <div class="two"><label>Series<input v-model="selected.series" /></label><label>Number<input v-model.number="selected.seriesIndex" type="number" step="0.1" /></label></div>
            <div class="two"><label>ISBN<input v-model="selected.isbn" /></label><label>ASIN <small>{{ sourceLabel('asin') }}</small><input v-model="selected.asin" /></label></div>
            <div class="two"><label>Language<input v-model="selected.language" /></label><label>Publisher<input v-model="selected.publisher" /></label></div>
            <label>Description<textarea v-model="selected.description" rows="5" /></label>
            <label>Tags<div class="tag-editor"><span v-for="tag in selected.tags" :key="tag">{{ tag }} <button @click="removeTag(tag)">×</button></span><input v-model="tagInput" @keydown.enter.prevent="addTag" placeholder="Add tag…" /></div></label>
          </div>
        </div>
        <div v-if="metadataResults.length" class="metadata"><div class="metadata-head"><div><h3>Metadata matches</h3><p>{{ metadataProviders.join(' + ') || 'Open Library + Google Books + Crossref' }}</p></div></div><div class="matches"><button v-for="match in metadataResults" :key="`${match.source}-${match.sourceId}`" @click="applyMetadata(match)"><img v-if="match.coverUrl" :src="match.coverUrl"/><div class="mini-cover" v-else><BookOpen :size="18"/></div><div><strong>{{ match.title }}</strong><span>{{ match.authors?.join(', ') }} · {{ match.publishedDate }}</span><small>{{ match.source }} · score {{ match.score }}</small></div><Check :size="18"/></button></div></div><div v-if="metadataErrors.length" class="metadata-errors"><p v-for="error in metadataErrors" :key="error">{{ error }}</p></div>
        </div>
        <footer class="drawer-footer"><button class="secondary" @click="closeEditor">Cancel</button><button class="primary" @click="save"><Check :size="17"/> {{ saving ? 'Saving…' : 'Save changes' }}</button></footer>
      </section>
    </div>
  </div>
</template>
