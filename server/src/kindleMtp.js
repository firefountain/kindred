import Mtp from 'webmtp';
import { resolveKindleItems } from './kindleResolver.js';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const VENDOR_ID = 0x1949;
const PRODUCT_ID = 0x9981;
const GET_OBJECT_HANDLES = 0x1007;
const GET_OBJECT_INFO = 0x1008;
const GET_OBJECT = 0x1009;
const ASSOCIATION_FORMAT = 0x3001;
const ROOT_PARENT = 0xffffffff;
const BOOK_EXTENSIONS = new Set(['.epub', '.mobi', '.azw', '.azw3', '.pdf', '.kfx']);

function extension(name) {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
}

function timeout(promise, label, ms = 30_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function waitForReady(mtp) {
  return timeout(new Promise((resolve, reject) => {
    mtp.addEventListener('ready', resolve, { once: true });
    mtp.addEventListener('error', () => reject(new Error('Unable to claim the Kindle USB interface. Close OpenMTP and retry.')), { once: true });
  }), 'Kindle USB connection');
}

function readString(view, offset) {
  const length = view.getUint8(offset);
  if (!length) return { value: '', offset: offset + 1 };
  const bytes = Math.max(0, (length - 1) * 2);
  const value = new TextDecoder('utf-16le').decode(new Uint8Array(view.buffer, view.byteOffset + offset + 1, bytes));
  return { value, offset: offset + 1 + length * 2 };
}

function parseObjectInfo(payload, handle) {
  const view = new DataView(payload);
  let offset = 0;
  const u16 = () => { const value = view.getUint16(offset, true); offset += 2; return value; };
  const u32 = () => { const value = view.getUint32(offset, true); offset += 4; return value; };

  const storageId = u32();
  const formatCode = u16();
  const protectionStatus = u16();
  const size = u32();
  const thumbFormat = u16();
  const thumbSize = u32();
  const thumbWidth = u32();
  const thumbHeight = u32();
  const imageWidth = u32();
  const imageHeight = u32();
  const imageBitDepth = u32();
  const parentHandle = u32();
  const associationType = u16();
  const associationDescription = u32();
  const sequenceNumber = u32();
  const filename = readString(view, offset); offset = filename.offset;
  const captureDate = readString(view, offset); offset = captureDate.offset;
  const modifiedDate = readString(view, offset); offset = modifiedDate.offset;
  const keywords = readString(view, offset);

  return {
    handle,
    storageId,
    formatCode,
    protectionStatus,
    size,
    thumbFormat,
    thumbSize,
    thumbWidth,
    thumbHeight,
    imageWidth,
    imageHeight,
    imageBitDepth,
    parentHandle,
    associationType,
    associationDescription,
    sequenceNumber,
    filename: filename.value,
    captureDate: captureDate.value,
    modifiedDate: modifiedDate.value,
    keywords: keywords.value,
    isFolder: formatCode === ASSOCIATION_FORMAT,
  };
}

async function commandWithData(mtp, code, payload, label, ms = 30_000) {
  await timeout(mtp.write(mtp.buildContainerPacket({ type: 1, code, payload })), `${label} write`, ms);
  const data = await timeout(mtp.readData(), `${label} data`, ms);
  return data;
}

async function getHandles(mtp, parentHandle = ROOT_PARENT, storageId = 0xffffffff) {
  const data = await commandWithData(
    mtp,
    GET_OBJECT_HANDLES,
    [storageId, 0, parentHandle],
    `GetObjectHandles parent=${parentHandle}`,
    30_000,
  );
  const view = new DataView(data.payload);
  const count = view.byteLength >= 4 ? view.getUint32(0, true) : 0;
  const handles = [];
  for (let index = 0; index < count && 4 + index * 4 + 4 <= view.byteLength; index += 1) {
    handles.push(view.getUint32(4 + index * 4, true));
  }
  return handles;
}

async function getObjectInfo(mtp, handle) {
  const data = await commandWithData(mtp, GET_OBJECT_INFO, [handle], `GetObjectInfo ${handle}`);
  return parseObjectInfo(data.payload, handle);
}

async function getObjectBytes(mtp, handle, label = `GetObject ${handle}`) {
  const data = await commandWithData(mtp, GET_OBJECT, [handle], label, 60_000);
  return new Uint8Array(data.payload.slice(0));
}

function parseCalibreMetadata(bytes) {
  if (!bytes?.byteLength) return [];
  let text = new TextDecoder('utf-8').decode(bytes);
  text = text.replace(/^\uFEFF/, '').replace(/\0+$/g, '').trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.books)) return parsed.books;
  if (parsed && typeof parsed === 'object') return Object.values(parsed).filter(value => value && typeof value === 'object');
  return [];
}

