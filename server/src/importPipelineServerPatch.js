import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { readEpub } from '@kindred/epub-core';
import { createMetadataService } from '@kindred/metadata-service';
import { expandBookUploads } from './archiveIntake.js';
import { matchReviewedMetadata, prepareReviewedBook } from './importPreparation.js';
import { createLibraryStore } from './libraryStore.js';
import { scanKindleMtp, uploadBookToKindle } from './kindleMtp.js';

const PATCHED = Symbol.for('kindred.importPipelineServerPatch');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024, files: 20 },
});

function dataDir() {
  if (process.env.KINDRED_DATA_DIR) return path.resolve(process.env.KINDRED_DATA_DIR);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Kindred');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Kindred');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'kindred');
}

function text(value = '') {
  return String(value ?? '').trim();
}

function inferFromFilename(fileName) {
  const base = path.basename(fileName, path.extname(fileName)).replaceAll('_', ' ').trim();
  const parts = base.split(/\s+-\s+/);
  return parts.length > 1
    ? { authors: [parts[0]], title: parts.slice(1).join(' - ') }
    : { title: base, authors: [] };
}

function embeddedMetadata(book) {
  if (book.extension !== '.epub') return {};
  try {
    const parsed = readEpub(book.buffer);
    return {
      title: parsed.metadata?.title || '',
      authors: parsed.metadata?.authors || [],
      isbn: parsed.metadata?.isbn || '',
      publisher: parsed.metadata?.publisher || '',
      language: parsed.metadata?.language || '',
      description: parsed.metadata?.description || '',
      series: parsed.metadata?.series || '',
      seriesIndex: parsed.metadata?.seriesIndex ?? null,
      tags: parsed.metadata?.subjects || parsed.metadata?.tags || [],
      coverUrl: '',
    };
  } catch {
    return {};
  }
}

function baseDraft(book) {
  const embedded = embeddedMetadata(book);
  const inferred = inferFromFilename(book.fileName);
  return {
    clientId: crypto.randomUUID(),
    fileName: book.fileName,
    originalUploadName: book.originalUploadName,
    archiveName: book.archiveName,
    archivePath: book.archivePath,
    sha256: book.sha256,
    size: book.size,
    format: book.format,
    title: embedded.title || inferred.title,
    authors: embedded.authors?.length ? embedded.authors : inferred.authors,
    isbn: embedded.isbn || '',
    publisher: embedded.publisher || '',
    language: embedded.language || '',
    description: embedded.description || '',
    coverUrl: embedded.coverUrl || '',
    series: embedded.series || '',
    seriesIndex: embedded.seriesIndex ?? null,
    tags: embedded.tags || [],
    collections: [],
    type: 'book',
    metadataSource: {
      title: embedded.title ? 'embedded EPUB' : 'filename',
      authors: embedded.authors?.length ? 'embedded EPUB' : 'filename',
      isbn: embedded.isbn ? 'embedded EPUB' : '',
    },
  };
}

function publicResolution(result, fallback) {
  const metadata = result?.resolution?.metadata || {};
  const provenance = result?.resolution?.provenance || {};
  return {
    ...fallback,
    ...Object.fromEntries(Object.entries(metadata).filter(([, value]) => value != null && value !== '')),
    coverUrl: result?.resolution?.coverCandidates?.[0]?.url || fallback.coverUrl || '',
    metadataSource: {
      ...(fallback.metadataSource || {}),
      ...Object.fromEntries(Object.entries(provenance).map(([field, source]) => [field, source?.source || source])),
    },
    metadataResolution: {
      provenance,
      decisions: result?.resolution?.decisions || [],
      conflicts: result?.resolution?.conflicts || [],
      providers: result?.providers || [],
      errors: result?.errors || [],
    },
  };
}

export function assignUploadNames(books) {
  const counts = new Map();
  return books.map(book => {
    const key = book.fileName.toLowerCase();
    const count = counts.get(key) || 0;
    counts.set(key, count + 1);
    if (!count) return { ...book, uploadFileName: book.fileName };
    const extension = path.extname(book.fileName);
    const base = path.basename(book.fileName, extension);
    return { ...book, uploadFileName: `${base} - ${book.sha256.slice(0, 8)}${extension}` };
  });
}

async function coverForReview(review) {
  const url = text(review?.coverUrl);
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return undefined;
    return { bytes: Buffer.from(await response.arrayBuffer()) };
  } catch {
    return undefined;
  }
}

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

