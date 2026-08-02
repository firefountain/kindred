# @kindred/metadata-core

Canonical metadata models and deterministic provider merging for Kindred.

```js
import {
  createMetadataRecord,
  mergeProviderResults,
  providerResult,
} from '@kindred/metadata-core';

const embedded = createMetadataRecord(
  { title: 'World War Z', authors: ['Max Brooks'] },
  'embedded',
  0.95,
);

const merged = mergeProviderResults(embedded, [
  providerResult('openLibrary', {
    publisher: 'Crown',
    tags: ['Horror', 'Zombies'],
  }, 0.85),
]);
```

Manual edits always win. `fill-holes` mode never replaces populated fields.
