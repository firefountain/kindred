import crypto from 'node:crypto';
import path from 'node:path';
import AdmZip from 'adm-zip';

export const BOOK_EXTENSIONS = new Set([
  '.epub', '.mobi', '.azw', '.azw3', '.kfx', '.pdf',
]);

export const ARCHIVE_EXTENSIONS = new Set(['.zip']);

const DEFAULT_LIMITS = Object.freeze({
  maxBooks: 200,
  maxArchiveEntries: 2_000,
  maxBookBytes: 250 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxCompressionRatio: 150,
});

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function normalizedArchivePath(value = '') {
  const input = String(value).replace(/\\/g, '/');
  const normalized = path.posix.normalize(input).replace(/^\.\//, '');
  if (
    !normalized ||
    normalized === '.' ||
    normalized.startsWith('/') ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new Error(`Unsafe archive path: ${value}`);
  }
  return normalized;
}

function isJunkPath(value) {
  const parts = value.split('/');
  return parts.some(part =>
    !part ||
    part === '__MACOSX' ||
    part === '.DS_Store' ||
    part.startsWith('._') ||
    part.startsWith('.'),
  );
}

function directUpload(file) {
  const extension = path.extname(file.originalname).toLowerCase();
  if (!BOOK_EXTENSIONS.has(extension)) return null;
  const buffer = Buffer.from(file.buffer);
  return {
    originalUploadName: file.originalname,
    fileName: path.basename(file.originalname),
    archiveName: null,
    archivePath: null,
    extension,
    format: extension.slice(1).toUpperCase(),
    size: buffer.byteLength,
    sha256: sha256(buffer),
    buffer,
  };
}

function zipUploads(file, limits, summary) {
  let zip;
  try {
    zip = new AdmZip(file.buffer);
  } catch (error) {
    throw new Error(`Invalid ZIP archive ${file.originalname}: ${error.message}`);
  }

  const entries = zip.getEntries();
  if (entries.length > limits.maxArchiveEntries) {
    throw new Error(`${file.originalname} contains too many entries (${entries.length}).`);
  }

  const uploads = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;

    const archivePath = normalizedArchivePath(entry.entryName);
    if (isJunkPath(archivePath)) {
      summary.ignoredFiles += 1;
      continue;
    }

    const extension = path.extname(archivePath).toLowerCase();
    if (ARCHIVE_EXTENSIONS.has(extension)) {
      summary.nestedArchives += 1;
      continue;
    }
    if (!BOOK_EXTENSIONS.has(extension)) {
      summary.ignoredFiles += 1;
      continue;
    }

    const declaredSize = Number(entry.header?.size || 0);
    const compressedSize = Number(entry.header?.compressedSize || 0);
    if (declaredSize > limits.maxBookBytes) {
      throw new Error(`${archivePath} exceeds the per-book size limit.`);
    }
    if (
      compressedSize > 0 &&
      declaredSize / compressedSize > limits.maxCompressionRatio
    ) {
      throw new Error(`${archivePath} has a suspicious compression ratio.`);
    }

    const buffer = entry.getData();
    if (buffer.byteLength > limits.maxBookBytes) {
      throw new Error(`${archivePath} exceeds the per-book size limit.`);
    }

    uploads.push({
      originalUploadName: file.originalname,
      fileName: path.posix.basename(archivePath),
      archiveName: file.originalname,
      archivePath,
      extension,
      format: extension.slice(1).toUpperCase(),
      size: buffer.byteLength,
      sha256: sha256(buffer),
      buffer,
    });
  }

  return uploads;
}

export function expandBookUploads(files = [], options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options };
  const summary = {
    uploadCount: files.length,
    archiveCount: 0,
    discoveredBooks: 0,
    duplicateBooks: 0,
    ignoredFiles: 0,
    nestedArchives: 0,
    totalBytes: 0,
  };

  const expanded = [];
  for (const file of files) {
    const extension = path.extname(file.originalname).toLowerCase();
    if (BOOK_EXTENSIONS.has(extension)) {
      expanded.push(directUpload(file));
      continue;
    }
    if (ARCHIVE_EXTENSIONS.has(extension)) {
      summary.archiveCount += 1;
      expanded.push(...zipUploads(file, limits, summary));
      continue;
    }
    summary.ignoredFiles += 1;
  }

  const books = [];
  const seen = new Set();
  for (const book of expanded.filter(Boolean)) {
    if (seen.has(book.sha256)) {
      summary.duplicateBooks += 1;
      continue;
    }
    seen.add(book.sha256);
    summary.totalBytes += book.size;
    if (summary.totalBytes > limits.maxTotalBytes) {
      throw new Error('Expanded books exceed the total uncompressed size limit.');
    }
    books.push(book);
    if (books.length > limits.maxBooks) {
      throw new Error(`Import contains more than ${limits.maxBooks} books.`);
    }
  }

  summary.discoveredBooks = books.length;
  return { books, summary };
}
