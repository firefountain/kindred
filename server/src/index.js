import cors from 'cors';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import { scanKindleMtp, syncCalibreMetadataToKindle, uploadBookToKindle } from './kindleMtp.js';
import { createLibraryStore } from './libraryStore.js';
import { createMetadataRouter } from './metadataApi.js';

const app = express();
const PORT = Number(process.env.PORT || 4311);
const ROOT = path.resolve(process.cwd(), '..');

function defaultDataDir() {
  if (process.env.KINDRED_DATA_DIR) return path.resolve(process.env.KINDRED_DATA_DIR);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Kindred');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Kindred');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'kindred');
}

const DATA_DIR = defaultDataDir();
const LEGACY_DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'library.json');
const SUPPORTED = new Set(['.epub', '.mobi', '.azw', '.azw3', '.pdf', '.kfx']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 250 * 1024 * 1024, files: 20 } });

app.use(cors());
app.use(express.json({ limit: '2mb' }));
fs.mkdirSync(DATA_DIR, { recursive: true });

function migrateLegacyState() {
  if (path.resolve(DATA_DIR) === path.resolve(LEGACY_DATA_DIR)) return;
  const files = ['kindred-state.json', 'library.json'];
  for (const name of files) {
    const source = path.join(LEGACY_DATA_DIR, name);
    const target = path.join(DATA_DIR, name);
    if (!fs.existsSync(target) && fs.existsSync(source)) {
      fs.copyFileSync(source, target);
      console.log(`Migrated legacy Kindred state: ${source} -> ${target}`);
    }
  }
  const legacyBackups = path.join(LEGACY_DATA_DIR, 'backups');
  const targetBackups = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(targetBackups) && fs.existsSync(legacyBackups)) {
    fs.cpSync(legacyBackups, targetBackups, { recursive: true });
  }
}

migrateLegacyState();
const store = createLibraryStore(DATA_DIR);
const jobs = new Map();

let mtpCache = { device: { connected: false, transport: 'mtp' }, items: [], books: [], scannedAt: null };
let mtpScanPromise = null;
let mtpProgress = { phase: 'idle', current: 0, total: 0 };

function readDb() {
  if (!fs.existsSync(DB_FILE)) return { books: {}, settings: {}, libraries: {} };
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { books: {}, settings: {}, libraries: {} }; }
}

function writeDb(db) {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function candidateKindleRoots() {
  const roots = [];
  if (process.platform === 'darwin') roots.push('/Volumes/Kindle');
  if (process.platform === 'linux') {
    roots.push(`/media/${os.userInfo().username}/Kindle`, `/run/media/${os.userInfo().username}/Kindle`);
  }
  if (process.platform === 'win32') {
    for (let code = 68; code <= 90; code++) roots.push(`${String.fromCharCode(code)}:\\`);
  }
  if (process.env.KINDLE_PATH) roots.unshift(process.env.KINDLE_PATH);
  return [...new Set(roots)];
}

function detectKindle() {
  for (const root of candidateKindleRoots()) {
    try {
      const documents = path.join(root, 'documents');
      if (fs.statSync(root).isDirectory() && fs.statSync(documents).isDirectory()) {
        return { connected: true, root, documents };
      }
    } catch { /* not mounted here */ }
  }
  return { connected: false, candidates: candidateKindleRoots() };
}

function walk(dir, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, output);
    else if (SUPPORTED.has(path.extname(entry.name).toLowerCase())) output.push(full);
  }
  return output;
}

function text(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return text(value[0]);
  return text(value['#text'] ?? value._ ?? '');
}

function epubMetadataFromZip(zip) {
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const container = parser.parse(zip.readAsText('META-INF/container.xml'));
    const rootfile = container?.container?.rootfiles?.rootfile;
    const opfPath = Array.isArray(rootfile) ? rootfile[0]?.['@_full-path'] : rootfile?.['@_full-path'];
    if (!opfPath) return {};
    const opf = parser.parse(zip.readAsText(opfPath));
    const metadata = opf?.package?.metadata ?? {};
    const identifiers = Array.isArray(metadata['dc:identifier']) ? metadata['dc:identifier'] : [metadata['dc:identifier']].filter(Boolean);
    const isbn = identifiers.map(text).find(v => /^(97[89])?\d{9}[\dX]$/i.test(v.replace(/[-\s]/g, '')))?.replace(/[-\s]/g, '') ?? '';
    return {
      title: text(metadata['dc:title']),
      authors: (Array.isArray(metadata['dc:creator']) ? metadata['dc:creator'] : [metadata['dc:creator']]).filter(Boolean).map(text),
      publisher: text(metadata['dc:publisher']),
      language: text(metadata['dc:language']),
      description: text(metadata['dc:description']),
      isbn
    };
  } catch { return {}; }
}

function epubMetadata(filePath) {
  try { return epubMetadataFromZip(new AdmZip(filePath)); } catch { return {}; }
}

function epubMetadataBuffer(buffer) {
  try { return epubMetadataFromZip(new AdmZip(buffer)); } catch { return {}; }
}

function inferFromFilename(filePath) {
  const base = path.basename(filePath, path.extname(filePath)).replaceAll('_', ' ').trim();
  const parts = base.split(/\s+-\s+/);
  return parts.length > 1 ? { authors: [parts[0]], title: parts.slice(1).join(' - ') } : { title: base, authors: [] };
}

