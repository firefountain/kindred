# Sprint 2: Metadata Core

This overlay adds `@kindred/metadata-core` and restores the accidentally deleted
`packages/epub-core/package.json`.

## Apply

```bash
git checkout main
git pull
git checkout -b feature/metadata-core

unzip ~/Downloads/kindred-sprint2-metadata-core.zip -d /tmp/kindred-sprint2
cp -R /tmp/kindred-sprint2/kindred-sprint2-metadata-core/. .

pnpm install
pnpm --filter @kindred/metadata-core test
pnpm --filter @kindred/epub-core test

git add packages/epub-core/package.json packages/metadata-core
git commit -m "feat(metadata): add canonical metadata merge core"
git push -u origin feature/metadata-core
```
