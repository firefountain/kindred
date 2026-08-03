import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeEpubFileSafely } from './epubWriteback.js';

function safeName(value = 'book.epub') {
  return path.basename(String(value)).replace(/[^a-zA-Z0-9._ -]+/g, '_');
}

function metadataPatch(review = {}) {
  return {
    title: review.title,
    authors: review.authors,
    language: review.language,
    publisher: review.publisher,
    description: review.description,
    isbn: review.isbn,
    series: review.series,
    seriesIndex: review.seriesIndex,
    tags: review.tags,
  };
}

export function prepareReviewedBook(book, review = {}, options = {}) {
  const extension = String(book.extension || path.extname(book.fileName)).toLowerCase();
  if (extension !== '.epub') {
    return {
      ...book,
      uploadBuffer: Buffer.from(book.buffer),
      writeback: { attempted: false, verified: false, reason: 'format-not-epub' },
    };
  }

  const workspace = fs.mkdtempSync(path.join(options.tempRoot || os.tmpdir(), 'kindred-import-'));
  const filePath = path.join(workspace, `${crypto.randomUUID()}-${safeName(book.fileName)}`);
  const backupDir = path.join(workspace, 'backups');

  try {
    fs.writeFileSync(filePath, book.buffer, { flag: 'wx' });
    const result = writeEpubFileSafely(filePath, metadataPatch(review), {
      backupDir,
      cover: options.cover,
    });
    const uploadBuffer = fs.readFileSync(filePath);

    return {
      ...book,
      size: uploadBuffer.byteLength,
      uploadBuffer,
      writeback: {
        attempted: true,
        verified: true,
        originalSha256: result.originalSha256,
        writtenSha256: result.writtenSha256,
        originalBytes: result.originalBytes,
        writtenBytes: result.writtenBytes,
        metadata: result.metadata,
      },
    };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

export function matchReviewedMetadata(books, reviews = []) {
  const byHash = new Map(
    reviews
      .filter(review => review.sha256)
      .map(review => [String(review.sha256), review]),
  );
  const byOrigin = new Map(
    reviews.map(review => [
      `${String(review.archiveName || '')}:${String(review.archivePath || review.fileName || '').toLowerCase()}`,
      review,
    ]),
  );

  return books.map(book => {
    const originKey = `${String(book.archiveName || '')}:${String(book.archivePath || book.fileName || '').toLowerCase()}`;
    return {
      book,
      review: byHash.get(book.sha256) || byOrigin.get(originKey) || null,
    };
  });
}
