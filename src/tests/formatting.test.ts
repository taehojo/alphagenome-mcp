// src/tests/formatting.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatBatchResult, formatSourceLine, formatVariantResult } from '../utils/formatting.js';
import type { BatchResult, VariantResult } from '../types.js';

const variant: VariantResult = {
  variant: 'chr19:44908684T>C',
  predictions: {
    rna_seq: { reference_score: 1.0, alternate_score: 0.5, fold_change: -1.0 },
  },
  interpretation: { impact_level: 'moderate', recommendations: [] },
};

const batch: BatchResult = {
  total_analyzed: 2,
  variants: [
    { variant: 'chr19:44908684T>C', score: 0.9, impact_level: 'high', rank: 1 },
    { variant: 'chr17:49210289AG>A', score: 0.1, impact_level: 'low', rank: 2 },
  ],
  distribution: { high: 1, low: 1 },
};

test('every variant result states its source', () => {
  assert.match(formatVariantResult({ ...variant, source: 'atlas' }), /\*\*Source\*\*: atlas\n/);
  assert.match(formatVariantResult({ ...variant, source: 'live' }), /\*\*Source\*\*: live\n/);
});

test('a result with no source set is reported as live, never left blank', () => {
  assert.match(formatVariantResult(variant), /\*\*Source\*\*: live\n/);
});

test('a fallback is visible in the text, with its hint', () => {
  const text = formatVariantResult({
    ...variant,
    source: 'live (atlas fallback: variant not found)',
    source_hint: 'The reference base may not match hg38.',
  });
  assert.match(text, /\*\*Source\*\*: live \(atlas fallback: variant not found\)/);
  assert.match(text, /\*\*Note\*\*: The reference base may not match hg38\./);
});

test('a batch result states its source and the fallback count', () => {
  const text = formatBatchResult({
    ...batch,
    source: 'mixed',
    source_counts: { atlas: 1, live: 1, atlas_fallback: 1 },
  });
  assert.match(text, /\*\*Source\*\*: mixed/);
  assert.match(text, /atlas 1, live 1 \(1 after atlas fallback\)/);
});

test('no constant confidence is printed', () => {
  const text = formatVariantResult({ ...variant, source: 'live' });
  assert.doesNotMatch(text, /confidence/i);
  assert.doesNotMatch(text, /0\.85|85%/);
});

test('the source line helper', () => {
  assert.equal(formatSourceLine('atlas'), '**Source**: atlas\n');
  assert.equal(
    formatSourceLine('live', 'check the build'),
    '**Source**: live\n**Note**: check the build\n'
  );
});