function makeBook(filePath, documentsRoot, saved) {
  const stat = fs.statSync(filePath);
  const relativePath = path.relative(documentsRoot, filePath);
  const id = crypto.createHash('sha1').update(relativePath).digest('hex').slice(0, 16);
  const embedded = path.extname(filePath).toLowerCase() === '.epub' ? epubMetadata(filePath) : {};
  const inferred = inferFromFilename(filePath);
  return {
    id,
    fileName: path.basename(filePath),
    relativePath,
    format: path.extname(filePath).slice(1).toUpperCase(),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    title: embedded.title || inferred.title,
    authors: embedded.authors?.length ? embedded.authors : inferred.authors,
    isbn: embedded.isbn || '',
    publisher: embedded.publisher || '',
    language: embedded.language || '',
    description: embedded.description || '',
    coverUrl: '',
    series: '',
    seriesIndex: null,
    tags: [],
    ...saved,
    id,
    relativePath,
    fileName: path.basename(filePath),
    format: path.extname(filePath).slice(1).toUpperCase(),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString()
  };
}


function ensureDbShape(db) {
  db.books ||= {};
  db.settings ||= {};
  db.libraries ||= {};
  return db;
}

function activeSnapshot(db = readDb()) {
  ensureDbShape(db);
  const id = db.settings.activeLibraryId;
  return id ? db.libraries[id] || null : null;
}

function loadSnapshotIntoCache(snapshot) {
  if (!snapshot) return false;
  mtpCache = {
    device: { ...(snapshot.device || {}), connected: false, remembered: true },
    items: snapshot.items || [],
    books: (snapshot.items || []).filter(item => item.type === 'book'),
    scannedAt: snapshot.scannedAt || null,
  };
  return true;
}

function persistCurrentLibrary(result = mtpCache) {
  const deviceId = result?.device?.id;
  if (!deviceId) return;
  const db = ensureDbShape(readDb());
  const previous = db.libraries[deviceId] || {};
  db.libraries[deviceId] = {
    ...previous,
    id: deviceId,
    name: result.device.name || previous.name || 'Kindle',
    serialNumber: result.device.serialNumber || previous.serialNumber || '',
    device: { ...result.device, connected: false, remembered: true },
    items: result.items || [],
    scannedAt: result.scannedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString(),
  };
  db.settings.activeLibraryId = deviceId;
  writeDb(db);
}

function librarySummaries() {
  const db = ensureDbShape(readDb());
  return {
    activeLibraryId: db.settings.activeLibraryId || '',
    libraries: Object.values(db.libraries).map(library => ({
      id: library.id,
      name: library.name || library.device?.name || 'Kindle',
      serialNumber: library.serialNumber || library.device?.serialNumber || '',
      scannedAt: library.scannedAt || null,
      updatedAt: library.updatedAt || null,
      itemCount: library.items?.length || 0,
      bookCount: library.items?.filter(item => item.type === 'book').length || 0,
    })).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))),
  };
}

// Restore the last opened library at startup. USB is optional after the first scan,
// which is rather the point of having a local catalogue.
loadSnapshotIntoCache(activeSnapshot());

const metadataCache = new Map();
let googleNextRequestAt = 0;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function plainText(value = '') {
  return String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function cleanLookupTitle(value = '') {
  const original = String(value)
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/_[0-9a-f]{8}-[0-9a-f-]{27,}$/i, '')
    .replace(/_B[0-9A-Z]{9}$/i, '')
    .replace(/\[[0-9.]+\]/g, ' ')
    .replace(/\([^)]*book\s*\d+[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chunks = original.split(/\s+-\s+/).map(x => x.trim()).filter(Boolean);
  const normalized = value => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const unique = [];
  for (const chunk of chunks) {
    const key = normalized(chunk);
    if (!key || unique.some(existing => normalized(existing) === key)) continue;
    unique.push(chunk);
  }
  if (unique.length > 1 && /^star wars\b/i.test(unique[0]) && unique.at(-1).length > 4) return unique.at(-1);
  return unique.join(' - ') || original;
}

function itemLookup(itemOrQuery) {
  if (typeof itemOrQuery === 'string') return { title: cleanLookupTitle(itemOrQuery), author: '', isbn: '' };
  return {
    title: cleanLookupTitle(itemOrQuery?.title || ''),
    author: String(itemOrQuery?.authors?.[0] || '').trim(),
    isbn: String(itemOrQuery?.isbn || '').replace(/[^0-9X]/gi, ''),
  };
}

async function fetchJson(url, options = {}, label = 'Metadata provider') {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${label} returned ${response.status}`);
  return response.json();
}

async function googleBooks(input) {
  const { title, author, isbn } = itemLookup(input);
  const url = new URL('https://www.googleapis.com/books/v1/volumes');
  const terms = isbn ? [`isbn:${isbn}`] : [`intitle:${title}`, ...(author ? [`inauthor:${author}`] : [])];
  url.searchParams.set('q', terms.join('+'));
  url.searchParams.set('maxResults', '10');
  url.searchParams.set('projection', 'full');
  if (process.env.GOOGLE_BOOKS_API_KEY) url.searchParams.set('key', process.env.GOOGLE_BOOKS_API_KEY);

  const wait = Math.max(0, googleNextRequestAt - Date.now());
  if (wait) await sleep(wait);
  googleNextRequestAt = Date.now() + 450;

  let response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (response.status === 429) {
    await sleep(1600);
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  }
  if (!response.ok) throw new Error(`Google Books returned ${response.status}`);
  const data = await response.json();
  return (data.items || []).map(({ id, volumeInfo: v = {} }) => ({
    source: 'Google Books', sourceId: id, title: v.title || '', subtitle: v.subtitle || '', authors: v.authors || [],
    publisher: v.publisher || '', publishedDate: v.publishedDate || '', description: plainText(v.description || ''),
    isbn: (v.industryIdentifiers || []).find(x => x.type === 'ISBN_13')?.identifier || (v.industryIdentifiers || [])[0]?.identifier || '',
    language: v.language || '', tags: v.categories || [], coverUrl: (v.imageLinks?.extraLarge || v.imageLinks?.large || v.imageLinks?.medium || v.imageLinks?.thumbnail || '').replace('http:', 'https:')
  }));
}

async function openLibrary(input) {
  const { title, author, isbn } = itemLookup(input);
  const url = new URL('https://openlibrary.org/search.json');
  if (isbn) url.searchParams.set('isbn', isbn);
  else {
    url.searchParams.set('title', title);
    if (author) url.searchParams.set('author', author);
  }
  url.searchParams.set('limit', '12');
  url.searchParams.set('fields', 'key,title,subtitle,author_name,isbn,publisher,first_publish_year,language,subject,cover_i');
  const data = await fetchJson(url, { headers: { 'User-Agent': 'Kindred/0.8 (local ebook metadata manager)' } }, 'Open Library');
  return (data.docs || []).map(v => ({
    source: 'Open Library', sourceId: v.key, title: v.title || '', subtitle: v.subtitle || '', authors: v.author_name || [],
    publisher: v.publisher?.[0] || '', publishedDate: String(v.first_publish_year || ''), description: '',
    isbn: v.isbn?.find(x => x.length === 13) || v.isbn?.[0] || '', language: v.language?.[0] || '',
    tags: (v.subject || []).slice(0, 20), coverUrl: v.cover_i ? `https://covers.openlibrary.org/b/id/${v.cover_i}-L.jpg` : ''
  }));
}

