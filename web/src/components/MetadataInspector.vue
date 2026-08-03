<script setup>
import { computed, onMounted, ref } from 'vue';
import { AlertTriangle, Check, RefreshCw, ShieldCheck, X } from 'lucide-vue-next';
import { metadataStore } from '../stores/metadata.js';
import { persistMetadata } from '../api/metadata.js';

const props = defineProps({ book: { type: Object, required: true } });
const emit = defineEmits(['apply', 'close']);
const state = metadataStore.state;
const saving = ref(false);
const saveError = ref('');

const fieldNames = [
  'title', 'subtitle', 'authors', 'series', 'seriesIndex', 'isbn',
  'publisher', 'language', 'description', 'tags',
];

const fields = computed(() => {
  const metadata = state.result?.metadata || {};
  const provenance = state.result?.provenance || {};
  const decisions = new Map((state.result?.decisions || []).map(item => [item.field, item]));

  return fieldNames
    .filter(field => metadata[field] != null && metadata[field] !== '' && (!Array.isArray(metadata[field]) || metadata[field].length))
    .map(field => ({
      field,
      current: props.book?.[field],
      proposed: metadata[field],
      changed: JSON.stringify(props.book?.[field] ?? null) !== JSON.stringify(metadata[field] ?? null),
      provenance: provenance[field] || {},
      decision: decisions.get(field),
    }));
});

const changedCount = computed(() => fields.value.filter(field => field.changed).length);
const busy = computed(() => state.enriching || state.searching || saving.value);

function display(value) {
  if (Array.isArray(value)) return value.join(', ');
  return String(value ?? '').trim() || 'Not set';
}

