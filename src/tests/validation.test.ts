// src/tests/validation.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ATLAS_DEFAULT_TOP_N,
  ATLAS_MAX_REGION_BP,
  ATLAS_MAX_VARIANTS,
  atlasLookupVariantSchema,
  atlasLookupVariantsSchema,
  atlasScanRegionSchema,
  batchScoreSchema,
  validateInput,
  variantPredictionSchema,
} from '../utils/validation.js';

const apoe = { chromosome: 'chr19', position: 44908684, ref: 'T', alt: 'C' };

test('a variant without source defaults to auto', () => {
  const parsed = validateInput(variantPredictionSchema, apoe);
  assert.equal(parsed.source, 'auto');
  assert.equal(parsed.scorers, undefined);
});

test('alleles are upper-cased', () => {
  const parsed = validateInput(variantPredictionSchema, { ...apoe, ref: 't', alt: 'c' });
  assert.equal(parsed.ref, 'T');
  assert.equal(parsed.alt, 'C');
});

test('an unknown source is rejected', () => {
  assert.throws(
    () => validateInput(variantPredictionSchema, { ...apoe, source: 'cache' }),
    /Validation error/
  );
});

test('an invalid position is rejected', () => {
  for (const position of [0, -1, 1.5, '44908684']) {
    assert.throws(
      () => validateInput(variantPredictionSchema, { ...apoe, position }),
      /Validation error/
    );
  }
});

test('an invalid chromosome or allele is rejected', () => {
  assert.throws(() => validateInput(variantPredictionSchema, { ...apoe, chromosome: '19' }));
  assert.throws(() => validateInput(variantPredictionSchema, { ...apoe, alt: 'N' }));
  assert.throws(() => validateInput(variantPredictionSchema, { ...apoe, alt: 'T' }), /different/);
});

test('the general variant schema still accepts an indel', () => {
  const parsed = validateInput(variantPredictionSchema, { ...apoe, ref: 'TG', alt: 'T' });
  assert.equal(parsed.ref, 'TG');
});

test('the batch schema accepts source and scorers', () => {
  const parsed = validateInput(batchScoreSchema, {
    variants: [apoe],
    scoring_metric: 'combined',
    source: 'atlas',
    scorers: ['RNA_SEQ'],
  });
  assert.equal(parsed.source, 'atlas');
  assert.deepEqual(parsed.scorers, ['RNA_SEQ']);
});

test('an empty scorers list is rejected', () => {
  assert.throws(() => validateInput(variantPredictionSchema, { ...apoe, scorers: [] }));
});

test('atlas_lookup_variant takes an SNV only', () => {
  const parsed = validateInput(atlasLookupVariantSchema, apoe);
  assert.equal(parsed.top_n, ATLAS_DEFAULT_TOP_N);
  assert.throws(
    () => validateInput(atlasLookupVariantSchema, { ...apoe, ref: 'TG', alt: 'T' }),
    /single-nucleotide/
  );
});

test('atlas_lookup_variants is capped', () => {
  const many = Array.from({ length: ATLAS_MAX_VARIANTS + 1 }, (_, i) => ({
    ...apoe,
    position: apoe.position + i,
  }));
  assert.throws(() => validateInput(atlasLookupVariantsSchema, { variants: many }), /Maximum/);
  assert.throws(() => validateInput(atlasLookupVariantsSchema, { variants: [] }), /At least one/);
  const ok = validateInput(atlasLookupVariantsSchema, { variants: many.slice(0, 3) });
  assert.equal(ok.variants.length, 3);
});

test('atlas_scan_region is capped and needs start before end', () => {
  const base = { chromosome: 'chr17', start: 49209289 };
  const ok = validateInput(atlasScanRegionSchema, { ...base, end: base.start + 2000 });
  assert.equal(ok.top_n, ATLAS_DEFAULT_TOP_N);
  assert.throws(
    () =>
      validateInput(atlasScanRegionSchema, { ...base, end: base.start + ATLAS_MAX_REGION_BP + 1 }),
    /at most/
  );
  assert.throws(
    () => validateInput(atlasScanRegionSchema, { ...base, end: base.start }),
    /greater than start/
  );
});

test('top_n cannot exceed the response cap', () => {
  assert.throws(() => validateInput(atlasLookupVariantSchema, { ...apoe, top_n: 1000 }), /top_n/);
});
