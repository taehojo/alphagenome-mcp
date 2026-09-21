// src/tests/routing.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  atlasEligibility,
  decideSource,
  fallbackHint,
  partitionBySource,
  shouldFallBackToLive,
  sourceLabel,
} from '../routing.js';
import {
  ApiKeyError,
  AtlasNotAvailableError,
  NetworkError,
  RateLimitError,
  ValidationError,
} from '../types.js';

const snv = { chromosome: 'chr19', ref: 'T', alt: 'C' };
const deletion = { chromosome: 'chr17', ref: 'AG', alt: 'A' };
const insertion = { chromosome: 'chr17', ref: 'A', alt: 'AGG' };
const mnv = { chromosome: 'chr1', ref: 'AT', alt: 'GC' };

test('auto sends a single-nucleotide substitution to the Atlas', () => {
  assert.equal(decideSource('auto', snv).source, 'atlas');
  assert.equal(decideSource('auto', { chromosome: 'chrX', ref: 'a', alt: 'g' }).source, 'atlas');
});

test('auto sends indels and multi-nucleotide variants to live inference', () => {
  assert.equal(decideSource('auto', deletion).source, 'live');
  assert.equal(decideSource('auto', insertion).source, 'live');
  assert.equal(decideSource('auto', mnv).source, 'live');
});

test('the reason names the kind of variant', () => {
  assert.match(decideSource('auto', deletion).reason, /deletion/);
  assert.match(decideSource('auto', insertion).reason, /insertion/);
  assert.match(decideSource('auto', mnv).reason, /multi-nucleotide/);
});

test('a chromosome outside the human reference is not Atlas-eligible', () => {
  assert.equal(atlasEligibility({ chromosome: 'chrM', ref: 'A', alt: 'G' }).eligible, false);
  assert.equal(atlasEligibility({ chromosome: '19', ref: 'A', alt: 'G' }).eligible, false);
});

test('live is always live', () => {
  assert.equal(decideSource('live', snv).source, 'live');
  assert.equal(decideSource('live', deletion).source, 'live');
});

test('atlas answers an SNV and refuses everything else', () => {
  assert.equal(decideSource('atlas', snv).source, 'atlas');
  assert.throws(() => decideSource('atlas', deletion), ValidationError);
  assert.throws(() => decideSource('atlas', mnv), /source=atlas cannot answer/);
});

test('only "not available" in auto mode falls back to live', () => {
  const missing = new AtlasNotAvailableError('variant not found');
  assert.equal(shouldFallBackToLive('auto', missing), true);
  assert.equal(shouldFallBackToLive('atlas', missing), false);
  assert.equal(shouldFallBackToLive('live', missing), false);
});

test('auth, rate limit, network and timeout failures never fall back', () => {
  assert.equal(shouldFallBackToLive('auto', new ApiKeyError('bad key')), false);
  assert.equal(shouldFallBackToLive('auto', new RateLimitError('slow down')), false);
  assert.equal(shouldFallBackToLive('auto', new NetworkError('timed out')), false);
  assert.equal(shouldFallBackToLive('auto', new Error('anything else')), false);
});

test('the source label states a fallback and its reason', () => {
  assert.equal(sourceLabel('atlas'), 'atlas');
  assert.equal(sourceLabel('live'), 'live');
  assert.equal(
    sourceLabel('live', 'variant not found'),
    'live (atlas fallback: variant not found)'
  );
  assert.equal(sourceLabel('atlas', 'ignored'), 'atlas');
});

test('a reference-base mismatch gets a hint, other reasons do not', () => {
  assert.match(fallbackHint('reference base does not match') ?? '', /hg38/);
  assert.equal(fallbackHint('outside coverage'), undefined);
});

test('a batch is split by source and keeps the original positions', () => {
  const { atlas, live } = partitionBySource('auto', [snv, deletion, snv, mnv]);
  assert.deepEqual(
    atlas.map((e) => e.index),
    [0, 2]
  );
  assert.deepEqual(
    live.map((e) => e.index),
    [1, 3]
  );
});

test('a batch with source=atlas rejects a non-SNV instead of splitting', () => {
  assert.throws(() => partitionBySource('atlas', [snv, deletion]), ValidationError);
});