function label(value = '') {
  return String(value)
    .replaceAll('.', ' · ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, character => character.toUpperCase());
}

async function inspect() {
  saveError.value = '';
  await metadataStore.enrich(props.book, { baseSource: 'manual', baseConfidence: 1 });
}

async function apply() {
  saving.value = true;
  saveError.value = '';

  try {
    const proposed = metadataStore.applyResolvedMetadata(props.book);
    const persisted = await persistMetadata(proposed, state.result);
    emit('apply', persisted.item || proposed);
  } catch (error) {
    saveError.value = error.message;
  } finally {
    saving.value = false;
  }
}

function close() {
  metadataStore.clear();
  emit('close');
}

onMounted(inspect);
</script>

<template>
  <div class="review-scrim" @click.self="close">
    <section class="review-modal" role="dialog" aria-modal="true" aria-labelledby="metadata-review-title">
      <header class="review-header">
        <div>
          <span>Metadata review</span>
          <h2 id="metadata-review-title">Review and save provider changes</h2>
          <p>Compare the current book with Kindred's resolved metadata. Applying this review saves it immediately.</p>
        </div>
        <button class="icon-button" type="button" aria-label="Close metadata review" @click="close">
          <X :size="20" />
        </button>
      </header>

      <div v-if="!state.result" class="loading-state">
        <ShieldCheck :size="40" />
        <h3>Comparing metadata providers</h3>
        <p>Kindred is collecting candidates and resolving each field.</p>
        <RefreshCw :size="22" class="spin" />
        <p v-if="state.transportError" class="error">{{ state.transportError.message }}</p>
      </div>

      <template v-else>
        <div class="review-summary">
          <div>
            <strong>{{ changedCount }}</strong>
            <span>field{{ changedCount === 1 ? '' : 's' }} will change</span>
          </div>
          <div class="provider-strip">
            <article
              v-for="provider in state.providers"
              :key="provider.providerId"
              :class="{ failed: provider.error }"
            >
              <strong>{{ label(provider.providerId) }}</strong>
              <span v-if="provider.error">{{ provider.error.message }}</span>
              <span v-else>{{ provider.resultCount }} result{{ provider.resultCount === 1 ? '' : 's' }} · {{ provider.durationMs }} ms</span>
            </article>
          </div>
        </div>

        <div class="review-content">
          <main class="field-comparison">
            <div class="comparison-heading">
              <span>Field</span>
              <span>Current</span>
              <span>Proposed</span>
            </div>

            <article v-for="entry in fields" :key="entry.field" :class="{ changed: entry.changed }">
              <div class="field-label">
                <strong>{{ label(entry.field) }}</strong>
                <small>{{ entry.changed ? 'Change' : 'Unchanged' }}</small>
              </div>
              <p class="current-value">{{ display(entry.current) }}</p>
              <div class="proposed-value">
                <p>{{ display(entry.proposed) }}</p>
                <small>
                  {{ label(entry.provenance.source || 'unknown') }}
                  · {{ Math.round((entry.provenance.confidence || 0) * 100) }}%
                  · {{ entry.decision?.reason || 'resolved value' }}
                </small>
              </div>
            </article>
          </main>

          <aside class="review-aside">
            <section v-if="state.coverCandidates.length" class="covers">
              <div class="section-title">
                <h3>Cover</h3>
                <span>{{ state.coverCandidates.length }} candidates</span>
              </div>
              <div class="cover-grid">
                <button
                  v-for="cover in state.coverCandidates.slice(0, 6)"
                  :key="cover.url"
                  type="button"
                  :class="{ selected: state.selectedCover?.url === cover.url }"
                  @click="metadataStore.selectCover(cover)"
                >
                  <img :src="cover.url" alt="Book cover candidate" />
                  <span>{{ label(cover.source) }}</span>
                </button>
              </div>
            </section>

            <section v-if="state.conflicts.length" class="conflicts">
              <div class="section-title warning-title">
                <h3><AlertTriangle :size="17" /> Conflicts</h3>
                <span>{{ state.conflicts.length }}</span>
              </div>
              <article v-for="conflict in state.conflicts" :key="conflict.field">
                <strong>{{ label(conflict.field) }}</strong>
                <span v-for="entry in conflict.values" :key="`${entry.source}-${entry.value}`">
                  {{ label(entry.source) }}: {{ display(entry.value) }}
                </span>
              </article>
            </section>

            <section v-if="state.errors.length" class="warnings">
              <div class="section-title warning-title"><h3>Provider warnings</h3></div>
              <p v-for="error in state.errors" :key="`${error.providerId}-${error.message}`">
                <strong>{{ label(error.providerId) }}</strong><br />{{ error.message }}
              </p>
            </section>
          </aside>
        </div>

        <p v-if="saveError" class="error save-error">{{ saveError }}</p>

        <footer class="review-footer">
          <div>
            <strong>One action, one save.</strong>
            <span>The accepted metadata and its provenance are written to the local library immediately.</span>
          </div>
          <div class="footer-actions">
            <button class="secondary-action" type="button" :disabled="busy" @click="close">Cancel</button>
            <button class="primary-action" type="button" :disabled="busy" @click="apply">
              <Check :size="17" />
              {{ saving ? 'Applying and saving…' : 'Apply and save metadata' }}
            </button>
          </div>
        </footer>
      </template>
    </section>
  </div>
</template>

<style scoped>
.review-scrim{position:fixed;inset:0;z-index:80;display:grid;place-items:center;padding:28px;background:rgba(16,24,40,.62);backdrop-filter:blur(5px)}
.review-modal{display:flex;flex-direction:column;width:min(1180px,96vw);max-height:92vh;overflow:hidden;border:1px solid rgba(255,255,255,.4);border-radius:20px;background:#fff;box-shadow:0 30px 90px rgba(16,24,40,.35)}
.review-header{display:flex;justify-content:space-between;gap:24px;padding:22px 24px;border-bottom:1px solid #e9edf2}.review-header span{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;color:#667085}.review-header h2{margin:4px 0 4px;font-size:24px}.review-header p{margin:0;color:#667085}.icon-button{display:grid;place-items:center;width:38px;height:38px;border:1px solid #e1e6eb;border-radius:10px;background:#fff;cursor:pointer}.loading-state{display:grid;justify-items:center;gap:10px;padding:80px 24px;text-align:center}.loading-state h3,.loading-state p{margin:0}.loading-state p{color:#667085}
.review-summary{display:flex;align-items:center;gap:20px;padding:14px 24px;border-bottom:1px solid #edf0f3;background:#f8fafc}.review-summary>div:first-child{display:flex;align-items:baseline;gap:7px;white-space:nowrap}.review-summary>div:first-child strong{font-size:24px}.review-summary>div:first-child span{color:#667085}.provider-strip{display:flex;gap:8px;overflow:auto}.provider-strip article{display:grid;min-width:180px;padding:9px 11px;border:1px solid #e6eaee;border-radius:10px;background:#fff}.provider-strip article.failed{border-color:#fecaca;background:#fff1f1}.provider-strip strong{font-size:12px}.provider-strip span{font-size:11px;color:#667085}
.review-content{display:grid;grid-template-columns:minmax(0,1fr) 300px;min-height:0;overflow:hidden}.field-comparison{min-width:0;overflow:auto;padding:0 20px 20px}.comparison-heading,.field-comparison article{display:grid;grid-template-columns:140px minmax(0,1fr) minmax(0,1.15fr);gap:14px}.comparison-heading{position:sticky;top:0;z-index:2;padding:14px 10px 9px;background:#fff;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#667085}.field-comparison article{padding:14px 10px;border-top:1px solid #edf0f3}.field-comparison article.changed{background:#f8fbff}.field-label{display:grid;align-content:start;gap:4px}.field-label small{width:max-content;padding:2px 6px;border-radius:999px;background:#eef2f6;color:#667085;font-size:10px}.changed .field-label small{background:#dbeafe;color:#1d4ed8}.field-comparison p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.current-value{color:#667085}.proposed-value{display:grid;gap:6px}.proposed-value small{color:#667085}
.review-aside{overflow:auto;border-left:1px solid #edf0f3;background:#f8fafc;padding:18px}.review-aside section{margin-bottom:16px;padding:14px;border:1px solid #e5e9ee;border-radius:14px;background:#fff}.section-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.section-title h3{margin:0;font-size:15px}.section-title span{font-size:11px;color:#667085}.cover-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:9px}.cover-grid button{border:2px solid transparent;border-radius:10px;padding:5px;background:#f8fafc;cursor:pointer}.cover-grid button.selected{border-color:#1f6feb;background:#eff6ff}.cover-grid img{display:block;width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:6px}.cover-grid span{display:block;margin-top:5px;font-size:10px}.warning-title h3{display:flex;align-items:center;gap:6px}.conflicts{background:#fffbeb!important;border-color:#fde68a!important}.conflicts article{display:grid;gap:3px;margin-top:10px}.conflicts article span,.warnings p{font-size:12px;color:#7c2d12}.warnings{background:#fff1f1!important;border-color:#fecaca!important}.warnings p{margin:8px 0 0}
.review-footer{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:16px 24px;border-top:1px solid #e9edf2;background:#fff}.review-footer>div:first-child{display:grid}.review-footer>div:first-child span{font-size:12px;color:#667085}.footer-actions{display:flex;gap:10px}.primary-action,.secondary-action{display:inline-flex;align-items:center;justify-content:center;gap:7px;border-radius:10px;padding:11px 15px;font-weight:800;cursor:pointer}.primary-action{border:0;background:#1f6feb;color:#fff}.secondary-action{border:1px solid #d0d5dd;background:#fff}.primary-action:disabled,.secondary-action:disabled{cursor:not-allowed;opacity:.6}.error{color:#b42318}.save-error{margin:0;padding:10px 24px;background:#fff1f1}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:900px){.review-scrim{padding:10px}.review-modal{width:100%;max-height:96vh}.review-content{grid-template-columns:1fr}.review-aside{border-top:1px solid #edf0f3;border-left:0}.comparison-heading,.field-comparison article{grid-template-columns:100px 1fr}.comparison-heading span:nth-child(2){display:none}.current-value{display:none}.review-footer{align-items:stretch;flex-direction:column}.footer-actions{justify-content:flex-end}}
</style>