function buildPath(info, byHandle) {
  const parts = [info.filename];
  const visited = new Set([info.handle]);
  let parent = info.parentHandle;
  while (parent && parent !== ROOT_PARENT && byHandle.has(parent) && !visited.has(parent)) {
    visited.add(parent);
    const parentInfo = byHandle.get(parent);
    if (parentInfo.filename) parts.unshift(parentInfo.filename);
    parent = parentInfo.parentHandle;
  }
  return `/${parts.join('/')}`;
}

function inferFromFilename(filename) {
  const base = filename.replace(/\.[^.]+$/, '').replaceAll('_', ' ').trim();
  const parts = base.split(/\s+-\s+/);
  return parts.length > 1
    ? { authors: [parts.at(-1)], title: parts.slice(0, -1).join(' - ') }
    : { title: base, authors: [] };
}


function normalizeLogicalTitle(name) {
  return name
    .replace(/\.sdr$/i, '')
    .replace(/_[0-9a-f]{8}-[0-9a-f-]{27,}$/i, '')
    .replace(/_B[0-9A-Z]{9}$/i, '')
    .replace(/_OP[0-9A-Z]{20,}$/i, '')
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isExcludedPath(path) {
  const value = path.toLowerCase();
  return value.includes('/documents/.cache/')
    || value.includes('/documents/dictionaries/')
    || value.includes('/assets/')
    || value.includes('/data/')
    || value.endsWith('/metadata.kfx')
    || value.endsWith('/voucher');
}

function isPeriodicalTitle(title) {
  return /^(bbc news|independent, the|economico)(_|\b)/i.test(title);
}


function detectKindleIdentity() {
  let serialNumber = '';
  if (process.platform === 'darwin') {
    try {
      const output = execFileSync('system_profiler', ['SPUSBDataType'], { encoding: 'utf8', timeout: 8000 });
      const kindleBlock = output.match(/Kindle:\s*([\s\S]*?)(?:\n\s{4}\S|$)/i)?.[1] || '';
      serialNumber = kindleBlock.match(/Serial Number:\s*([^\n]+)/i)?.[1]?.trim() || '';
    } catch { /* identity is optional */ }
  }
  const identity = serialNumber || `${VENDOR_ID.toString(16)}:${PRODUCT_ID.toString(16)}:kindle`;
  return {
    serialNumber,
    id: crypto.createHash('sha1').update(identity).digest('hex').slice(0, 16),
  };
}

function logicalKey(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export async function scanKindleMtp({ onProgress } = {}) {
  const mtp = new Mtp(VENDOR_ID, PRODUCT_ID);
  const startedAt = Date.now();
  const report = (phase, current = 0, total = 0) => onProgress?.({ phase, current, total });

  try {
    report('connecting');
    await waitForReady(mtp);
    await timeout(mtp.openSession(), 'MTP open session');

    report('listing');

    // GetObjectHandles with ROOT_PARENT returns only the storage root objects on
    // this Kindle. Find /documents first, then walk that subtree by repeatedly
    // asking for the direct children of each folder handle.
    const rootHandles = await getHandles(mtp);
    const byHandle = new Map();

    for (let index = 0; index < rootHandles.length; index += 1) {
      const handle = rootHandles[index];
      report('inspecting roots', index + 1, rootHandles.length);
      try {
        byHandle.set(handle, await getObjectInfo(mtp, handle));
      } catch (error) {
        console.warn(`Skipping MTP root object ${handle}: ${error.message}`);
      }
    }

    const rootObjects = [...byHandle.values()];
    const documents = rootObjects.find(
      info => info.isFolder && info.filename.toLowerCase() === 'documents',
    );

    if (!documents) {
      throw new Error('The Kindle connected, but its /documents folder was not found.');
    }

    // Calibre writes a compact metadata database at the device root. It is the
    // richest and cheapest source available, so read it before crawling the
    // documents tree. File-name inference is only a fallback.
    const calibreObject = rootObjects.find(
      info => !info.isFolder && info.filename.toLowerCase() === 'metadata.calibre',
    );
    const driveInfoObject = rootObjects.find(
      info => !info.isFolder && info.filename.toLowerCase() === 'driveinfo.calibre',
    );
    let driveInfo = {};
    if (driveInfoObject) {
      try {
        const bytes = await getObjectBytes(mtp, driveInfoObject.handle, 'Read driveinfo.calibre');
        const raw = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '').replace(/\0+$/g, '').trim();
        driveInfo = raw ? JSON.parse(raw) : {};
      } catch (error) {
        console.warn(`Unable to read driveinfo.calibre: ${error.message}`);
      }
    }
    let calibreMetadata = [];
    if (calibreObject) {
      report('reading calibre metadata', 0, 1);
      try {
        const bytes = await getObjectBytes(mtp, calibreObject.handle, 'Read metadata.calibre');
        calibreMetadata = parseCalibreMetadata(bytes);
        report('reading calibre metadata', 1, 1);
      } catch (error) {
        console.warn(`Unable to read metadata.calibre: ${error.message}`);
      }
    }

    const queue = [{ handle: documents.handle, storageId: documents.storageId }];
    const visitedFolders = new Set();
    let inspected = rootHandles.length;

    while (queue.length) {
      const folder = queue.shift();
      const folderHandle = folder.handle;
      if (visitedFolders.has(folderHandle)) continue;
      visitedFolders.add(folderHandle);

      let childHandles;
      try {
        childHandles = await getHandles(mtp, folderHandle, folder.storageId);
      } catch (error) {
        console.warn(`Unable to list children of MTP folder ${folderHandle}: ${error.message}`);
        continue;
      }

      for (const handle of childHandles) {
        if (byHandle.has(handle)) continue;
        inspected += 1;
        report('inspecting documents', inspected, inspected + queue.length + childHandles.length);
        try {
          const info = await getObjectInfo(mtp, handle);
          byHandle.set(handle, info);
          if (info.isFolder) queue.push({ handle, storageId: info.storageId });
        } catch (error) {
          // One damaged sidecar should not invalidate the entire library scan.
          console.warn(`Skipping MTP object ${handle}: ${error.message}`);
        }
      }
    }

    const items = resolveKindleItems(byHandle, buildPath, calibreMetadata);

    const identity = detectKindleIdentity();

    return {
      device: {
        connected: true,
        transport: 'mtp',
        name: 'Kindle Scribe',
        id: identity.id,
        serialNumber: identity.serialNumber,
        vendorId: `0x${VENDOR_ID.toString(16)}`,
        productId: `0x${PRODUCT_ID.toString(16)}`,
        objectCount: byHandle.size,
        scanDurationMs: Date.now() - startedAt,
        calibreMetadataCount: calibreMetadata.length,
        serialNumber: String(mtp?.device?.serialNumber || mtp?.serialNumber || driveInfo.device_serial || ''),
        deviceStoreUuid: String(driveInfo.device_store_uuid || driveInfo.store_uuid || ''),
        deviceUuid: String(driveInfo.device_uuid || driveInfo.uuid || ''),
        calibreDeviceName: String(driveInfo.device_name || ''),
      },
      items,
      books: items.filter(item => item.type === 'book'),
      calibre: {
        entries: calibreMetadata,
        object: calibreObject ? {
          handle: calibreObject.handle,
          storageId: calibreObject.storageId,
          parentHandle: calibreObject.parentHandle,
          formatCode: calibreObject.formatCode,
          filename: calibreObject.filename,
          size: calibreObject.size,
        } : null,
        driveInfo,
      },
    };
  } finally {
    report('closing');
    await timeout(mtp.close(), 'MTP close', 10_000).catch(error => {
      console.warn(`MTP close warning: ${error.message}`);
    });
  }
}

const DELETE_OBJECT = 0x100b;
const SEND_OBJECT_INFO = 0x100c;
const SEND_OBJECT = 0x100d;
const UNDEFINED_FORMAT = 0x3000;

function encodeMtpString(value = '') {
  const text = String(value);
  if (!text) return new Uint8Array([0]);
  // Node's TextEncoder is UTF-8 only, so write UTF-16LE manually.
  const out = new Uint8Array(1 + (text.length + 1) * 2);
  out[0] = Math.min(255, text.length + 1);
  const view = new DataView(out.buffer);
  for (let i = 0; i < text.length; i += 1) view.setUint16(1 + i * 2, text.charCodeAt(i), true);
  view.setUint16(1 + text.length * 2, 0, true);
  return out;
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.byteLength; }
  return out;
}

