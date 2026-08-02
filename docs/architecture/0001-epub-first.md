# ADR 0001: EPUB is Kindred's canonical library format

Status: Accepted

Kindred stores and edits books as EPUB whenever possible. Device-specific formats are export targets, not the library source of truth.

## Consequences

- Metadata and covers are read from and written to the EPUB itself.
- The Kindle adapter remains a transport boundary.
- Amazon-managed KFX content is read-only and outside the first supported write path.
- New device adapters consume the same logical library API.
- No Calibre installation, CLI, database, or runtime dependency is permitted.
