import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readEpub, verifyEpubMetadata, writeEpub } from '@kindred/epub-core';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function ensureEpub(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.epub') {
    throw new Error('EPUB writeback only supports .epub files.');
  }
}

export function writeEpubFileSafely(filePath, metadata, options = {}) {
  ensureEpub(filePath);
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) throw new Error(`EPUB file not found: ${absolute}`);

  const original = fs.readFileSync(absolute);
  const originalSha256 = sha256(original);
  const directory = path.dirname(absolute);
  const basename = path.basename(absolute);
  const token = crypto.randomUUID();
  const tempPath = path.join(directory, `.${basename}.${token}.tmp`);
  const backupDir = path.resolve(options.backupDir || path.join(directory, '.kindred-backups'));
  const backupPath = path.join(backupDir, `${basename}.${Date.now()}.${originalSha256.slice(0, 12)}.bak`);

  let output;
  try {
    output = writeEpub(original, metadata, { cover: options.cover });
    fs.writeFileSync(tempPath, output, { flag: 'wx' });

    const temporaryBytes = fs.readFileSync(tempPath);
    const verification = verifyEpubMetadata(temporaryBytes, metadata);
    if (!verification.valid) {
      throw new Error(`EPUB metadata verification failed: ${JSON.stringify(verification.mismatches)}`);
    }

    // Re-open the archive as a final structural check before touching the original.
    readEpub(temporaryBytes);
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(backupPath, original, { flag: 'wx' });
    fs.renameSync(tempPath, absolute);

    const written = fs.readFileSync(absolute);
    const writtenSha256 = sha256(written);
    const finalVerification = verifyEpubMetadata(written, metadata);
    if (!finalVerification.valid) {
      fs.writeFileSync(absolute, original);
      throw new Error(`Final EPUB verification failed; original restored: ${JSON.stringify(finalVerification.mismatches)}`);
    }

    return {
      path: absolute,
      backupPath,
      originalSha256,
      writtenSha256,
      originalBytes: original.byteLength,
      writtenBytes: written.byteLength,
      metadata: finalVerification.metadata,
      verified: true,
    };
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
    throw error;
  }
}
