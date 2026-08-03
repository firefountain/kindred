<script setup>
import { computed, ref } from 'vue';
import { AlertTriangle, Check, RefreshCw, ShieldCheck, X } from 'lucide-vue-next';
import { metadataStore } from '../stores/metadata.js';
import { persistMetadata } from '../api/metadata.js';

const props = defineProps({ book: { type: Object, required: true } });
const emit = defineEmits(['apply', 'close']);
const state = metadataStore.state;
const saving = ref(false);
const saveError = ref('');
const fields = computed(() => {
  const metadata = state.result?.metadata || {};
  const provenance = state.result?.provenance || {};
  const decisions = new Map((state.result?.decisions || []).map(item => [item.field, item]));
  return ['title','subtitle','authors','series','seriesIndex','isbn','publisher','language','description','tags']
    .filter(field => metadata[field] != null && metadata[field] !== '' && (!Array.isArray(metadata[field]) || metadata[field].length))
    .map(field => ({ field, value: metadata[field], provenance: provenance[field] || {}, decision: decisions.get(field) }));
});
const busy = computed(() => state.enriching || state.searching || saving.value);

function display(value) { return Array.isArray(value) ? value.join(', ') : String(value ?? ''); }
function label(value = '') { return String(value).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase()); }
async function inspect() { await metadataStore.enrich(props.book, { baseSource: 'manual', baseConfidence: 1 }); }
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
function close() { metadataStore.clear(); emit('close'); }
</script>

<template>
  <section class="inspector">
    <header class="inspector-head"><div><span>Metadata Inspector</span><h3>Review provider decisions</h3><p>Nothing changes until you accept the proposal.</p></div><button class="icon-button" type="button" @click="close"><X :size="18" /></button></header>
    <div v-if="!state.result" class="inspector-empty"><ShieldCheck :size="34" /><h4>Compare metadata sources</h4><p>Kindred will query the configured providers and explain which value wins for every field.</p><button class="inspect-button" type="button" :disabled="busy" @click="inspect"><RefreshCw :size="16" :class="{ spin: busy }" /> {{ busy ? 'Inspecting…' : 'Inspect metadata' }}</button><p v-if="state.transportError" class="error">{{ state.transportError.message }}</p></div>
    <template v-else>
      <div class="provider-grid"><article v-for="provider in state.providers" :key="provider.providerId" :class="{ failed: provider.error }"><div><strong>{{ label(provider.providerId) }}</strong><small v-if="provider.error">{{ provider.error.message }}</small><small v-else>{{ provider.resultCount }} result{{ provider.resultCount === 1 ? '' : 's' }}</small></div><span>{{ provider.durationMs }} ms</span></article></div>
      <div v-if="state.conflicts.length" class="conflicts"><h4><AlertTriangle :size="17" /> Conflicts</h4><article v-for="conflict in state.conflicts" :key="conflict.field"><strong>{{ label(conflict.field) }}</strong><span v-for="entry in conflict.values" :key="`${entry.source}-${entry.value}`">{{ label(entry.source) }}: {{ display(entry.value) }}</span></article></div>
      <div class="field-list"><article v-for="entry in fields" :key="entry.field"><div class="field-title"><strong>{{ label(entry.field) }}</strong><span :class="{ manual: entry.provenance.source === 'manual' }">{{ label(entry.provenance.source || 'unknown') }} · {{ Math.round((entry.provenance.confidence || 0) * 100) }}%</span></div><p>{{ display(entry.value) }}</p><small>{{ entry.decision?.reason || 'resolved metadata value' }}</small></article></div>
      <div v-if="state.coverCandidates.length" class="covers"><h4>Cover candidates</h4><div><button v-for="cover in state.coverCandidates.slice(0, 6)" :key="cover.url" type="button" :class="{ selected: state.selectedCover?.url === cover.url }" @click="metadataStore.selectCover(cover)"><img :src="cover.url" alt="Book cover candidate" /><span>{{ label(cover.source) }}</span></button></div></div>
      <div v-if="state.errors.length" class="warnings"><p v-for="error in state.errors" :key="`${error.providerId}-${error.message}`">{{ label(error.providerId) }}: {{ error.message }}</p></div>
      <p v-if="saveError" class="error save-error">{{ saveError }}</p>
      <footer><button class="secondary-action" type="button" @click="close">Cancel</button><button class="inspect-button" type="button" :disabled="saving" @click="apply"><Check :size="16" /> {{ saving ? 'Saving…' : 'Accept proposal' }}</button></footer>
    </template>
  </section>
</template>

<style scoped>
.inspector{margin-top:18px;border:1px solid #dfe4ea;border-radius:16px;background:#fff;overflow:hidden}.inspector-head{display:flex;justify-content:space-between;gap:16px;padding:18px;border-bottom:1px solid #edf0f3}.inspector-head span{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#667085}.inspector-head h3{margin:3px 0 2px}.inspector-head p,.inspector-empty p{margin:0;color:#667085;font-size:13px}.icon-button{border:0;background:transparent;cursor:pointer}.inspector-empty{display:grid;justify-items:center;text-align:center;gap:10px;padding:28px}.inspect-button,.secondary-action{display:inline-flex;align-items:center;justify-content:center;gap:7px;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer}.inspect-button{border:0;background:#1f6feb;color:#fff}.secondary-action{border:1px solid #d0d5dd;background:#fff}.provider-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;padding:16px}.provider-grid article{display:flex;justify-content:space-between;gap:10px;padding:11px;border-radius:10px;background:#f7f9fb}.provider-grid article.failed{background:#fff1f1;color:#9b1c1c}.provider-grid article div{display:grid}.provider-grid small{color:#667085}.field-list{display:grid;gap:8px;padding:0 16px 16px}.field-list article{padding:13px;border:1px solid #e7eaee;border-radius:11px}.field-title{display:flex;justify-content:space-between;gap:12px}.field-title span{font-size:11px;color:#667085}.field-title span.manual{color:#067647;font-weight:700}.field-list p{margin:8px 0;white-space:pre-wrap}.field-list small{color:#667085}.conflicts,.covers,.warnings{margin:0 16px 16px;padding:14px;border-radius:11px}.conflicts{background:#fffaeb}.conflicts h4{display:flex;align-items:center;gap:6px;margin:0 0 10px}.conflicts article{display:grid;gap:3px}.covers{background:#f8fafc}.covers h4{margin:0 0 10px}.covers>div{display:flex;gap:10px;overflow:auto}.covers button{min-width:88px;border:2px solid transparent;border-radius:10px;padding:5px;background:#fff}.covers button.selected{border-color:#1f6feb}.covers img{width:76px;height:110px;object-fit:cover;border-radius:6px}.covers span{display:block;font-size:10px;margin-top:4px}.warnings{background:#fff1f1;color:#9b1c1c}.warnings p{margin:0}footer{display:flex;justify-content:flex-end;gap:10px;padding:16px;border-top:1px solid #edf0f3}.error{color:#b42318!important}.save-error{padding:0 16px}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
</style>
