// src/tests/validation.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ATLAS_DEFAULT_TOP_N,
  ATLAS_MAX_LARGE_REGION_BP,
  ATLAS_MAX_REGION_BP,
  ATLAS_MAX_VARIANTS,
  atlasLookupVariantSchema,
  atlasLookupVariantsSchema,
  atlasScanRegionSchema,
  batchScoreSchema,
  compareAllelesSchema,
  modalityScreenSchema,
  pathogenicityFilterSchema,
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

const scanBase = { chromosome: 'chr17', start: 49209289 };

test('atlas_scan_region accepts up to 10,000 bp by default', () => {
  const ok = validateInput(atlasScanRegionSchema, { ...scanBase, end: scanBase.start + 2000 });
  assert.equal(ok.top_n, ATLAS_DEFAULT_TOP_N);
  assert.equal(ok.allow_large_region, false);
  assert.equal(ATLAS_MAX_REGION_BP, 10000);
  validateInput(atlasScanRegionSchema, { ...scanBase, end: scanBase.start + ATLAS_MAX_REGION_BP });
});

test('a wider scan is refused unless the caller opts in, and the message says how', () => {
  const wide = { ...scanBase, end: scanBase.start + ATLAS_MAX_REGION_BP + 1 };
  assert.throws(() => validateInput(atlasScanRegionSchema, wide), /allow_large_region=true/);
  assert.throws(
    () => validateInput(atlasScanRegionSchema, { ...wide, allow_large_region: false }),
    /10,000 bp/
  );
  const allowed = validateInput(atlasScanRegionSchema, { ...wide, allow_large_region: true });
  assert.equal(allowed.allow_large_region, true);
});

test('even with the opt-in a scan stops at 50,000 bp', () => {
  const end = scanBase.start + ATLAS_MAX_LARGE_REGION_BP;
  validateInput(atlasScanRegionSchema, { ...scanBase, end, allow_large_region: true });
  assert.throws(
    () =>
      validateInput(atlasScanRegionSchema, {
        ...scanBase,
        end: end + 1,
        allow_large_region: true,
      }),
    /at most 50,000 bp/
  );
});

test('a scan needs start before end', () => {
  assert.throws(
    () => validateInput(atlasScanRegionSchema, { ...scanBase, end: scanBase.start }),
    /greater than start/
  );
});

test('the filter threshold is an absolute quantile between 0 and 1', () => {
  validateInput(pathogenicityFilterSchema, { variants: [apoe], threshold: 0.999 });
  assert.throws(() => validateInput(pathogenicityFilterSchema, { variants: [apoe], threshold: 5 }));
});

test('live tools validate their inputs too', () => {
  assert.throws(() => validateInput(modalityScreenSchema, { variants: [apoe], modality: 'x' }));
  assert.throws(
    () =>
      validateInput(compareAllelesSchema, { chromosome: 'chr1', position: 5, ref: 'A', alts: [] }),
    /At least one alternate/
  );
  const parsed = validateInput(compareAllelesSchema, {
    chromosome: 'chr1',
    position: 5,
    ref: 'a',
    alts: ['g', 'ACT'],
  });
  assert.deepEqual(parsed.alts, ['G', 'ACT']);
});

test('top_n cannot exceed the response cap', () => {
  assert.throws(() => validateInput(atlasLookupVariantSchema, { ...apoe, top_n: 1000 }), /top_n/);
});
