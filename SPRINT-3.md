# Sprint 3A: Kindred UI system

This slice adds the reusable `@kindred/ui` Vue package and a standalone design-system preview.

## Apply

```bash
git checkout main
git pull
git checkout -b feature/ui-system

unzip ~/Downloads/kindred-sprint3-ui-system.zip -d /tmp/kindred-sprint3
cp -R /tmp/kindred-sprint3/kindred-sprint3-ui-system/. .

pnpm install
pnpm --filter kindred-web design
```

Open `http://localhost:5173/preview.html` if Vite does not open it automatically.

## Validate

```bash
pnpm --filter kindred-web build
```

## Commit

```bash
git add packages/ui web/package.json web/preview.html web/src/preview-main.js web/src/views/DesignSystemPreview.vue
git commit -m "feat(ui): add Kindred design system and app shell"
git push -u origin feature/ui-system
```

This intentionally does not replace `App.vue` yet. The next PR migrates the live library screen onto these primitives after the visual system is approved.
