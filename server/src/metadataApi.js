import express from 'express';
import { createMetadataService } from '@kindred/metadata-service';

function text(value) {
  return String(value ?? '').trim();
}

function cleanAuthors(value) {
  const input = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(input.map(text).filter(Boolean))];
}

function normalizeQuery(body = {}) {
  return {
    title: text(body.title),
    authors: cleanAuthors(body.authors ?? body.author),
    isbn: text(body.isbn).replace(/[^0-9X]/gi, '').toUpperCase(),
    language: text(body.language),
    q: text(body.q),
  };
}

function hasSearchInput(query) {
  return Boolean(
    query.isbn ||
    query.title ||
    query.authors.length ||
    query.q
  );
}

function publicResult(result) {
  return {
    query: result.query,
    metadata: result.resolution.metadata,
    provenance: result.resolution.provenance,
    decisions: result.resolution.decisions,
    conflicts: result.resolution.conflicts,
    coverCandidates: result.resolution.coverCandidates,
    candidates: result.candidates,
    providers: result.providers,
    errors: result.errors,
    durationMs: result.durationMs,
  };
}

export function createMetadataHandlers(options = {}) {
  const service = options.service || createMetadataService({
    openLibrary: {
      application:
        options.openLibraryApplication ||
        process.env.OPEN_LIBRARY_APPLICATION ||
        'Kindred',
      contact:
        options.openLibraryContact ||
        process.env.OPEN_LIBRARY_CONTACT ||
        '',
      timeoutMs: Number(process.env.METADATA_TIMEOUT_MS) || 8000,
    },
    googleBooks: {
      apiKey:
        options.googleBooksApiKey ||
        process.env.GOOGLE_BOOKS_API_KEY ||
        '',
      timeoutMs: Number(process.env.METADATA_TIMEOUT_MS) || 8000,
    },
  });

  async function search(req, res) {
    const query = normalizeQuery(req.body);

    if (!hasSearchInput(query)) {
      return res.status(400).json({
        error: 'ISBN, title, author, or q is required.',
        code: 'METADATA_QUERY_REQUIRED',
      });
    }

    try {
      const result = await service.search(query, {
        timeoutMs: Number(req.body?.timeoutMs) || undefined,
      });

      return res.json(publicResult(result));
    } catch (error) {
      return res.status(502).json({
        error: error.message,
        code: 'METADATA_SEARCH_FAILED',
      });
    }
  }

  async function enrich(req, res) {
    const body = req.body || {};
    const metadata = body.metadata || body.book?.metadata || body.book || body;
    const query = normalizeQuery(metadata);

    if (!hasSearchInput(query)) {
      return res.status(400).json({
        error: 'The book requires an ISBN, title, or author before enrichment.',
        code: 'METADATA_BOOK_REQUIRED',
      });
    }

    try {
      const result = await service.enrich(
        {
          id: body.id || body.book?.id || null,
          metadata: {
            ...metadata,
            title: query.title,
            authors: query.authors,
            isbn: query.isbn,
            language: query.language,
          },
        },
        {
          baseSource: body.baseSource || 'embedded',
          baseConfidence:
            body.baseConfidence == null
              ? 0.9
              : Number(body.baseConfidence),
          timeoutMs: Number(body.timeoutMs) || undefined,
        },
      );

      return res.json(publicResult(result));
    } catch (error) {
      return res.status(502).json({
        error: error.message,
        code: 'METADATA_ENRICH_FAILED',
      });
    }
  }

  return { service, search, enrich };
}

export function createMetadataRouter(options = {}) {
  const router = express.Router();
  const handlers = createMetadataHandlers(options);

  router.post('/search', handlers.search);
  router.post('/enrich', handlers.enrich);

  return router;
}
