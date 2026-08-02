# Kindred

An API-first, EPUB-first ebook library manager with direct Kindle MTP support.

Kindred is not a Calibre frontend. It owns its library model, metadata engine, device adapters, and HTTP API.

## Principles

- EPUB is the canonical editable book format.
- Device formats are edge concerns.
- The Vue application is one API client, not the application core.
- Local libraries survive source upgrades under the OS application-data directory.
- No Calibre dependency.

## Repository

```text
web/                    Vue client
server/                 Kindred HTTP API and Kindle MTP adapter
packages/epub-core/     EPUB metadata and cover engine
docs/architecture/      Architecture decision records
```

## Start

```bash
pnpm install
pnpm dev
```

Open `http://localhost:4310`. The API listens on `http://localhost:4311/api/v1`.

## Test

```bash
pnpm test
pnpm build
```

## Current EPUB core

`@kindred/epub-core` can read and rewrite title, authors, language, publisher, description, subjects/tags, ISBN, series, series index, and an existing cover image directly inside an EPUB file.

The next device-write milestone is: download an EPUB over MTP, rewrite it through `epub-core`, upload it back, then download and verify the embedded metadata.
