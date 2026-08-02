# Sprint 1: EPUB metadata core

This overlay hardens `@kindred/epub-core` around one contract:

1. Validate an EPUB archive.
2. Read embedded OPF metadata and the manifest cover.
3. Rewrite metadata and an existing cover directly in the EPUB.
4. Re-open the resulting bytes and verify the requested fields.

## Apply

Copy the overlay into the repository root:

```bash
cp -R kindred-sprint1-patch/. .
pnpm install
pnpm --filter @kindred/epub-core test
```

Then commit:

```bash
git add packages/epub-core
git commit -m "feat(epub): complete metadata round-trip core"
git push
```
