import {
  DEFAULT_PROVIDER_PRIORITY,
  normalizeMetadata,
} from '@kindred/metadata-core';

const SCALAR_FIELDS = [
  'title',
  'subtitle',
  'series',
  'seriesIndex',
  'publisher',
  'language',
  'isbn',
  'asin',
  'description',
];

const ARRAY_FIELDS = [
  'authors',
  'tags',
  'collections',
];

function clean(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function present(value) {
  if (value == null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function clamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function providerWeight(source, priorities) {
  return priorities[source] ?? priorities.unknown ?? 0;
}

function candidateScore(candidate, priorities) {
  const source = candidate.source || 'unknown';
  const manualBonus = source === 'manual' ? 100000 : 0;
  return manualBonus
    + providerWeight(source, priorities) * 100
    + clamp(candidate.confidence) * 100;
}

function normalizeCandidate(candidate, field) {
  return {
    field,
    value: candidate.value,
    source: candidate.source || 'unknown',
    confidence: clamp(candidate.confidence ?? 0.5),
    providerRecordId: candidate.providerRecordId || null,
    evidence: candidate.evidence || [],
  };
}

export function metadataCandidates(record, options = {}) {
  const source = options.source || record.providerId || record.source || 'unknown';
  const confidence = options.confidence ?? record.confidence ?? 0.5;
  const metadata = normalizeMetadata(record.metadata ?? record);
  const candidates = [];

  for (const field of [...SCALAR_FIELDS, ...ARRAY_FIELDS, 'cover']) {
    if (!present(metadata[field])) continue;
    candidates.push(normalizeCandidate({
      field,
      value: metadata[field],
      source,
      confidence,
      providerRecordId: record.id || null,
      evidence: record.evidence?.[field] || [],
    }, field));
  }

  for (const [key, value] of Object.entries(metadata.identifiers || {})) {
    if (!present(value)) continue;
    candidates.push(normalizeCandidate({
      field: `identifiers.${key}`,
      value,
      source,
      confidence,
      providerRecordId: record.id || null,
      evidence: record.evidence?.[`identifiers.${key}`] || [],
    }, `identifiers.${key}`));
  }

  return candidates;
}

function chooseWinner(candidates, priorities) {
  return [...candidates].sort((left, right) => {
    const scoreDelta = candidateScore(right, priorities) - candidateScore(left, priorities);
    if (scoreDelta) return scoreDelta;

    const sourceDelta = String(left.source).localeCompare(String(right.source));
    if (sourceDelta) return sourceDelta;

    return JSON.stringify(left.value).localeCompare(JSON.stringify(right.value));
  })[0] || null;
}

function dedupe(values) {
  return [...new Set(values.map(value => String(value).trim()).filter(Boolean))];
}

export function rankCoverCandidates(covers = [], options = {}) {
  const priorities = {
    ...DEFAULT_PROVIDER_PRIORITY,
    ...(options.priorities || {}),
  };

  return covers
    .filter(cover => cover && (cover.url || cover.bytes))
    .map(cover => {
      const width = Number(cover.width) || 0;
      const height = Number(cover.height) || 0;
      const area = width * height;
      const aspect = width && height ? width / height : 0;
      const aspectPenalty = aspect ? Math.abs(aspect - (2 / 3)) * 500 : 0;
      const source = cover.source || 'unknown';
      const score = providerWeight(source, priorities) * 100
        + clamp(cover.confidence ?? 0.5) * 100
        + Math.min(area / 1000, 5000)
        - aspectPenalty;

      return { ...cover, score };
    })
    .sort((left, right) => right.score - left.score);
}

export function resolveMetadata(records = [], options = {}) {
  const priorities = {
    ...DEFAULT_PROVIDER_PRIORITY,
    ...(options.priorities || {}),
  };

  const allCandidates = records.flatMap(record => metadataCandidates(record));
  const grouped = new Map();

  for (const candidate of allCandidates) {
    const list = grouped.get(candidate.field) || [];
    list.push(candidate);
    grouped.set(candidate.field, list);
  }

  const output = normalizeMetadata({});
  const provenance = {};
  const decisions = [];
  const conflicts = [];

  for (const field of SCALAR_FIELDS) {
    const candidates = grouped.get(field) || [];
    if (!candidates.length) continue;

    const winner = chooseWinner(candidates, priorities);
    output[field] = clean(winner.value);
    provenance[field] = {
      source: winner.source,
      confidence: winner.confidence,
      providerRecordId: winner.providerRecordId,
    };

    decisions.push({
      field,
      winner,
      rejected: candidates.filter(candidate => candidate !== winner),
      reason: winner.source === 'manual'
        ? 'manual-value-protected'
        : 'highest-weighted-confidence',
    });

    const distinct = [...new Set(candidates.map(candidate => JSON.stringify(candidate.value)))];
    if (distinct.length > 1 && ['isbn', 'asin'].includes(field)) {
      conflicts.push({
        field,
        values: candidates.map(candidate => ({
          value: candidate.value,
          source: candidate.source,
          confidence: candidate.confidence,
        })),
      });
    }
  }

  for (const field of ARRAY_FIELDS) {
    const candidates = grouped.get(field) || [];
    if (!candidates.length) continue;

    const winner = chooseWinner(candidates, priorities);

    if (field === 'tags' || field === 'collections') {
      output[field] = dedupe(candidates.flatMap(candidate => candidate.value));
      provenance[field] = {
        source: 'merged',
        confidence: Math.max(...candidates.map(candidate => candidate.confidence)),
        sources: dedupe(candidates.map(candidate => candidate.source)),
      };
      decisions.push({
        field,
        winner: {
          value: output[field],
          source: 'merged',
          confidence: provenance[field].confidence,
        },
        rejected: [],
        reason: 'merged-unique-values',
      });
    } else {
      output[field] = winner.value;
      provenance[field] = {
        source: winner.source,
        confidence: winner.confidence,
        providerRecordId: winner.providerRecordId,
      };
      decisions.push({
        field,
        winner,
        rejected: candidates.filter(candidate => candidate !== winner),
        reason: winner.source === 'manual'
          ? 'manual-value-protected'
          : 'highest-weighted-confidence',
      });
    }
  }

  const identifiers = {};
  for (const [field, candidates] of grouped.entries()) {
    if (!field.startsWith('identifiers.')) continue;
    const key = field.slice('identifiers.'.length);
    const winner = chooseWinner(candidates, priorities);
    identifiers[key] = winner.value;
    provenance[field] = {
      source: winner.source,
      confidence: winner.confidence,
      providerRecordId: winner.providerRecordId,
    };
    decisions.push({
      field,
      winner,
      rejected: candidates.filter(candidate => candidate !== winner),
      reason: winner.source === 'manual'
        ? 'manual-value-protected'
        : 'highest-weighted-confidence',
    });

    const distinct = [...new Set(candidates.map(candidate => JSON.stringify(candidate.value)))];
    if (distinct.length > 1) {
      conflicts.push({
        field,
        values: candidates.map(candidate => ({
          value: candidate.value,
          source: candidate.source,
          confidence: candidate.confidence,
        })),
      });
    }
  }
  output.identifiers = identifiers;

  const coverCandidates = records.flatMap(record => {
    const metadata = normalizeMetadata(record.metadata ?? record);
    if (!metadata.cover) return [];
    return [{
      ...metadata.cover,
      source: record.providerId || record.source || 'unknown',
      confidence: record.confidence ?? 0.5,
    }];
  });
  const rankedCovers = rankCoverCandidates(coverCandidates, { priorities });
  output.cover = rankedCovers[0] || null;

  if (rankedCovers.length) {
    provenance.cover = {
      source: rankedCovers[0].source,
      confidence: clamp(rankedCovers[0].confidence),
      score: rankedCovers[0].score,
    };
    decisions.push({
      field: 'cover',
      winner: rankedCovers[0],
      rejected: rankedCovers.slice(1),
      reason: 'highest-cover-quality-score',
    });
  }

  return {
    metadata: normalizeMetadata(output),
    provenance,
    decisions,
    conflicts,
    coverCandidates: rankedCovers,
  };
}
