import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function createLibraryStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const stateFile = path.join(dataDir, 'kindred-state.json');

  function emptyState() {
    return { version: 1, activeLibraryId: '', libraries: {}, jobs: {} };
  }

  function read() {
    if (!fs.existsSync(stateFile)) return emptyState();
    try {
      const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      return { ...emptyState(), ...parsed, libraries: parsed.libraries || {}, jobs: parsed.jobs || {} };
    } catch {
      return emptyState();
    }
  }

  function write(state) {
    const tmp = `${stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, stateFile);
  }

  function libraryId(identity = {}) {
    const stable = identity.serialNumber || identity.deviceStoreUuid || identity.deviceUuid
      || `${identity.vendorId || ''}:${identity.productId || ''}:${identity.name || 'kindle'}`;
    return `lib_${crypto.createHash('sha1').update(stable).digest('hex').slice(0, 14)}`;
  }

  function list() {
    const state = read();
    return Object.values(state.libraries)
      .map(({ items, ...library }) => ({ ...library, itemCount: items?.length || 0 }))
      .sort((a, b) => String(b.lastScannedAt || '').localeCompare(String(a.lastScannedAt || '')));
  }

  function get(id) {
    return read().libraries[id] || null;
  }

  function active() {
    const state = read();
    return state.libraries[state.activeLibraryId] || null;
  }

  function setActive(id) {
    const state = read();
    if (!state.libraries[id]) return null;
    state.activeLibraryId = id;
    state.libraries[id].lastOpenedAt = new Date().toISOString();
    write(state);
    return state.libraries[id];
  }

  function normalize(value = '') {
    return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function normalizePath(value = '') {
    return String(value).replaceAll('\\', '/').replace(/^\/+/, '').replace(/^documents\//i, '').toLowerCase();
  }

  function identityKeys(item = {}) {
    const keys = [];
    if (item.calibreUuid) keys.push(`uuid:${String(item.calibreUuid).toLowerCase()}`);
    if (item.calibrePath) keys.push(`path:${normalizePath(item.calibrePath)}`);
    if (item.relativePath) keys.push(`path:${normalizePath(item.relativePath)}`);
    if (item.asin) keys.push(`asin:${String(item.asin).toUpperCase()}`);
    if (item.isbn) keys.push(`isbn:${String(item.isbn).replace(/[^0-9X]/gi, '').toUpperCase()}`);
    const title = normalize(item.title);
    const author = normalize(item.authors?.[0]);
    if (title) keys.push(`book:${title}:${author}`);
    return [...new Set(keys.filter(Boolean))];
  }

  function mergeScannedItem(fresh, saved) {
    if (!saved) return fresh;
    const merged = {
      ...fresh,
      ...saved,
      // Device facts must always come from the fresh scan.
      id: fresh.id,
      mtpHandle: fresh.mtpHandle,
      storageId: fresh.storageId,
      fileName: fresh.fileName,
      relativePath: fresh.relativePath,
      format: fresh.format,
      size: fresh.size,
      modifiedAt: fresh.modifiedAt,
      sourceKind: fresh.sourceKind,
      lastSeenAt: new Date().toISOString(),
      metadataSource: { ...(fresh.metadataSource || {}), ...(saved.metadataSource || {}) },
    };
    return merged;
  }

  function saveScan(result) {
    const state = read();
    const id = libraryId(result.device);
    const previous = state.libraries[id] || {};
    const previousByKey = new Map();
    for (const saved of previous.items || []) {
      previousByKey.set(`id:${saved.id}`, saved);
      for (const key of identityKeys(saved)) if (!previousByKey.has(key)) previousByKey.set(key, saved);
    }
    const items = (result.items || []).map(item => {
      let saved = previousByKey.get(`id:${item.id}`);
      if (!saved) {
        for (const key of identityKeys(item)) {
          saved = previousByKey.get(key);
          if (saved) break;
        }
      }
      return mergeScannedItem(item, saved);
    });
    const now = new Date().toISOString();
    state.libraries[id] = {
      id,
      name: previous.name || result.device.name || 'Kindle Library',
      kind: 'kindle-mtp',
      device: { ...result.device, connected: true },
      createdAt: previous.createdAt || now,
      lastScannedAt: now,
      lastOpenedAt: now,
      items,
      calibre: result.calibre || previous.calibre || null,
      sync: previous.sync || null,
    };
    state.activeLibraryId = id;
    write(state);
    return state.libraries[id];
  }

  function updateItem(libraryIdValue, itemId, patch) {
    const state = read();
    const library = state.libraries[libraryIdValue];
    if (!library) return null;
    const index = (library.items || []).findIndex(item => item.id === itemId);
    if (index < 0) return null;
    const current = library.items[index];
    const editable = ['type','title','subtitle','authors','isbn','asin','publisher','language','description','coverUrl','series','seriesIndex','tags','collections'];
    const editedSource = { ...(current.metadataSource || {}), ...(patch.metadataSource || {}) };
    for (const key of editable) {
      if (key in patch && JSON.stringify(patch[key]) !== JSON.stringify(current[key])) editedSource[key] = 'Kindred edit';
    }
    library.items[index] = { ...current, ...patch, metadataSource: editedSource, id: itemId, updatedAt: new Date().toISOString() };
    write(state);
    return library.items[index];
  }

  function replaceItem(libraryIdValue, item) {
    return updateItem(libraryIdValue, item.id, item);
  }

  function updateLibrary(id, patch = {}) {
    const state = read();
    if (!state.libraries[id]) return null;
    state.libraries[id] = { ...state.libraries[id], ...patch, id, updatedAt: new Date().toISOString() };
    write(state);
    return state.libraries[id];
  }

  function rename(id, name) {
    const state = read();
    if (!state.libraries[id]) return null;
    state.libraries[id].name = String(name || '').trim() || state.libraries[id].name;
    write(state);
    return state.libraries[id];
  }

  return { read, write, list, get, active, setActive, saveScan, updateItem, replaceItem, updateLibrary, rename, libraryId, stateFile };
}