function numberBytes(size, value) {
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  if (size === 2) view.setUint16(0, value, true);
  else view.setUint32(0, value >>> 0, true);
  return new Uint8Array(buffer);
}

function buildObjectInfoDataset({ storageId, parentHandle = 0, filename, size }) {
  return concatBytes(
    numberBytes(4, storageId), numberBytes(2, UNDEFINED_FORMAT), numberBytes(2, 0),
    numberBytes(4, size), numberBytes(2, 0), numberBytes(4, 0), numberBytes(4, 0),
    numberBytes(4, 0), numberBytes(4, 0), numberBytes(4, 0), numberBytes(4, 0),
    numberBytes(4, parentHandle), numberBytes(2, 0), numberBytes(4, 0), numberBytes(4, 0),
    encodeMtpString(filename), encodeMtpString(''), encodeMtpString(''), encodeMtpString(''),
  );
}

function buildDataPacket(code, transactionId, payload) {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const buffer = new ArrayBuffer(12 + bytes.byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, buffer.byteLength, true);
  view.setUint16(4, 2, true);
  view.setUint16(6, code, true);
  view.setUint32(8, transactionId, true);
  new Uint8Array(buffer, 12).set(bytes);
  return buffer;
}

async function readResponse(mtp, label, ms = 30_000) {
  return timeout((async () => {
    for (;;) {
      const packet = await mtp.read();
      if (!packet) throw new Error(`${label}: no MTP response`);
      if (packet.type === 'Response Block') return packet;
    }
  })(), label, ms);
}

