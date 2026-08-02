# Kindred: 2-Day Execution Plan

**Window:** 3–4 August 2026  
**Goal:** Move Kindred from “metadata architecture exists” to a usable end-to-end metadata workflow in the live app.

---

## Guiding Principle

> **Kindred is the source of truth. Devices synchronize with Kindred. Devices are not the source of truth.**

For these two days, avoid adding more providers, more UI polish, or new device types unless they directly support the end-to-end flow below.

The target flow is:

```text
Import or scan book
→ read embedded metadata
→ call metadata API v2
→ compare candidates
→ resolve metadata
→ let user review changes
→ save to local library
→ write back to EPUB where supported
→ sync to Kindle
```

---

# Day 1: Stabilize Metadata API and Wire It Into the Live App

## Outcome for the Day

By the end of Day 1:

- Metadata API v2 is merged and tested.
- The current Vue app can call `/api/v2/metadata/search` and `/api/v2/metadata/enrich`.
- The app can display resolved metadata, provenance, provider errors, and cover candidates.
- Existing v1 flows still work.
- No direct provider calls remain in newly migrated UI code.

---

## 1. Merge and Verify Metadata API v2

### Tasks

1. Finish the `feature/metadata-api-v2` branch.
2. Run the complete test and build suite.
3. Merge the PR only after confirming the diff is limited to:
   - `server/package.json`
   - `server/src/index.js`
   - `server/src/metadataApi.js`
   - `server/test/metadataApi.test.js`
   - `pnpm-lock.yaml`

### Commands

```bash
git checkout feature/metadata-api-v2
git status
git diff origin/main...HEAD --stat

pnpm install
pnpm --filter kindred-server test
pnpm test
pnpm build
```

### Manual API verification

```bash
pnpm dev
```

In another terminal:

```bash
curl -s http://localhost:4311/api/v2/metadata/search \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "World War Z",
    "authors": ["Max Brooks"],
    "isbn": "9780307351937"
  }' | jq
```

```bash
curl -s http://localhost:4311/api/v2/metadata/enrich \
  -H 'Content-Type: application/json' \
  -d '{
    "baseSource": "manual",
    "baseConfidence": 1,
    "metadata": {
      "title": "World War Z",
      "authors": ["Max Brooks"],
      "isbn": "9780307351937"
    }
  }' | jq
```

### Acceptance Criteria

- Both endpoints return HTTP 200.
- Open Library and Google Books appear in `providers`.
- One provider may fail without failing the whole request.
- Response includes:
  - `metadata`
  - `provenance`
  - `decisions`
  - `conflicts`
  - `coverCandidates`
  - `candidates`
  - `providers`
  - `errors`
  - `durationMs`
- Manual metadata remains protected.
- Existing `/api/v1/metadata/search` still works.

---

## 2. Add a Frontend API Client for Metadata v2

### Branch

```text
feature/web-metadata-api-v2
```

### Files

```text
web/src/api/metadata.js
web/src/api/client.js
```

Do not place raw `fetch()` calls inside Vue components.

### Suggested Interface

```js
export async function searchMetadata(query) {
  return apiRequest('/api/v2/metadata/search', {
    method: 'POST',
    body: query,
  });
}

export async function enrichMetadata(book, options = {}) {
  return apiRequest('/api/v2/metadata/enrich', {
    method: 'POST',
    body: {
      id: book.id,
      metadata: book.metadata ?? book,
      baseSource: options.baseSource ?? 'embedded',
      baseConfidence: options.baseConfidence ?? 0.9,
    },
  });
}
```

### Acceptance Criteria

- API base URL is centralized.
- JSON parsing and HTTP errors are handled once.
- Provider failure details are preserved.
- Vue components do not know endpoint URLs.
- Unit tests cover:
  - success response
  - HTTP failure
  - invalid JSON or network failure
  - provider partial failure

---

## 3. Create a Metadata Store

### Branch

Continue on:

```text
feature/web-metadata-api-v2
```

### Files

```text
web/src/stores/metadata.js
```

### Store State

```js
{
  searching: false,
  enriching: false,
  activeBookId: null,
  result: null,
  candidates: [],
  providers: [],
  conflicts: [],
  coverCandidates: [],
  errors: [],
  lastQuery: null
}
```

### Store Actions

```js
search(query)
enrich(book, options)
clear()
applyResolvedMetadata(book)
selectCover(cover)
```

### Rules

- Store holds transport state.
- Components render state.
- The store does not mutate the persisted book until the user confirms.
- Provider errors are shown, not silently swallowed.