async function crossref(input) {
  const { title, author, isbn } = itemLookup(input);
  const url = new URL('https://api.crossref.org/works');
  url.searchParams.set('rows', '8');
  url.searchParams.set('select', 'DOI,title,subtitle,author,publisher,published-print,published-online,ISBN,type,abstract');
  url.searchParams.set('query.bibliographic', [title, author, isbn].filter(Boolean).join(' '));
  url.searchParams.set('filter', 'type:book');
  if (process.env.CROSSREF_MAILTO) url.searchParams.set('mailto', process.env.CROSSREF_MAILTO);
  const data = await fetchJson(url, { headers: { 'User-Agent': `Kindred/0.8${process.env.CROSSREF_MAILTO ? ` (mailto:${process.env.CROSSREF_MAILTO})` : ''}` } }, 'Crossref');
  return (data.message?.items || []).map(v => ({
    source: 'Crossref', sourceId: v.DOI || v.ISBN?.[0] || v.title?.[0], title: v.title?.[0] || '', subtitle: v.subtitle?.[0] || '',
    authors: (v.author || []).map(a => [a.given, a.family].filter(Boolean).join(' ')), publisher: v.publisher || '',
    publishedDate: String(v['published-print']?.['date-parts']?.[0]?.[0] || v['published-online']?.['date-parts']?.[0]?.[0] || ''),
    description: plainText(v.abstract || ''), isbn: (v.ISBN || []).find(x => x.replace(/\D/g, '').length === 13) || v.ISBN?.[0] || '',
    language: '', tags: [], coverUrl: ''
  }));
}


async function libraryOfCongress(input) {
  const { title, author, isbn } = itemLookup(input);
  const url = new URL('https://www.loc.gov/books/');
  url.searchParams.set('fo', 'json');
  url.searchParams.set('c', '12');
  url.searchParams.set('q', [isbn || title, author].filter(Boolean).join(' '));
  const data = await fetchJson(url, { headers: { 'User-Agent': 'Kindred/0.8 (local ebook metadata manager)' } }, 'Library of Congress');
  return (data.results || []).map(v => ({
    source: 'Library of Congress',
    sourceId: v.id || v.url || v.title,
    title: v.title || '',
    subtitle: '',
    authors: Array.isArray(v.contributor) ? v.contributor.slice(0, 5) : [],
    publisher: Array.isArray(v.publisher) ? v.publisher[0] : (v.publisher || ''),
    publishedDate: Array.isArray(v.date) ? v.date[0] : (v.date || ''),
    description: plainText(Array.isArray(v.description) ? v.description[0] : (v.description || '')),
    isbn: (Array.isArray(v.number) ? v.number : []).map(String).find(value => /isbn/i.test(value))?.replace(/^.*?([0-9X-]{10,17}).*$/i, '$1').replace(/-/g, '') || '',
    language: Array.isArray(v.language) ? v.language[0] : (v.language || ''),
    tags: [...(v.subject || []), ...(v.partof || [])].slice(0, 20),
    coverUrl: v.image_url?.[0] || v.image || '',
  }));
}

