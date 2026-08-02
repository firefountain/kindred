# Sprint 3B: Library engine implementation

This change introduces:

- `@kindred/library-core`
- `@kindred/device-core`
- `@kindred/plugin-core`
- one typed-ish API client boundary
- Pinia library, device, metadata, and sync stores
- Pinia bootstrapping in the Vue client

The existing `App.vue` remains operational. The next PR migrates individual
features away from direct `fetch()` calls and into these stores.

## Apply

```bash
git checkout main
git pull
git checkout -b feature/library-engine

unzip ~/Downloads/kindred-sprint3b-implementation.zip -d /tmp/kindred-sprint3b
cp -R /tmp/kindred-sprint3b/kindred-sprint3b-implementation/. .

pnpm install
pnpm test
pnpm build
```

## Commit

```bash
git add package.json packages/device-core packages/plugin-core packages/library-core web
git commit -m "feat(core): add library, device and plugin engines"
git push -u origin feature/library-engine
```