### Acceptance Criteria

- Search and enrichment have separate loading states.
- Repeated calls cancel or ignore stale results.
- Active book ID prevents responses being applied to the wrong drawer.
- Errors distinguish:
  - network errors
  - API validation errors
  - provider-specific errors

---

## 4. Build the Metadata Inspector v1

### Branch

```text
feature/metadata-inspector-v1
```

### Goal

Add a usable inspector to the current app without replacing the entire UI.

### Sections

```text
Resolved Metadata
Provider Status
Conflicts
Cover Candidates
Decision Trace
Raw Candidates
```

### Minimum UI

For each resolved field:

```text
Title
World War Z

Source: Open Library
Confidence: 90%
Reason: highest-weighted-confidence
```

Provider status:

```text
Open Library    3 results    184 ms
Google Books    5 results    237 ms
```

Provider failure:

```text
Google Books
429 rate limit
```

Conflict example:

```text
ISBN conflict

Open Library: 9780307351937
Google Books: 9780307346605
```

### Components

Prefer small components:

```text
MetadataInspector.vue
MetadataFieldDecision.vue
MetadataProviderStatus.vue
MetadataConflict.vue
CoverCandidateGrid.vue
```

### Acceptance Criteria

- Inspector opens from an existing book.
- “Fetch metadata” calls API v2.
- Current values and proposed values are visually distinct.
- Manual fields are marked as protected.
- Provider errors do not break the inspector.
- User can select a cover candidate.
- User can accept or cancel the resolved metadata.

---

## 5. Day 1 Regression Pass

### Test These Flows

1. Launch with no Kindle connected.
2. Open remembered library.
3. Scan Kindle.
4. Open a book.
5. Fetch metadata.
6. Cancel metadata changes.
7. Fetch again and accept.
8. Relaunch Kindred.
9. Confirm accepted metadata remains in the local library.
10. Confirm the Kindle scan still works.

### Day 1 Definition of Done

```text
API v2 merged
Frontend API client merged
Metadata store merged
Metadata Inspector v1 usable
No regression in Kindle scanning
No regression in remembered libraries
No direct provider fetches in migrated UI code
```

---

# Day 2: Persist Metadata Properly and Complete the Import-to-Kindle Flow

## Outcome for the Day

By the end of Day 2:

- Accepted metadata persists in the local library.
- EPUB metadata is written into the actual EPUB file.
- A re-read of the EPUB returns the saved metadata.
- Imported EPUBs are enriched before sending to Kindle.
- The user sees exactly what will be written before synchronization.

---

## 1. Add Metadata Persistence to the Local Library

### Branch

```text
feature/library-metadata-persistence
```

### Persist

For each logical library item:

```js
{
  metadata,
  provenance,
  metadataHistory,
  selectedCover,
  updatedAt
}
```

### Metadata History Entry

```js
{
  id,
  timestamp,
  source,
  previous,
  next,
  decisions,
  providers,
  conflicts
}
```

### API

Add or standardize:

```text
PUT /api/v2/libraries/:libraryId/items/:itemId/metadata
GET /api/v2/libraries/:libraryId/items/:itemId/metadata/history
```

### Acceptance Criteria

- Accepting metadata updates the local library.
- Relaunch restores the accepted metadata.
- History records previous and new values.
- Cancel leaves the book unchanged.
- Provenance survives persistence.

---

## 2. Integrate `epub-core` Into the Save Flow

### Branch

```text
feature/epub-metadata-writeback
```

### Required Flow

```text
Read EPUB
→ resolve metadata
→ user confirms
→ write metadata to temporary EPUB
→ re-read temporary EPUB
→ verify values
→ atomically replace original EPUB
```

### Never Do

```text
write directly over the only copy
```

### Safety

- Create a backup before replacement.
- Use a temporary output file.
- Verify the output EPUB.
- Keep the original if verification fails.
- Record original and output SHA-256.

### Fields to Write

Minimum:

```text
title
subtitle
authors
publisher
language
description
isbn
tags / subjects
series
series index
cover
Kindred UUID
```

### Acceptance Criteria

- Write succeeds for a valid EPUB.
- Re-read returns the new metadata.
- Cover replacement works.
- Invalid EPUB remains untouched.
- Failed verification restores the original.
- Tests cover:
  - metadata-only write
  - cover write
  - round trip
  - invalid EPUB
  - rollback on failed verification

---

## 3. Add Import Review Before Kindle Upload