export function installImportPipelineRoutes(app, options = {}) {
  if (app[PATCHED]) return;
  app[PATCHED] = true;

  const store = options.store || createLibraryStore(dataDir());
  const metadataService = options.metadataService || createMetadataService({
    openLibrary: {
      application: process.env.OPEN_LIBRARY_APPLICATION || 'Kindred',
      contact: process.env.OPEN_LIBRARY_CONTACT || '',
      timeoutMs: Number(process.env.METADATA_TIMEOUT_MS) || 8_000,
    },
    googleBooks: {
      apiKey: process.env.GOOGLE_BOOKS_API_KEY || '',
      timeoutMs: Number(process.env.METADATA_TIMEOUT_MS) || 8_000,
    },
  });
  const uploadToKindle = options.uploadBookToKindle || uploadBookToKindle;
  const scanKindle = options.scanKindleMtp || scanKindleMtp;

  app.post('/api/v2/import/libraries/:libraryId/inspect', upload.array('books', 20), async (req, res) => {
    const library = store.get(req.params.libraryId);
    if (!library) return res.status(404).json({ error: 'Library not found' });
    if (!req.files?.length) return res.status(400).json({ error: 'Select at least one book or ZIP archive' });

    try {
      const expanded = expandBookUploads(req.files);
      if (!expanded.books.length) {
        return res.status(400).json({ error: 'No supported books were found in the selected uploads.', summary: expanded.summary });
      }

      const drafts = [];
      for (const book of assignUploadNames(expanded.books)) {
        const base = { ...baseDraft(book), uploadFileName: book.uploadFileName };
        try {
          const result = await metadataService.enrich({ id: base.sha256, metadata: base }, {
            baseSource: 'embedded',
            baseConfidence: 0.9,
          });
          drafts.push(publicResolution(result, base));
        } catch (error) {
          drafts.push({ ...base, inspectionWarning: error.message });
        }
      }

      return res.json({ drafts, summary: expanded.summary });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/v2/import/libraries/:libraryId/commit', upload.array('books', 20), async (req, res) => {
    const library = store.get(req.params.libraryId);
    if (!library) return res.status(404).json({ error: 'Library not found' });
    if (!req.files?.length) return res.status(400).json({ error: 'Select at least one book or ZIP archive' });

    let reviews;
    try {
      reviews = JSON.parse(req.body?.metadata || '[]');
      if (!Array.isArray(reviews)) throw new Error('Metadata must be an array.');
    } catch (error) {
      return res.status(400).json({ error: `Invalid reviewed metadata payload: ${error.message}` });
    }

    try {
      const expanded = expandBookUploads(req.files);
      const namedBooks = assignUploadNames(expanded.books);
      const matched = matchReviewedMetadata(namedBooks, reviews);
      const added = [];
      const errors = [];
      const prepared = [];

      for (const { book, review } of matched) {
        if (!review) {
          errors.push({ filename: book.fileName, error: 'No reviewed metadata matched this book.' });
          continue;
        }
        try {
          const cover = await coverForReview(review);
          const ready = prepareReviewedBook(book, review, { cover });
          prepared.push({
            filename: book.uploadFileName,
            sha256: book.sha256,
            writeback: ready.writeback,
          });
          added.push(await uploadToKindle({
            filename: book.uploadFileName,
            bytes: new Uint8Array(ready.uploadBuffer),
          }));
        } catch (error) {
          errors.push({ filename: book.uploadFileName || book.fileName, error: error.message });
        }
      }

      let refreshed = library;
      if (added.length) {
        const scan = await scanKindle();
        refreshed = store.saveScan(scan);
        const reviewsByUploadName = new Map(reviews.map(review => [
          String(review.uploadFileName || review.fileName || '').toLowerCase(),
          review,
        ]));
        for (const item of refreshed.items || []) {
          const review = reviewsByUploadName.get(String(item.fileName || '').toLowerCase());
          if (review) {
            store.updateItem(refreshed.id, item.id, {
              type: review.type || 'book', title: review.title, subtitle: review.subtitle,
              authors: review.authors, isbn: review.isbn, publisher: review.publisher,
              language: review.language, description: review.description,
              coverUrl: review.coverUrl, series: review.series, seriesIndex: review.seriesIndex,
              tags: review.tags, collections: review.collections,
              metadataSource: review.metadataSource, metadataMatch: review.metadataMatch,
            });
          }
        }
        refreshed = store.get(refreshed.id);
      }

      return res.status(errors.length && !added.length ? 500 : 201).json({
        added,
        errors,
        prepared,
        summary: { ...expanded.summary, uploadedBooks: added.length, failedBooks: errors.length },
        library: libraryPayload(refreshed, Boolean(added.length)),
      });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });
}

const originalListen = express.application.listen;
express.application.listen = function patchedListen(...args) {
  installImportPipelineRoutes(this);
  return originalListen.apply(this, args);
};
