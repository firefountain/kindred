# Kindred

An API-first, EPUB-first ebook library manager with direct Kindle MTP support.

Kindred is not a Calibre frontend. It owns its library model, metadata engine, device adapters, provider pipeline, and HTTP API.

## Principles

- EPUB is the canonical editable book format.
- Kindred is the source of truth; devices synchronize with Kindred.
- Device formats are edge concerns.
- The Vue application is one API client, not the application core.
- Local libraries survive source upgrades under the OS application-data directory.
- No Calibre dependency.

## Current status

Kindred currently includes:

- persistent remembered libraries and Kindle MTP scanning
- direct book upload to Kindle
- `@kindred/epub-core` for embedded EPUB metadata and cover read/write
- `@kindred/metadata-core` for canonical metadata and deterministic merging
- `@kindred/library-core` for logical books with multiple file formats
- `@kindred/device-core` for device abstractions and capabilities
- `@kindred/plugin-core` for metadata provider registration and execution
- `@kindred/metadata-engine` for field-level scoring, provenance, conflicts, and cover ranking
- Open Library and Google Books provider plugins
- `@kindred/metadata-service` for concurrent provider orchestration and resolution
- a reusable Vue UI package and app-shell preview

The current integration milestone is Metadata API v2, followed by the live metadata inspector, local persistence, EPUB writeback verification, and the reviewed import-to-Kindle flow.

See [the next two-day execution plan](docs/plans/KINDRED_NEXT_2_DAYS_PLAN.md).

## Repository

```text
web/                              Vue client
server/                           Kindred HTTP API and Kindle MTP adapter
packages/epub-core/               EPUB metadata and cover engine
packages/metadata-core/           Canonical metadata model
packages/metadata-engine/         Field resolution, provenance and conflicts
packages/metadata-service/        Provider orchestration
packages/library-core/            Logical library-item model
packages/device-core/             Device abstractions
packages/plugin-core/             Metadata plugin registry
packages/provider-open-library/   Open Library provider
packages/provider-google-books/   Google Books provider
packages/ui/                      Shared Vue design system
docs/architecture/                Architecture decision records
docs/plans/                       Execution plans
```

## Start

```bash
pnpm install
pnpm dev
```

Open `http://localhost:4310`. The API listens on `http://localhost:4311`.

## Test

```bash
pnpm test
pnpm build
```

## EPUB core

`@kindred/epub-core` can read and rewrite title, authors, language, publisher, description, subjects/tags, ISBN, series, series index, and an existing cover image directly inside an EPUB file.

The next device-write milestone is:

```text
download EPUB over MTP
→ rewrite through epub-core
→ upload it back
→ download and verify the embedded metadata
```