### Branch

```text
feature/import-review-flow
```

### New Import Flow

```text
Select EPUB
→ read embedded metadata
→ call metadata API v2
→ show review screen
→ user accepts or edits
→ write metadata into EPUB
→ add to Kindred library
→ send to Kindle
```

### Review Screen

Show:

```text
Current embedded value
Resolved value
Source
Confidence
Conflict indicator
Selected cover
```

### Controls

```text
Accept all
Accept selected fields
Keep embedded metadata
Edit manually
Cancel import
Send to Kindle
Save to library only
```

### Acceptance Criteria

- No book is sent before review unless the user explicitly enables automatic import.
- Metadata is written to the EPUB before upload.
- The local library receives the exact metadata written to the EPUB.
- Kindle upload uses the final modified file.
- Failed upload does not delete the local library item.
- A successful upload creates or updates the device link.

---

## 4. Add a Sync Preview

### Branch

Continue on:

```text
feature/import-review-flow
```

### Preview

Before writing to the Kindle:

```text
Book: World War Z
Format: EPUB
Target: Kindle Scribe

Local changes:
- Title updated
- Publisher added
- 3 tags added
- Cover replaced

Device action:
- Upload new file
- Replace existing matching file
- Update metadata.calibre
- Refresh cover sidecar
```

### Acceptance Criteria

- User sees all device actions before execution.
- Dry run and execute use the same generated plan.
- Sync plan includes:
  - local file
  - remote path
  - overwrite status
  - metadata sidecar changes
  - cover changes
- No device mutation happens during preview.

---

## 5. Persist and Restore the Active Library Correctly

This needs a deliberate regression check because it has already been unreliable.

### Startup Rules

1. Load the last active Kindred library from local storage.
2. Display the remembered device as offline if not connected.
3. Show saved books immediately.
4. Do not require a new Kindle scan.
5. When the Kindle reconnects:
   - match it by stable device ID or serial
   - offer refresh
   - do not create a duplicate library

### Acceptance Criteria

- Relaunch shows the last library immediately.
- Metadata edits survive relaunch.
- Covers survive relaunch.
- Kindle disconnected state is clear.
- Reconnecting the same Kindle reuses the existing library.

---

## 6. Day 2 End-to-End Test

Use one clean EPUB and one known Kindle book.

### Test Script

```text
1. Launch Kindred without Kindle.
2. Confirm remembered library loads.
3. Import EPUB.
4. Confirm embedded metadata is read.
5. Fetch Open Library and Google Books metadata.
6. Review provider decisions.
7. Select a cover.
8. Accept metadata.
9. Write EPUB.
10. Re-read EPUB and verify metadata.
11. Add book to local library.
12. Connect Kindle.
13. Preview sync.
14. Upload book.
15. Scan Kindle.
16. Confirm device link.
17. Relaunch Kindred.
18. Confirm metadata and cover are still present.
```

### Day 2 Definition of Done

```text
Metadata persists locally
EPUB metadata round trip works
Cover writeback works
Import review exists
Sync preview exists
Kindle receives the final reviewed file
Relaunch restores the library and metadata
```

---

# Explicitly Out of Scope for These Two Days

Do not wander into these, however seductive they look:

```text
More metadata providers
Goodreads scraping
StoryGraph integration
Kobo support
OPDS
AI recommendations
Full UI redesign
Author pages
Series pages
Reading statistics
Command palette
SQLite migration
KFX metadata editing
PDF metadata editing
AZW3 conversion
```

They are not bad ideas. They are just excellent ways to finish nothing.

---

# Suggested PR Order

```text
PR 12  Metadata API v2
PR 13  Frontend metadata client and store
PR 14  Metadata Inspector v1
PR 15  Local metadata persistence and history
PR 16  EPUB metadata writeback
PR 17  Import review and sync preview
```

Keep every PR reviewable. Each PR should either add one package, one API boundary, or one user-visible flow. No more giant overlays. The repository has already survived one near-death experience and need not develop character from another.

---

# Final Success State

At the end of the two days, this should work:

```text
Drag EPUB into Kindred
→ metadata and cover appear
→ providers fill missing information
→ user sees exactly why each value was chosen
→ user confirms
→ Kindred writes the metadata into the EPUB
→ Kindred saves the book locally
→ Kindred sends the reviewed file to Kindle
→ relaunch shows the same library, metadata, and cover
```

That is the first version of Kindred that genuinely replaces the metadata workflow people currently tolerate in Calibre.