async function isbnDb(input) {
  if (!process.env.ISBNDB_API_KEY) return [];
  const { title, author, isbn } = itemLookup(input);
  const url = isbn
    ? new URL(`https://api2.isbndb.com/book/${encodeURIComponent(isbn)}`)
    : new URL(`https://api2.isbndb.com/books/${encodeURIComponent(title)}`);
  if (!isbn) {
    url.searchParams.set('pageSize', '10');
    if (author) url.searchParams.set('column', 'title');
  }
  const data = await fetchJson(url, { headers: { Authorization: process.env.ISBNDB_API_KEY } }, 'ISBNdb');
  const books = data.books || (data.book ? [data.book] : []);
  return books.map(v => ({
    source: 'ISBNdb', sourceId: v.isbn13 || v.isbn || v.title, title: v.title || '', subtitle: v.title_long && v.title_long !== v.title ? v.title_long : '',
    authors: v.authors || [], publisher: v.publisher || '', publishedDate: v.date_published || '', description: plainText(v.synopsis || ''),
    isbn: v.isbn13 || v.isbn || '', language: v.language || '', tags: v.subjects || [], coverUrl: v.image || ''
  }));
}

function normalizeMetadataText(value = '') {
  return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

function metadataScore(item, match) {
  const wantedTitle = normalizeMetadataText(cleanLookupTitle(item.title));
  const foundTitle = normalizeMetadataText(match.title);
  if (!wantedTitle || !foundTitle) return 0;
  let score = wantedTitle === foundTitle ? 75 : 0;
  if (!score && (wantedTitle.includes(foundTitle) || foundTitle.includes(wantedTitle))) score = 52;
  const wantedWords = new Set(wantedTitle.split(' ').filter(word => word.length > 2));
  const foundWords = new Set(foundTitle.split(' ').filter(word => word.length > 2));
  const overlap = [...wantedWords].filter(word => foundWords.has(word)).length;
  score += Math.min(30, overlap * 5);
  const wantedAuthors = normalizeMetadataText((item.authors || []).join(' '));
  const foundAuthors = normalizeMetadataText((match.authors || []).join(' '));
  if (wantedAuthors && foundAuthors) {
    if (wantedAuthors === foundAuthors) score += 30;
    else if (wantedAuthors.includes(foundAuthors) || foundAuthors.includes(wantedAuthors)) score += 18;
  }
  if (item.isbn && match.isbn && item.isbn.replace(/\D/g, '') === match.isbn.replace(/\D/g, '')) score += 120;
  if (match.coverUrl) score += 3;
  return score;
}

function dedupeMetadata(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.isbn?.replace(/\D/g, '') || `${normalizeMetadataText(item.title)}:${normalizeMetadataText((item.authors || [])[0])}`;
    const previous = map.get(key);
    if (!previous || (!previous.coverUrl && item.coverUrl) || (!previous.description && item.description)) map.set(key, item);
  }
  return [...map.values()];
}

async function searchMetadataForItem(item) {
  const lookup = itemLookup(item);
  if (!lookup.title && !lookup.isbn) return { items: [], errors: [], providers: [] };
  const cacheKey = JSON.stringify(lookup);
  const cached = metadataCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 30 * 60_000) return cached.value;

  const providers = [
    ['Open Library', openLibrary],
    ['Google Books', googleBooks],
    ['Crossref', crossref],
    ['Library of Congress', libraryOfCongress],
    ...(process.env.ISBNDB_API_KEY ? [['ISBNdb', isbnDb]] : []),
  ];
  const settled = await Promise.allSettled(providers.map(([, provider]) => provider(item)));
  const errors = [];
  const found = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') found.push(...result.value);
    else errors.push(`${providers[index][0]}: ${result.reason?.message || 'lookup failed'}`);
  });
  const ranked = dedupeMetadata(found)
    .map(match => ({ ...match, score: metadataScore(item, match) }))
    .filter(match => match.score >= 25)
    .sort((a, b) => b.score - a.score);
  const value = { items: ranked, errors, providers: providers.map(([name]) => name), query: lookup };
  metadataCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

async function enrichLibraryItem(item) {
  if (item.type !== 'book') return item;
  const result = await searchMetadataForItem(item);
  const candidates = result.items.filter(match => match.score >= 55).slice(0, 8);
  if (!candidates.length) return item;

  const has = key => {
    const value = item[key];
    return Array.isArray(value) ? value.length > 0 : value !== '' && value != null && value !== 0;
  };
  const first = key => candidates.find(candidate => {
    const value = candidate[key];
    return Array.isArray(value) ? value.length : Boolean(value);
  });
  const next = { ...item, metadataSource: { ...(item.metadataSource || {}) } };
  for (const key of ['authors', 'isbn', 'publisher', 'language', 'description', 'coverUrl']) {
    if (has(key)) continue;
    const candidate = first(key);
    if (!candidate) continue;
    next[key] = candidate[key];
    next.metadataSource[key] = candidate.source;
  }
  if (!has('tags')) {
    const tags = [...new Set(candidates.flatMap(candidate => candidate.tags || []).map(tag => String(tag).trim()).filter(Boolean))].slice(0, 30);
    if (tags.length) {
      next.tags = tags;
      next.metadataSource.tags = candidates.find(candidate => candidate.tags?.length)?.source || 'metadata providers';
    }
  }
  next.metadataMatch = {
    sources: [...new Set(candidates.map(candidate => candidate.source))],
    bestScore: candidates[0].score,
  };
  return next;
}

function mergeSavedEdits(items, db) {
  return items.map(item => ({
    ...item,
    ...(db.books[item.id] || {}),
    id: item.id,
    fileName: item.fileName,
    relativePath: item.relativePath,
    format: item.format,
    size: item.size,
    modifiedAt: item.modifiedAt,
    mtpHandle: item.mtpHandle,
    storageId: item.storageId,
    sourceKind: item.sourceKind,
  }));
}


