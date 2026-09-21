// src/tests/routed-tools.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assessPathogenicityRouted,
  batchScoreRouted,
  predictVariantRouted,
  scorersForMetric,
  VariantBackend,
} from '../routed-tools.js';
import { capResponse, MAX_RESPONSE_CHARS } from '../utils/atlas-formatting.js';
import {
  ApiKeyError,
  AtlasBatchResult,
  AtlasNotAvailableError,
  AtlasVariantResult,
  NetworkError,
  RateLimitError,
  ValidationError,
} from '../types.js';

const snv = { chromosome: 'chr19', position: 44908684, ref: 'T', alt: 'C' };
const deletion = { chromosome: 'chr17', position: 49210289, ref: 'CCC', alt: 'C' };

const atlasVariant: AtlasVariantResult = {
  source: 'atlas',
  variant: 'chr19:44908684:T>C',
  scorers: ['AVI_SCORE', 'DNASE'],
  rows_per_scorer: 3,
  response_cap: 'top 3 cells per scorer',
  results: [
    {
      scorer: 'AVI_SCORE',
      available: true,
      rows: 1,
      tracks: 1,
      max_abs_score: 0.4999,
      median_abs_score: 0.4999,
      top: [{ score: 0.4999, quantile: 0.98699, track: { name: 'AVI_SCORE' } }],
    },
    {
      scorer: 'DNASE',
      available: true,
      rows: 1,
      tracks: 305,
      max_abs_score: 0.12269,
      median_abs_score: 0.022,
      top: [{ score: 0.12269, quantile: 0.94636, track: { biosample_name: 'brain' } }],
    },
  ],
};

function atlasBatch(found: number, missingIndexes: number[] = []): AtlasBatchResult {
  return {
    source: 'atlas',
    scorers: ['AVI_SCORE'],
    ranked_by: 'absolute AVI_SCORE score',
    requested: found + missingIndexes.length,
    found,
    not_in_atlas: missingIndexes.map((index) => ({
      index,
      variant: `missing-${index}`,
      reason: 'not found',
    })),
    invalid: [],
    response_cap: 'top 25',
    ranked: Array.from({ length: found }, (_, i) => ({
      rank: i + 1,
      variant: `chr1:${100 + i}:A>G`,
      scores: { AVI_SCORE: { score: 1 - i * 0.1, quantile: 0.9 } },
    })),
  };
}

/** A backend that records which calls were made. */
function fakeBackend(overrides: Partial<VariantBackend> = {}) {
  const calls: string[] = [];
  const backend: VariantBackend = {
    atlasLookupVariant: async () => {
      calls.push('atlas');
      return atlasVariant;
    },
    atlasLookupVariants: async ({ variants }) => {
      calls.push(`atlasBatch:${variants.length}`);
      return atlasBatch(variants.length);
    },
    predictVariant: async () => {
      calls.push('live');
      return {
        variant: 'live-variant',
        predictions: {},
        interpretation: { impact_level: 'low', recommendations: [] },
      };
    },
    assessPathogenicity: async () => {
      calls.push('livePathogenicity');
      return { pathogenicity_score: 0.1 };
    },
    batchScore: async ({ variants }) => {
      calls.push(`liveBatch:${variants.length}`);
      return { total_analyzed: variants.length, variants: [], distribution: {} };
    },
    ...overrides,
  };
  return { backend, calls };
}

const missing = async (): Promise<never> => {
  throw new AtlasNotAvailableError('Variant not found (position unresolved)');
};

test('auto answers an SNV from the Atlas without calling the model', async () => {
  const { backend, calls } = fakeBackend();
  const text = await predictVariantRouted(backend, snv);
  assert.deepEqual(calls, ['atlas']);
  assert.match(text, /\*\*Source\*\*: atlas\n/);
});

test('auto answers a deletion with live inference and says why', async () => {
  const { backend, calls } = fakeBackend();
  const text = await predictVariantRouted(backend, deletion);
  assert.deepEqual(calls, ['live']);
  assert.match(text, /\*\*Source\*\*: live\n/);
  assert.match(text, /Live inference because: deletion/);
});

test('source=live never touches the Atlas', async () => {
  const { backend, calls } = fakeBackend();
  await predictVariantRouted(backend, { ...snv, source: 'live' });
  assert.deepEqual(calls, ['live']);
});