async function deleteObject(mtp, handle) {
  await timeout(mtp.write(mtp.buildContainerPacket({ type: 1, code: DELETE_OBJECT, payload: [handle, 0] })), 'DeleteObject write');
  const response = await readResponse(mtp, 'DeleteObject response');
  if (response.code !== 'OK') throw new Error(`DeleteObject failed: ${response.code}`);
}

async function sendObject(mtp, { storageId, parentHandle, filename, bytes }) {
  const info = buildObjectInfoDataset({ storageId, parentHandle: parentHandle === ROOT_PARENT ? 0 : parentHandle, filename, size: bytes.byteLength });
  const infoTx = mtp.transactionID;
  await timeout(mtp.write(mtp.buildContainerPacket({ type: 1, code: SEND_OBJECT_INFO, payload: [storageId, parentHandle] })), 'SendObjectInfo command');
  await timeout(mtp.write(buildDataPacket(SEND_OBJECT_INFO, infoTx, info)), 'SendObjectInfo data');
  const infoResponse = await readResponse(mtp, 'SendObjectInfo response');
  if (infoResponse.code !== 'OK') throw new Error(`SendObjectInfo failed: ${infoResponse.code}`);
  const newHandle = infoResponse.parameters?.[2] || infoResponse.parameters?.at(-1) || 0;

  const objectTx = mtp.transactionID;
  await timeout(mtp.write(mtp.buildContainerPacket({ type: 1, code: SEND_OBJECT, payload: [] })), 'SendObject command');
  await timeout(mtp.write(buildDataPacket(SEND_OBJECT, objectTx, bytes)), 'SendObject data', 60_000);
  const objectResponse = await readResponse(mtp, 'SendObject response', 60_000);
  if (objectResponse.code !== 'OK') throw new Error(`SendObject failed: ${objectResponse.code}`);
  return newHandle;
}