app.get('/api/libraries', (_req, res) => res.json(librarySummaries()));

app.post('/api/libraries/:id/open', (req, res) => {
  const db = ensureDbShape(readDb());
  const snapshot = db.libraries[req.params.id];
  if (!snapshot) return res.status(404).json({ error: 'Remembered library not found' });
  db.settings.activeLibraryId = req.params.id;
  snapshot.lastOpenedAt = new Date().toISOString();
  writeDb(db);
  loadSnapshotIntoCache(snapshot);
  return res.json({ ok: true, device: mtpCache.device, itemCount: mtpCache.items.length });
});

app.delete('/api/libraries/:id', (req, res) => {
  const db = ensureDbShape(readDb());
  if (!db.libraries[req.params.id]) return res.status(404).json({ error: 'Remembered library not found' });
  delete db.libraries[req.params.id];
  if (db.settings.activeLibraryId === req.params.id) db.settings.activeLibraryId = '';
  writeDb(db);
  if (mtpCache.device?.id === req.params.id) mtpCache = { device: { connected: false, transport: 'mtp' }, items: [], books: [], scannedAt: null };
  return res.json({ ok: true });
});

function libraryPayload(library, connected = false) {
  if (!library) return { library: null, device: { connected: false }, items: [], books: [] };
  const items = library.items || [];
  return {
    library: { ...library, items: undefined, itemCount: items.length },
    device: { ...(library.device || {}), connected },
    items,
    books: items.filter(item => item.type === 'book'),
  };
}

function activeLibraryId() {
  return store.read().activeLibraryId || '';
}

function findItem(libraryId, itemId) {
  return store.get(libraryId)?.items?.find(item => item.id === itemId) || null;
}

function allowedPatch(body = {}) {
  const allowed = ['type','title','subtitle','authors','isbn','asin','publisher','language','description','coverUrl','series','seriesIndex','tags','collections','metadataSource','metadataMatch'];
  return Object.fromEntries(allowed.filter(key => key in body).map(key => [key, body[key]]));
}

async function runEnrichmentJob(jobId, libraryId, onlyMissing = true) {
  const library = store.get(libraryId);
  if (!library) throw new Error('Library not found');
  const candidates = (library.items || []).filter(item => item.type === 'book');
  const job = jobs.get(jobId);
  job.status = 'running';
  job.total = candidates.length;
  for (let index = 0; index < candidates.length; index += 1) {
    const item = findItem(libraryId, candidates[index].id) || candidates[index];
    job.current = index;
    job.itemId = item.id;
    job.title = item.title;
    try {
      const enriched = await enrichLibraryItem(item);
      const changed = JSON.stringify(enriched) !== JSON.stringify(item);
      if (changed || !onlyMissing) store.replaceItem(libraryId, enriched);
      if (changed) job.updated += 1;
    } catch (error) {
      job.errors.push(`${item.title}: ${error.message}`);
    }
  }
  job.current = candidates.length;
  job.status = 'done';
  job.finishedAt = new Date().toISOString();
}