test('auto falls back to live when the Atlas does not hold the variant, and labels it', async () => {
  const { backend, calls } = fakeBackend({ atlasLookupVariant: missing });
  const text = await predictVariantRouted(backend, snv);
  assert.deepEqual(calls, ['live']);
  assert.match(text, /\*\*Source\*\*: live \(atlas fallback: Variant not found/);
});

test('source=atlas never falls back', async () => {
  const { backend, calls } = fakeBackend({ atlasLookupVariant: missing });
  await assert.rejects(
    predictVariantRouted(backend, { ...snv, source: 'atlas' }),
    AtlasNotAvailableError
  );
  assert.deepEqual(calls, []);
});

test('source=atlas rejects a deletion before any call', async () => {
  const { backend, calls } = fakeBackend();
  await assert.rejects(
    predictVariantRouted(backend, { ...deletion, source: 'atlas' }),
    ValidationError
  );
  assert.deepEqual(calls, []);
});

test('auth, rate limit, network and validation failures are never hidden by a fallback', async () => {
  const failures = [
    new ApiKeyError('bad key'),
    new RateLimitError('quota'),
    new NetworkError('timed out'),
    new ValidationError('reference base does not match the expected reference base: T.'),
  ];
  for (const failure of failures) {
    const { backend, calls } = fakeBackend({
      atlasLookupVariant: async () => {
        throw failure;
      },
    });
    await assert.rejects(
      predictVariantRouted(backend, snv),
      failure.constructor as ErrorConstructor
    );
    assert.deepEqual(calls, []);
  }
});

test('pathogenicity from the Atlas reports the AVI score and no invented class', async () => {
  const { backend } = fakeBackend();
  const result = await assessPathogenicityRouted(backend, snv);
  assert.equal(result.source, 'atlas');
  assert.deepEqual(result.avi_score, { score: 0.4999, quantile: 0.98699 });
  assert.equal(result.classification, null);
  assert.equal(JSON.stringify(result).includes('confidence'), false);
});

test('pathogenicity for a deletion is live and labelled', async () => {
  const { backend, calls } = fakeBackend();
  const result = await assessPathogenicityRouted(backend, deletion);
  assert.deepEqual(calls, ['livePathogenicity']);
  assert.equal(result.source, 'live');
});

test('a batch is routed per variant and reported as two groups', async () => {
  const { backend, calls } = fakeBackend();
  const text = await batchScoreRouted(backend, {
    variants: [snv, deletion, snv],
    scoring_metric: 'combined',
  });
  assert.deepEqual(calls, ['atlasBatch:2', 'liveBatch:1']);
  assert.match(text, /\*\*Source\*\*: mixed/);
  assert.match(text, /atlas 2, live 1\n/);
  assert.match(text, /must not be compared/);
});

test('a batch counts the variants that fell back to live', async () => {
  const { backend, calls } = fakeBackend({
    atlasLookupVariants: async () => atlasBatch(1, [1]),
  });
  const text = await batchScoreRouted(backend, {
    variants: [snv, snv],
    scoring_metric: 'combined',
  });
  assert.deepEqual(calls, ['liveBatch:1']);
  assert.match(text, /atlas 1, live 1 \(1 after atlas fallback\)/);
});

test('a batch with source=atlas does not send missing variants to live', async () => {
  const { backend, calls } = fakeBackend({
    atlasLookupVariants: async () => atlasBatch(1, [1]),
  });
  const text = await batchScoreRouted(backend, {
    variants: [snv, snv],
    scoring_metric: 'combined',
    source: 'atlas',
  });
  assert.deepEqual(calls, []);
  assert.match(text, /\*\*Source\*\*: atlas/);
  assert.match(text, /Not in the Atlas \(1\)/);
});

test('a live scoring metric maps to an Atlas scorer', () => {
  assert.deepEqual(scorersForMetric('rna_seq'), ['RNA_SEQ']);
  assert.deepEqual(scorersForMetric('splice'), ['SPLICE_SITES']);
  assert.deepEqual(scorersForMetric('combined'), ['AVI_SCORE']);
  assert.deepEqual(scorersForMetric('regulatory_impact'), ['AVI_SCORE']);
});

test('no response can exceed the size cap', () => {
  const capped = capResponse('x'.repeat(MAX_RESPONSE_CHARS * 2));
  assert.ok(capped.length <= MAX_RESPONSE_CHARS);
  assert.match(capped, /Response truncated/);
  assert.equal(capResponse('short'), 'short');
});