function normalized(value = '') {
  return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizedPath(value = '') {
  return String(value).replaceAll('\\', '/').replace(/^\/+/, '').replace(/^documents\//i, '').toLowerCase();
}

function entryIdentifiers(entry = {}) {
  const ids = entry.identifiers && typeof entry.identifiers === 'object' ? entry.identifiers : {};
  return { ...ids };
}

function tokenSet(value = '') {
  return new Set(normalized(value).split(/\s+/).filter(token => token.length > 1));
}

function similarity(left = '', right = '') {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / Math.max(a.size, b.size);
}

function authorSimilarity(entry, item) {
  const left = (entry.authors || []).join(' ');
  const right = (item.authors || []).join(' ');
  return similarity(left, right);
}

function entryPath(entry = {}) {
  return String(entry.lpath || entry.path || entry.filepath || entry.relativePath || '');
}

function basenameStem(value = '') {
  const name = String(value).replaceAll('\\\\', '/').split('/').at(-1) || '';
  return name
    .replace(/\.sdr$/i, '')
    .replace(/\.(azw3?|mobi|epub|pdf|kfx)$/i, '')
    .replace(/_[0-9a-f]{8}-[0-9a-f-]{27,}$/i, '')
    .replace(/_B[0-9A-Z]{9}$/i, '');
}

function scoreEntryForItem(entry, item) {
  let score = 0;
  const reasons = [];
  const ids = entryIdentifiers(entry);
  const itemUuid = String(item.calibreUuid || '').toLowerCase();
  const entryUuid = String(entry.uuid || '').toLowerCase();
  if (itemUuid && entryUuid && itemUuid === entryUuid) { score += 1200; reasons.push('uuid'); }

  const ep = normalizedPath(entryPath(entry));
  const ip = normalizedPath(item.calibrePath || item.relativePath);
  if (ep && ip && ep === ip) { score += 900; reasons.push('path'); }
  else if (ep && ip && (ep.endsWith(ip) || ip.endsWith(ep))) { score += 500; reasons.push('path-suffix'); }

  const entryAsin = String(ids.amazon || ids.asin || '').replace(/^amazon:/i, '').toUpperCase();
  const itemAsin = String(item.asin || '').replace(/^amazon:/i, '').toUpperCase();
  if (entryAsin && itemAsin && entryAsin === itemAsin) { score += 850; reasons.push('asin'); }

  const entryIsbn = String(ids.isbn || '').replace(/[^0-9X]/gi, '').toUpperCase();
  const itemIsbn = String(item.isbn || '').replace(/[^0-9X]/gi, '').toUpperCase();
  if (entryIsbn && itemIsbn && entryIsbn === itemIsbn) { score += 800; reasons.push('isbn'); }

  const titleScore = similarity(entry.title, item.title);
  const authorScore = authorSimilarity(entry, item);
  if (normalized(entry.title) === normalized(item.title) && normalized(entry.title)) {
    score += 600; reasons.push('title-exact');
  } else if (titleScore >= 0.8) {
    score += Math.round(titleScore * 420); reasons.push(`title:${titleScore.toFixed(2)}`);
  } else if (titleScore >= 0.55) {
    score += Math.round(titleScore * 260); reasons.push(`title:${titleScore.toFixed(2)}`);
  }
  if (authorScore >= 0.8) { score += 260; reasons.push(`author:${authorScore.toFixed(2)}`); }
  else if (authorScore >= 0.5) { score += 140; reasons.push(`author:${authorScore.toFixed(2)}`); }

  const fileScore = similarity(basenameStem(entryPath(entry)), basenameStem(item.fileName || item.relativePath));
  if (fileScore >= 0.8) { score += Math.round(fileScore * 300); reasons.push(`file:${fileScore.toFixed(2)}`); }
  else if (fileScore >= 0.55) { score += Math.round(fileScore * 170); reasons.push(`file:${fileScore.toFixed(2)}`); }

  return { entry, score, reasons };
}

function findEntryForItem(entries, item) {
  const ranked = entries
    .map(entry => scoreEntryForItem(entry, item))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < 300) return null;
  // Avoid silently writing to an ambiguous title when two candidates score almost equally.
  if (second && best.score < 700 && best.score - second.score < 50) return null;
  return best;
}

function updateCalibreEntry(entry, item) {
  const next = { ...entry };
  next.title = item.title || next.title || '';
  next.authors = Array.isArray(item.authors) ? item.authors : [];
  next.author_sort = next.authors.join(' & ');
  next.title_sort = next.title;
  next.publisher = item.publisher || '';
  next.comments = item.description || '';
  next.tags = Array.isArray(item.tags) ? item.tags : [];
  next.series = item.series || null;
  next.series_index = item.seriesIndex == null || item.seriesIndex === '' ? null : Number(item.seriesIndex);
  next.languages = item.language ? [item.language] : (next.languages || []);
  next.device_collections = Array.isArray(item.collections) ? item.collections : [];
  next.identifiers = { ...entryIdentifiers(next) };
  if (item.isbn) next.identifiers.isbn = item.isbn;
  if (item.asin) next.identifiers.amazon = item.asin;
  // Calibre metadata entries carry their own modification timestamp. Updating it
  // makes the catalogue change explicit to clients instead of looking stale.
  next.last_modified = new Date().toISOString();
  return next;
}

function prepareCalibreSync(entries, items) {
  const nextEntries = JSON.parse(JSON.stringify(entries || []));
  const changes = [];
  const skipped = [];
  for (const item of items || []) {
    if (item.type !== 'book') continue;
    const match = findEntryForItem(nextEntries, item);
    if (!match) { skipped.push({ itemId: item.id, title: item.title, reason: 'No confident metadata.calibre match' }); continue; }
    const entry = match.entry;
    const before = JSON.stringify(entry);
    Object.assign(entry, updateCalibreEntry(entry, item));
    if (JSON.stringify(entry) !== before) changes.push({ itemId: item.id, title: item.title, calibreUuid: entry.uuid || '', path: entry.lpath || entry.path || '', matchScore: match.score, matchedBy: match.reasons });
  }
  return { entries: nextEntries, changes, skipped };
}


function sha256(bytes) {
  return crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

async function readRootCalibreFile(mtp) {
  const rootHandles = await getHandles(mtp);
  const roots = [];
  for (const handle of rootHandles) roots.push(await getObjectInfo(mtp, handle));
  const current = roots.find(info => !info.isFolder && info.filename.toLowerCase() === 'metadata.calibre');
  if (!current) throw new Error('metadata.calibre was not found on this Kindle');
  const bytes = await getObjectBytes(mtp, current.handle, 'Read metadata.calibre');
  await readResponse(mtp, 'Read metadata.calibre completion');
  return { current, bytes };
}

function comparableEntry(entry = {}) {
  const ids = entryIdentifiers(entry);
  return {
    title: String(entry.title || ''),
    authors: Array.isArray(entry.authors) ? entry.authors.map(String) : [],
    publisher: String(entry.publisher || ''),
    comments: String(entry.comments || ''),
    tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
    series: entry.series == null ? null : String(entry.series),
    series_index: entry.series_index == null ? null : Number(entry.series_index),
    languages: Array.isArray(entry.languages) ? entry.languages.map(String) : [],
    device_collections: Array.isArray(entry.device_collections) ? entry.device_collections.map(String) : [],
    identifiers: {
      isbn: String(ids.isbn || ''),
      amazon: String(ids.amazon || ids.asin || ''),
    },
  };
}

function verifyPreparedChanges(entries, libraryItems, changes) {
  const verifiedChanges = [];
  const failedChanges = [];
  for (const change of changes || []) {
    const item = (libraryItems || []).find(candidate => candidate.id === change.itemId);
    if (!item) {
      failedChanges.push({ ...change, reason: 'Saved item not found during verification' });
      continue;
    }
    const entry = findEntryForItem(entries, item);
    if (!entry) {
      failedChanges.push({ ...change, reason: 'Entry missing after Kindle write' });
      continue;
    }
    const expected = comparableEntry(updateCalibreEntry(entry, item));
    const actual = comparableEntry(entry);
    // Ignore last_modified and compare only user-visible catalogue fields.
    if (JSON.stringify(actual) === JSON.stringify(expected)) verifiedChanges.push(change);
    else failedChanges.push({ ...change, reason: 'Read-back fields differ', expected, actual });
  }
  return { verifiedChanges, failedChanges };
}

export async function syncCalibreMetadataToKindle({ library, dryRun = true, backupDir = '' } = {}) {
  if (!library) throw new Error('Library is required');
  const mtp = new Mtp(VENDOR_ID, PRODUCT_ID);
  try {
    await waitForReady(mtp);
    await timeout(mtp.openSession(), 'MTP open session');
    const { current, bytes: originalBytes } = await readRootCalibreFile(mtp);
    const originalEntries = parseCalibreMetadata(originalBytes);
    const prepared = prepareCalibreSync(originalEntries, library.items || []);
    const payload = new TextEncoder().encode(JSON.stringify(prepared.entries));
    const preview = {
      dryRun: Boolean(dryRun),
      changedEntries: prepared.changes.length,
      skippedEntries: prepared.skipped.length,
      originalBytes: originalBytes.byteLength,
      outputBytes: payload.byteLength,
      originalSha256: sha256(originalBytes),
      outputSha256: sha256(payload),
      changes: prepared.changes,
      skipped: prepared.skipped,
    };
    if (dryRun || !prepared.changes.length) return preview;

    let backupPath = '';
    if (backupDir) {
      const fs = await import('node:fs');
      const path = await import('node:path');
      fs.mkdirSync(backupDir, { recursive: true });
      backupPath = path.join(backupDir, `metadata.calibre.${Date.now()}.backup`);
      fs.writeFileSync(backupPath, originalBytes);
    }

    await deleteObject(mtp, current.handle);
    try {
      const newHandle = await sendObject(mtp, {
        storageId: current.storageId,
        parentHandle: ROOT_PARENT,
        filename: 'metadata.calibre',
        bytes: payload,
      });
      // Do not trust a successful MTP response alone. Close, reconnect, read the
      // file back from the Kindle and compare the exact bytes we intended to write.
      await timeout(mtp.close(), 'MTP close before verification', 10_000).catch(() => undefined);

      const verifyMtp = new Mtp(VENDOR_ID, PRODUCT_ID);
      try {
        await waitForReady(verifyMtp);
        await timeout(verifyMtp.openSession(), 'MTP verification session');
        const { bytes: verifiedBytes } = await readRootCalibreFile(verifyMtp);
        const writtenSha256 = sha256(verifiedBytes);
        const verified = writtenSha256 === preview.outputSha256;
        if (!verified) {
          throw new Error(`Kindle write verification failed: expected ${preview.outputSha256}, read back ${writtenSha256}`);
        }
        const verifiedEntries = parseCalibreMetadata(verifiedBytes);
        const fieldVerification = verifyPreparedChanges(verifiedEntries, library.items || [], prepared.changes);
        if (fieldVerification.failedChanges.length) {
          throw new Error(`Kindle catalogue hash matched but ${fieldVerification.failedChanges.length} changed entr${fieldVerification.failedChanges.length === 1 ? 'y was' : 'ies were'} not readable with the expected metadata`);
        }
        return {
          ...preview,
          dryRun: false,
          written: true,
          verified: true,
          newHandle,
          backupPath,
          writtenSha256,
          verifiedEntries: fieldVerification.verifiedChanges.length,
          verifiedChanges: fieldVerification.verifiedChanges,
          target: 'metadata.calibre',
          affectsKindleDisplay: false,
        };
      } finally {
        await timeout(verifyMtp.close(), 'MTP verification close', 10_000).catch(() => undefined);
      }
    } catch (error) {
      try {
        await sendObject(mtp, {
          storageId: current.storageId,
          parentHandle: ROOT_PARENT,
          filename: 'metadata.calibre',
          bytes: originalBytes,
        });
      } catch (restoreError) {
        throw new Error(`${error.message}. Automatic rollback also failed: ${restoreError.message}. Backup: ${backupPath || 'not written'}`);
      }
      throw new Error(`${error.message}. Original metadata.calibre was restored.`);
    }
  } finally {
    await timeout(mtp.close(), 'MTP close', 10_000).catch(() => undefined);
  }
}


function safeUploadFilename(value = '') {
  return String(value)
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 220) || `book-${Date.now()}`;
}

export async function uploadBookToKindle({ filename, bytes } = {}) {
  if (!filename || !bytes?.byteLength) throw new Error('A non-empty book file is required');
  const mtp = new Mtp(VENDOR_ID, PRODUCT_ID);
  const cleanFilename = safeUploadFilename(filename);
  try {
    await waitForReady(mtp);
    await timeout(mtp.openSession(), 'MTP open session');
    const rootHandles = await getHandles(mtp);
    const roots = [];
    for (const handle of rootHandles) roots.push(await getObjectInfo(mtp, handle));
    const documents = roots.find(info => info.isFolder && info.filename.toLowerCase() === 'documents');
    if (!documents) throw new Error('The Kindle /documents folder was not found');

    const existingHandles = await getHandles(mtp, documents.handle, documents.storageId);
    const existing = [];
    for (const handle of existingHandles) {
      try { existing.push(await getObjectInfo(mtp, handle)); } catch { /* ignore damaged objects */ }
    }
    if (existing.some(info => !info.isFolder && info.filename.toLowerCase() === cleanFilename.toLowerCase())) {
      throw new Error(`A file named "${cleanFilename}" already exists in /documents`);
    }

    const handle = await sendObject(mtp, {
      storageId: documents.storageId,
      parentHandle: documents.handle,
      filename: cleanFilename,
      bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    });

    const uploaded = handle ? await getObjectInfo(mtp, handle).catch(() => null) : null;
    if (uploaded && uploaded.filename.toLowerCase() !== cleanFilename.toLowerCase()) {
      throw new Error('The Kindle returned an unexpected uploaded filename');
    }
    return {
      verified: Boolean(uploaded),
      handle,
      filename: cleanFilename,
      size: bytes.byteLength,
      path: `/documents/${cleanFilename}`,
    };
  } finally {
    await timeout(mtp.close(), 'MTP close', 10_000).catch(error => console.warn(`MTP close warning: ${error.message}`));
  }
}