function parseCsvRows(input = '') {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const text = String(input).replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const headers = (rows.shift() || []).map(value => value.trim());
  return rows.filter(values => values.some(Boolean)).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function cleanGoodreadsIsbn(value = '') {
  return String(value).replace(/^="|"$/g, '').replace(/[^0-9X]/gi, '').toUpperCase();
}

function normalizedBookKey(title = '', author = '') {
  const normalize = value => String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
  return `${normalize(title)}:${normalize(author)}`;
}

function importGoodreadsCsv(library, csv) {
  const rows = parseCsvRows(csv);
  if (!rows.length || !('Title' in rows[0])) throw new Error('This does not look like a Goodreads library export CSV.');
  const items = [...(library.items || [])];
  const byIsbn = new Map();
  const byBook = new Map();
  for (const item of items) {
    if (item.isbn) byIsbn.set(cleanGoodreadsIsbn(item.isbn), item);
    byBook.set(normalizedBookKey(item.title, item.authors?.[0]), item);
  }
  let matched = 0;
  let unmatched = 0;
  let updated = 0;
  const unmatchedRows = [];
  for (const row of rows) {
    const isbn13 = cleanGoodreadsIsbn(row.ISBN13);
    const isbn10 = cleanGoodreadsIsbn(row.ISBN);
    const key = normalizedBookKey(row.Title, row.Author);
    const item = (isbn13 && byIsbn.get(isbn13)) || (isbn10 && byIsbn.get(isbn10)) || byBook.get(key);
    if (!item) { unmatched += 1; unmatchedRows.push({ title: row.Title, author: row.Author, isbn: isbn13 || isbn10 }); continue; }
    matched += 1;
    const shelves = String(row.Bookshelves || '').split(',').map(value => value.trim()).filter(Boolean);
    const exclusiveShelf = String(row['Exclusive Shelf'] || '').trim();
    const tags = [...new Set([...(item.tags || []), ...shelves])];
    const collections = [...new Set([...(item.collections || []), ...(exclusiveShelf ? [exclusiveShelf] : [])])];
    const goodreads = {
      bookId: String(row['Book Id'] || ''),
      rating: Number(row['My Rating'] || 0) || null,
      averageRating: Number(row['Average Rating'] || 0) || null,
      review: String(row['My Review'] || ''),
      privateNotes: String(row['Private Notes'] || ''),
      dateRead: String(row['Date Read'] || ''),
      dateAdded: String(row['Date Added'] || ''),
      exclusiveShelf,
      shelves,
      readCount: Number(row['Read Count'] || 0) || 0,
      ownedCopies: Number(row['Owned Copies'] || 0) || 0,
      importedAt: new Date().toISOString(),
    };
    Object.assign(item, {
      title: item.title || row.Title || '',
      authors: item.authors?.length ? item.authors : [row.Author].filter(Boolean),
      isbn: item.isbn || isbn13 || isbn10,
      publisher: item.publisher || row.Publisher || '',
      tags,
      collections,
      goodreads,
      metadataSource: { ...(item.metadataSource || {}), goodreads: 'Goodreads export', tags: shelves.length ? 'Goodreads export' : item.metadataSource?.tags },
      updatedAt: new Date().toISOString(),
    });
    updated += 1;
  }
  return { items, summary: { totalRows: rows.length, matched, updated, unmatched, unmatchedRows: unmatchedRows.slice(0, 50) } };
}

// API v1. The Vue app is deliberately just one client of this API.
app.get('/api/v1/health', (_req, res) => res.json({ ok: true, apiVersion: 1 }));
app.get('/api/v1/providers', (_req, res) => res.json({
  providers: [
    { id: 'open-library', name: 'Open Library', free: true, enabled: true },
    { id: 'google-books', name: 'Google Books', free: true, enabled: true, keyConfigured: Boolean(process.env.GOOGLE_BOOKS_API_KEY) },
    { id: 'crossref', name: 'Crossref', free: true, enabled: true },
    { id: 'isbndb', name: 'ISBNdb', free: false, enabled: Boolean(process.env.ISBNDB_API_KEY) },
    { id: 'goodreads-export', name: 'Goodreads Library Export', free: true, enabled: true, mode: 'csv-import' },
  ],
}));

app.get('/api/v1/status', (_req, res) => {
  const state = store.read();
  res.json({
    dataDir: DATA_DIR,
    stateFile: store.stateFile,
    activeLibraryId: state.activeLibraryId,
    libraryCount: Object.keys(state.libraries || {}).length,
    persistent: true,
    storage: 'json-state',
  });
});

app.get('/api/v1/libraries', (_req, res) => {
  const state = store.read();
  res.json({ activeLibraryId: state.activeLibraryId, libraries: store.list() });
});

app.get('/api/v1/libraries/:libraryId', (req, res) => {
  const library = store.get(req.params.libraryId);
  if (!library) return res.status(404).json({ error: 'Library not found' });
  return res.json(libraryPayload(library, false));
});

app.post('/api/v1/libraries/:libraryId/open', (req, res) => {
  const library = store.setActive(req.params.libraryId);
  if (!library) return res.status(404).json({ error: 'Library not found' });
  return res.json(libraryPayload(library, false));
});

app.patch('/api/v1/libraries/:libraryId', (req, res) => {
  const library = store.rename(req.params.libraryId, req.body?.name);
  if (!library) return res.status(404).json({ error: 'Library not found' });
  return res.json({ library: { ...library, items: undefined, itemCount: library.items?.length || 0 } });
});

app.get('/api/v1/libraries/:libraryId/items', (req, res) => {
  const library = store.get(req.params.libraryId);
  if (!library) return res.status(404).json({ error: 'Library not found' });
  const type = req.query.type ? String(req.query.type) : '';
  const query = String(req.query.q || '').toLowerCase().trim();
  let items = library.items || [];
  if (type) items = items.filter(item => item.type === type);
  if (query) items = items.filter(item => [item.title, ...(item.authors || []), ...(item.tags || []), item.series, item.isbn, item.asin].join(' ').toLowerCase().includes(query));
  return res.json({ libraryId: library.id, items, total: items.length });
});

app.put('/api/v1/libraries/:libraryId/items/:itemId', async (req, res) => {
  const item = store.updateItem(req.params.libraryId, req.params.itemId, allowedPatch(req.body));
  if (!item) return res.status(404).json({ error: 'Library item not found' });

  // Save means save. Persist locally first, then mirror the catalogue entry to
  // the connected Kindle and verify the exact metadata by reading it back.
  // A disconnected Kindle never causes the local edit to be lost.
  const shouldSync = req.query.sync !== 'false' && req.body?.syncToKindle !== false;
  if (!shouldSync || item.type !== 'book') return res.json({ item, sync: { attempted: false } });

  const library = store.get(req.params.libraryId);
  try {
    const preview = await syncCalibreMetadataToKindle({ library, dryRun: true });
    if (!preview.changedEntries) {
      return res.status(409).json({
        error: preview.skippedEntries
          ? `Nothing was written: 0 catalogue entries matched with changes; ${preview.skippedEntries} items were skipped.`
          : 'Nothing was written: the Kindle catalogue already contains the same metadata.',
        preview,
      });
    }
    const result = await syncCalibreMetadataToKindle({
      library,
      dryRun: false,
      backupDir: path.join(DATA_DIR, 'backups', req.params.libraryId),
    });
    store.updateLibrary(req.params.libraryId, {
      sync: {
        lastSyncedAt: new Date().toISOString(),
        target: 'metadata.calibre',
        verified: Boolean(result.verified),
        verifiedEntries: result.verifiedEntries || 0,
        sha256: result.writtenSha256 || '',
        changedEntries: result.changedEntries,
        backupPath: result.backupPath || '',
      },
    });
    return res.json({ item: store.get(req.params.libraryId)?.items?.find(value => value.id === item.id) || item, sync: { attempted: true, ...result } });
  } catch (error) {
    return res.status(207).json({
      item,
      sync: { attempted: true, written: false, verified: false, error: error.message },
      warning: `Metadata was saved locally, but Kindle catalogue sync failed: ${error.message}`,
    });
  }
});

app.post('/api/v1/libraries/:libraryId/items/:itemId/enrich', async (req, res) => {
  const item = findItem(req.params.libraryId, req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Library item not found' });
  try {
    const enriched = await enrichLibraryItem(item);
    store.replaceItem(req.params.libraryId, enriched);
    return res.json({ item: enriched });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});


app.post('/api/v1/libraries/:libraryId/imports/goodreads', (req, res) => {
  const library = store.get(req.params.libraryId);
  if (!library) return res.status(404).json({ error: 'Library not found' });
  const csv = req.body?.csv;
  if (!csv) return res.status(400).json({ error: 'Goodreads CSV content is required' });
  try {
    const result = importGoodreadsCsv(library, csv);
    const updated = store.updateLibrary(req.params.libraryId, {
      items: result.items,
      imports: {
        ...(library.imports || {}),
        goodreads: { ...result.summary, importedAt: new Date().toISOString() },
      },
    });
    return res.json({ summary: result.summary, library: libraryPayload(updated, false) });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/api/v1/libraries/:libraryId/enrichment-jobs', (req, res) => {
  if (!store.get(req.params.libraryId)) return res.status(404).json({ error: 'Library not found' });
  const id = `job_${crypto.randomUUID()}`;
  const job = { id, type: 'fill-missing-metadata', libraryId: req.params.libraryId, status: 'queued', current: 0, total: 0, updated: 0, errors: [], createdAt: new Date().toISOString() };
  jobs.set(id, job);
  setImmediate(() => runEnrichmentJob(id, req.params.libraryId, req.body?.onlyMissing !== false).catch(error => {
    job.status = 'failed'; job.error = error.message; job.finishedAt = new Date().toISOString();
  }));
  return res.status(202).json({ job });
});

app.get('/api/v1/jobs/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  return res.json({ job });
});


app.post('/api/v1/libraries/:libraryId/sync-preview', async (req, res) => {
  const library = store.get(req.params.libraryId);
  if (!library) return res.status(404).json({ error: 'Library not found' });
  try {
    const preview = await syncCalibreMetadataToKindle({ library, dryRun: true });
    return res.json({ preview });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/libraries/:libraryId/sync', async (req, res) => {
  const library = store.get(req.params.libraryId);
  if (!library) return res.status(404).json({ error: 'Library not found' });
  try {
    const preview = await syncCalibreMetadataToKindle({ library, dryRun: true });
    if (!preview.changedEntries) {
      return res.status(409).json({
        error: preview.skippedEntries
          ? `Nothing was written: 0 catalogue entries matched with changes; ${preview.skippedEntries} items were skipped.`
          : 'Nothing was written: the Kindle catalogue already contains the same metadata.',
        preview,
      });
    }
    const result = await syncCalibreMetadataToKindle({
      library,
      dryRun: false,
      backupDir: path.join(DATA_DIR, 'backups', req.params.libraryId),
    });
    const updated = store.updateLibrary(req.params.libraryId, {
      sync: {
        lastSyncedAt: new Date().toISOString(),
        target: 'metadata.calibre',
        verified: Boolean(result.verified),
        sha256: result.writtenSha256 || '',
        affectsKindleDisplay: false,
        changedEntries: result.changedEntries,
        backupPath: result.backupPath || '',
      },
    });
    return res.json({ result, library: updated ? { ...updated, items: undefined, itemCount: updated.items?.length || 0 } : null });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});


app.post('/api/v1/libraries/:libraryId/books/inspect', upload.array('books', 20), async (req, res) => {
  const library = store.get(req.params.libraryId);
  if (!library) return res.status(404).json({ error: 'Library not found' });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Select at least one book file' });
  const invalid = files.filter(file => !SUPPORTED.has(path.extname(file.originalname).toLowerCase()));
  if (invalid.length) return res.status(400).json({ error: `Unsupported format: ${invalid.map(file => file.originalname).join(', ')}` });

  const drafts = [];
  for (const file of files) {
    const extension = path.extname(file.originalname).toLowerCase();
    const embedded = extension === '.epub' ? epubMetadataBuffer(file.buffer) : {};
    const inferred = inferFromFilename(file.originalname);
    const base = {
      clientId: crypto.randomUUID(),
      fileName: file.originalname,
      size: file.size,
      format: extension.slice(1).toUpperCase(),
      title: embedded.title || inferred.title,
      authors: embedded.authors?.length ? embedded.authors : inferred.authors,
      isbn: embedded.isbn || '',
      publisher: embedded.publisher || '',
      language: embedded.language || '',
      description: plainText(embedded.description || ''),
      coverUrl: '', series: '', seriesIndex: null, tags: [], collections: [], type: 'book',
      metadataSource: {
        title: embedded.title ? 'embedded EPUB' : 'filename',
        authors: embedded.authors?.length ? 'embedded EPUB' : 'filename',
        isbn: embedded.isbn ? 'embedded EPUB' : '',
      },
    };
    let enriched = base;
    try { enriched = await enrichLibraryItem(base); }
    catch (error) { enriched = { ...base, inspectionWarning: error.message }; }
    drafts.push(enriched);
  }
  return res.json({ drafts });
});

app.post('/api/v1/libraries/:libraryId/books', upload.array('books', 20), async (req, res) => {
  const library = store.get(req.params.libraryId);
  if (!library) return res.status(404).json({ error: 'Library not found' });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Select at least one book file' });

  const invalid = files.filter(file => !SUPPORTED.has(path.extname(file.originalname).toLowerCase()));
  if (invalid.length) return res.status(400).json({ error: `Unsupported format: ${invalid.map(file => file.originalname).join(', ')}` });

  let reviewedMetadata = [];
  try { reviewedMetadata = JSON.parse(req.body?.metadata || '[]'); }
  catch { return res.status(400).json({ error: 'Invalid reviewed metadata payload' }); }
  const reviewedByName = new Map(reviewedMetadata.map(item => [String(item.fileName || '').toLowerCase(), item]));

  const added = [];
  const errors = [];
  for (const file of files) {
    try {
      added.push(await uploadBookToKindle({ filename: file.originalname, bytes: new Uint8Array(file.buffer) }));
    } catch (error) {
      errors.push({ filename: file.originalname, error: error.message });
    }
  }

  let refreshed = null;
  if (added.length) {
    const result = await scanKindleMtp({ onProgress: progress => { mtpProgress = progress; } });
    refreshed = store.saveScan(result);
    for (const item of refreshed.items || []) {
      const reviewed = reviewedByName.get(String(item.fileName || '').toLowerCase());
      if (reviewed) store.updateItem(refreshed.id, item.id, allowedPatch(reviewed));
    }
    refreshed = store.get(refreshed.id);
    mtpCache = { ...result, items: refreshed.items || result.items, scannedAt: refreshed.lastScannedAt };
  }

  return res.status(errors.length && !added.length ? 500 : 201).json({
    added,
    errors,
    library: refreshed ? libraryPayload(refreshed, true) : libraryPayload(library, true),
  });
});

app.post('/api/v1/devices/kindle/scan', async (_req, res) => {
  if (mtpScanPromise) return res.status(409).json({ error: 'A Kindle scan is already running', progress: mtpProgress });
  mtpScanPromise = scanKindleMtp({ onProgress: progress => { mtpProgress = progress; } });
  try {
    const result = await mtpScanPromise;
    const library = store.saveScan(result);
    mtpCache = { ...result, scannedAt: library.lastScannedAt };
    mtpProgress = { phase: 'done', current: result.items.length, total: result.items.length };
    return res.json(libraryPayload(library, true));
  } catch (error) {
    mtpProgress = { phase: 'error', current: 0, total: 0, error: error.message };
    return res.status(500).json({ error: error.message });
  } finally {
    mtpScanPromise = null;
  }
});

app.get('/api/v1/devices/kindle/scan/status', (_req, res) => res.json({ scanning: Boolean(mtpScanPromise), progress: mtpProgress }));
app.post('/api/v1/metadata/search', async (req, res) => {
  const item = req.body || {};
  if (!item.title && !item.isbn) return res.status(400).json({ error: 'Title or ISBN is required' });
  try { return res.json(await searchMetadataForItem(item)); }
  catch (error) { return res.status(500).json({ error: error.message, items: [] }); }
});

app.use('/api/v2/metadata', createMetadataRouter());

// Compatibility endpoints for the early POC clients.
app.get('/api/device', (_req, res) => {
  const library = store.active();
  return res.json(library ? { ...(library.device || {}), connected: false, scannedAt: library.lastScannedAt } : { connected: false });
});
app.get('/api/books', (_req, res) => res.json(libraryPayload(store.active(), false)));
app.post('/api/device/scan', async (req, res, next) => {
  req.url = '/api/v1/devices/kindle/scan'; next();
});
app.get('/api/device/scan/status', (_req, res) => res.json({ scanning: Boolean(mtpScanPromise), progress: mtpProgress }));
app.put('/api/books/:id', (req, res) => {
  const id = activeLibraryId();
  const item = id ? store.updateItem(id, req.params.id, allowedPatch(req.body)) : null;
  if (!item) return res.status(404).json({ error: 'Library item not found' });
  return res.json({ item });
});
app.post('/api/books/:id/enrich', async (req, res) => {
  const id = activeLibraryId();
  const item = id ? findItem(id, req.params.id) : null;
  if (!item) return res.status(404).json({ error: 'Library item not found' });
  const enriched = await enrichLibraryItem(item);
  store.replaceItem(id, enriched);
  return res.json({ item: enriched });
});
app.post('/api/metadata/search', async (req, res) => {
  try { return res.json(await searchMetadataForItem(req.body || {})); }
  catch (error) { return res.status(500).json({ error: error.message, items: [] }); }
});
app.get('/api/health', (_req, res) => res.json({ ok: true, apiVersion: 1 }));
app.listen(PORT, () => {
  const state = store.read();
  console.log(`Kindred API listening at http://localhost:${PORT}`);
  console.log(`Kindred persistent state: ${store.stateFile}`);
  console.log(`Remembered libraries: ${Object.keys(state.libraries || {}).length}; active: ${state.activeLibraryId || 'none'}`);
});
