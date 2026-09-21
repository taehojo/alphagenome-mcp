// src/tests/variant-tools.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as tools from '../variant-tools.js';
import { MAX_RESPONSE_CHARS } from '../utils/formatting.js';
import {
  ApiKeyError,
  AtlasNotAvailableError,
  NetworkError,
  RateLimitError,
  ValidationError,
} from '../types.js';
import {
  deletion,
  fakeBackend,
  FORBIDDEN,
  snv,
  withoutNoteFields,
  withoutNotes,
} from './fixtures.js';

const notHeld = new AtlasNotAvailableError('Variant not found (position unresolved)');

// ---------------------------------------------------------------- routing, one variant

test('auto answers an SNV from the Atlas without running the model', async () => {
  const { backend, sources } = fakeBackend();
  const text = await tools.predictVariantEffect(backend, snv);
  assert.deepEqual(sources(), ['atlas:1']);
  assert.match(text, /\*\*Source\*\*: atlas\n/);
});

test('auto answers a deletion with live inference and says why', async () => {
  const { backend, sources } = fakeBackend();
  const text = await tools.predictVariantEffect(backend, deletion);
  assert.deepEqual(sources(), ['live:1']);
  assert.match(text, /\*\*Source\*\*: live\n/);
  assert.match(text, /Live inference because: deletion/);
});

test('source=live runs the model even for an SNV', async () => {
  const { backend, sources } = fakeBackend();
  await tools.predictVariantEffect(backend, { ...snv, source: 'live' });
  assert.deepEqual(sources(), ['live:1']);
});

test('the same SNV from both sources has the same layout', async () => {
  const atlas = await tools.predictVariantEffect(fakeBackend().backend, {
    ...snv,
    source: 'atlas',
    scorers: ['DNASE'],
  });
  const live = await tools.predictVariantEffect(fakeBackend().backend, {
    ...snv,
    source: 'live',
    scorers: ['DNASE'],
  });
  assert.match(atlas, /\| 2\.778 \|/);
  assert.match(live, /\| 2\.846 \|/);
  const shape = (text: string) => text.replace(/atlas|live/g, 'X').replace(/[\d.]+/g, 'N');
  assert.equal(shape(atlas), shape(live));
});

test('auto falls back to live when the Atlas does not hold the variant, and labels it', async () => {
  const { backend, sources } = fakeBackend({ atlasError: notHeld });
  const text = await tools.predictVariantEffect(backend, snv);
  assert.deepEqual(sources(), ['live:1']);
  assert.match(text, /\*\*Source\*\*: live \(atlas fallback: Variant not found/);
});

test('source=atlas never falls back', async () => {
  const { backend, calls } = fakeBackend({ atlasError: notHeld });
  await assert.rejects(
    tools.predictVariantEffect(backend, { ...snv, source: 'atlas' }),
    AtlasNotAvailableError
  );
  assert.equal(calls.length, 0);
});

test('source=atlas rejects a deletion before any call', async () => {
  const { backend, calls } = fakeBackend();
  await assert.rejects(
    tools.predictVariantEffect(backend, { ...deletion, source: 'atlas' }),
    ValidationError
  );
  assert.equal(calls.length, 0);
});

test('auth, rate limit, network and validation failures are never hidden by a fallback', async () => {
  const failures = [
    new ApiKeyError('bad key'),
    new RateLimitError('quota'),
    new NetworkError('timed out'),
    new ValidationError('reference base does not match the expected reference base: T.'),
  ];
  for (const failure of failures) {
    const { backend, calls } = fakeBackend({ atlasError: failure });
    await assert.rejects(
      tools.predictVariantEffect(backend, snv),
      failure.constructor as ErrorConstructor
    );
    assert.equal(calls.length, 0);
  }
});

test('output_types choose the scorers, on both sources', async () => {
  const { backend, calls } = fakeBackend();
  await tools.predictVariantEffect(backend, { ...snv, output_types: ['dnase', 'splice'] });
  assert.deepEqual(calls[0].options.scorers, [
    'DNASE',
    'SPLICE_SITES',
    'SPLICE_SITE_USAGE',
    'SPLICE_JUNCTIONS',
  ]);
});

test('a tissue is passed on as a filter', async () => {
  const { backend, calls } = fakeBackend();
  await tools.predictVariantEffect(backend, { ...deletion, tissue_type: 'brain' });
  assert.deepEqual(calls[0].options.tissues, ['brain']);
});

test('AVI scorers are left out of a live call, and the result says so', async () => {
  const { backend, calls } = fakeBackend();
  const text = await tools.predictVariantEffect(backend, {
    ...deletion,
    scorers: ['AVI_SCORE', 'DNASE'],
  });
  assert.deepEqual(calls[0].options.scorers, ['DNASE']);
  assert.match(text, /AVI scorers are served by the Atlas only/);
  assert.deepEqual(tools.scorersForLive(['AVI_SCORE']).scorers, undefined);
  assert.deepEqual(tools.scorersForLive(['DNASE']), { scorers: ['DNASE'] });
});

// ---------------------------------------------------------------- the four redefined tools

test('assess_pathogenicity reports the AVI score and effect sizes, and never a class', async () => {
  const { backend } = fakeBackend();
  const result = await tools.assessPathogenicity(backend, snv);
  assert.equal(result.source, 'atlas');
  assert.deepEqual(result.avi_score, { score: 1.039, quantile: 0.9965 });
  assert.equal(result.classification, null);
  assert.equal(result.largest_abs_quantile, 0.9999997);
  assert.equal((result.strongest_effects as unknown[]).length, 6);
  assert.doesNotMatch(withoutNoteFields(result), FORBIDDEN);
  assert.match(String(result.note), /Not a clinical classification/);
});

test('assess_pathogenicity on the live path has no AVI score and still no class', async () => {
  const { backend, sources } = fakeBackend();
  const result = await tools.assessPathogenicity(backend, deletion);
  assert.deepEqual(sources(), ['live:1']);
  assert.equal(result.source, 'live');
  assert.equal(result.avi_score, null);
  assert.equal(result.classification, null);
  assert.doesNotMatch(withoutNoteFields(result), FORBIDDEN);
});

test('batch_pathogenicity_filter keeps variants by quantile, per source', async () => {
  const { backend, sources } = fakeBackend();
  const variants = [snv, { ...snv, position: snv.position + 1 }, deletion];
  const parsed = JSON.parse(
    await tools.batchPathogenicityFilter(backend, { variants, threshold: 0.995 })
  );
  assert.deepEqual(sources(), ['atlas:2', 'live:1']);
  assert.equal(parsed.source, 'mixed');
  // Fixture quantiles are 0.9999, 0.9899, ...: one of the two Atlas variants passes.
  assert.equal(parsed.groups[0].passed_count, 1);
  assert.equal(parsed.groups[0].of, 2);
  assert.equal(parsed.groups[1].passed_count, 1);
  assert.match(parsed.threshold_meaning, /absolute quantile/);
  assert.doesNotMatch(withoutNoteFields(parsed), FORBIDDEN);
});

test('the filter defaults to a quantile of 0.99', async () => {
  const parsed = JSON.parse(
    await tools.batchPathogenicityFilter(fakeBackend().backend, { variants: [snv] })
  );
  assert.equal(parsed.threshold, 0.99);
});

test('generate_variant_report adds the AVI attributions from the Atlas and no verdict', async () => {
  const { backend, calls } = fakeBackend();
  const text = await tools.generateVariantReport(backend, snv);
  assert.deepEqual(calls[0].options.scorers?.slice(0, 2), [
    'AVI_SCORE',
    'AVI_SCORE_FEATURE_IMPORTANCE',
  ]);
  assert.match(text, /# AlphaGenome: Variant Report/);
  assert.match(text, /\*\*Generated\*\*: \d{4}-\d{2}-\d{2}T/);
  assert.match(text, /## AVI_SCORE_FEATURE_IMPORTANCE/);
  assert.match(text, /no pathogenicity classification in this report/);
  assert.doesNotMatch(withoutNotes(text), FORBIDDEN);
});

test('generate_variant_report on the live path uses the live scorers', async () => {
  const { backend, calls } = fakeBackend();
  const text = await tools.generateVariantReport(backend, deletion);
  assert.equal(calls[0].options.scorers, undefined);
  assert.match(text, /\*\*Source\*\*: live/);
  assert.doesNotMatch(text, /AVI_SCORE/);
});

test('explain_variant_impact restates the numbers in sentences', async () => {
  const result = await tools.explainVariantImpact(fakeBackend().backend, snv);
  const summary = result.summary as string[];
  assert.match(summary[0], /AVI\) score: 1\.039 \(quantile 0\.9965\)/);
  assert.match(summary[1], /Largest contributions to the AVI score: MAX_ABS_DNASE \(0\.29\)/);
  // Ordered by absolute quantile: RNA_SEQ (0.9999997) comes first.
  assert.match(summary[2], /^RNA_SEQ: largest predicted effect in ABI3, HeLa-S3/);
  assert.match(summary[2], /negative: predicted lower with the alternate allele/);
  assert.doesNotMatch(withoutNoteFields(result), FORBIDDEN);
});

// ---------------------------------------------------------------- routing, many variants

test('a batch is routed per variant and reported as two separately ranked groups', async () => {
  const { backend, calls, sources } = fakeBackend();
  const text = await tools.batchScoreVariants(backend, {
    variants: [snv, deletion, { ...snv, position: snv.position + 5 }],
    scoring_metric: 'combined',
  });
  assert.deepEqual(sources(), ['atlas:2', 'live:1']);
  assert.deepEqual(calls[0].options.scorers, ['AVI_SCORE']);
  assert.equal(calls[1].options.scorers, undefined);
  assert.match(text, /\*\*Source\*\*: mixed/);
  assert.match(text, /atlas 2, live 1\n/);
  assert.match(text, /must not be compared/);
  assert.match(text, /## From the Atlas/);
  assert.match(text, /## From live inference/);
  assert.doesNotMatch(withoutNotes(text), FORBIDDEN);
});

test('a batch counts the variants that fell back to live', async () => {
  const { backend, sources } = fakeBackend({ atlasMissing: [1] });
  const text = await tools.batchScoreVariants(backend, {
    variants: [snv, { ...snv, position: snv.position + 5 }],
    scoring_metric: 'combined',
  });
  assert.deepEqual(sources(), ['atlas:2', 'live:1']);
  assert.match(text, /atlas 1, live 1 \(1 after atlas fallback\)/);
  assert.match(text, /live \(atlas fallback: 1 variant\(s\) not in the Atlas\)/);
});

test('a batch with source=atlas does not send missing variants to live', async () => {
  const { backend, sources } = fakeBackend({ atlasMissing: [1] });
  const text = await tools.batchScoreVariants(backend, {
    variants: [snv, { ...snv, position: snv.position + 5 }],
    scoring_metric: 'combined',
    source: 'atlas',
  });
  assert.deepEqual(sources(), ['atlas:2']);
  assert.match(text, /\*\*Source\*\*: atlas/);
  assert.match(text, /Not in the Atlas \(1\)/);
});

test('a scoring metric names the same scorer on both sources when there is one', () => {
  assert.deepEqual(tools.scorersForMetric('rna_seq', 'atlas'), ['RNA_SEQ']);
  assert.deepEqual(tools.scorersForMetric('rna_seq', 'live'), ['RNA_SEQ']);
  assert.deepEqual(tools.scorersForMetric('splice', 'live'), ['SPLICE_SITES']);
  assert.deepEqual(tools.scorersForMetric('combined', 'atlas'), ['AVI_SCORE']);
  assert.equal(tools.scorersForMetric('combined', 'live'), undefined);
});

// ---------------------------------------------------------------- live-inference tools

test('the modality tools ask live inference for their own scorers', async () => {
  const cases: Array<[typeof tools.predictSpliceImpact, string[]]> = [
    [tools.predictSpliceImpact, ['SPLICE_SITES', 'SPLICE_SITE_USAGE', 'SPLICE_JUNCTIONS']],
    [tools.predictExpressionImpact, ['RNA_SEQ', 'CAGE']],
    [tools.predictTfBindingImpact, ['CHIP_TF']],
    [tools.predictChromatinImpact, ['ATAC', 'DNASE']],
    [tools.predictAlleleSpecificEffects, ['RNA_SEQ', 'RNA_SEQ_ACTIVE']],
  ];
  for (const [tool, scorers] of cases) {
    const { backend, calls } = fakeBackend();
    const result = await tool(backend, snv);
    assert.equal(calls[0].source, 'live');
    assert.deepEqual(calls[0].options.scorers, scorers);
    assert.equal(result.source, 'live');
    assert.doesNotMatch(withoutNoteFields(result), FORBIDDEN);
  }
});

test('predict_tissue_specific scores the variant once per tissue', async () => {
  const { backend, calls } = fakeBackend();
  const result = await tools.predictTissueSpecific(backend, {
    ...snv,
    tissues: ['brain', 'liver'],
  });
  assert.deepEqual(
    calls.map((call) => call.options.tissues),
    [['brain'], ['liver']]
  );
  assert.deepEqual(Object.keys(result.tissues as object), ['brain', 'liver']);
  assert.equal(result.source, 'live');
});

test('compare_variants puts two variants side by side without calling one worse', async () => {
  const result = await tools.compareVariants(fakeBackend().backend, {
    variant1: snv,
    variant2: deletion,
  });
  const variants = result.variants as Array<{ label: string }>;
  assert.deepEqual(
    variants.map((entry) => entry.label),
    ['variant1', 'variant2']
  );
  assert.ok('larger_abs_quantile_by_scorer' in result);
  assert.doesNotMatch(withoutNoteFields(result), FORBIDDEN);
});

test("compare_protective_risk keeps the caller's labels and judges nothing", async () => {
  const result = await tools.compareProtectiveRisk(fakeBackend().backend, {
    protective_variant: snv,
    risk_variant: deletion,
  });
  assert.match(String(result.note), /not of severity or risk/);
  assert.doesNotMatch(JSON.stringify(result.variants), /more_severe|impact/);
});

test('compare_alleles ranks the alternate alleles of one position', async () => {
  const { backend, calls } = fakeBackend();
  const parsed = JSON.parse(
    await tools.compareAlleles(backend, {
      chromosome: 'chr17',
      position: 49210289,
      ref: 'C',
      alts: ['T', 'G', 'CA'],
    })
  );
  assert.deepEqual(
    calls[0].variants.map((variant) => variant.alt),
    ['T', 'G', 'CA']
  );
  assert.equal(parsed.ranked[0].variant_id, 'C>T');
  assert.equal(parsed.source, 'live');
});

test('compare_variants_same_gene restricts the gene-level scorers to the gene', async () => {
  const { backend, calls } = fakeBackend();
  await tools.compareVariantsSameGene(backend, { variants: [snv, deletion], gene_name: 'ABI3' });
  assert.deepEqual(calls[0].options.genes, ['ABI3']);
  assert.deepEqual(calls[0].options.scorers, ['RNA_SEQ', 'SPLICE_SITES']);
});

test('batch_modality_screen and batch_tissue_comparison', async () => {
  const screen = fakeBackend();
  await tools.batchModalityScreen(screen.backend, { variants: [snv], modality: 'chromatin' });
  assert.deepEqual(screen.calls[0].options.scorers, ['DNASE', 'ATAC']);

  const tissues = fakeBackend();
  const parsed = JSON.parse(
    await tools.batchTissueComparison(tissues.backend, {
      variants: [snv, deletion],
      tissues: ['brain', 'heart'],
    })
  );
  assert.deepEqual(Object.keys(parsed.tissues), ['brain', 'heart']);
  assert.equal(tissues.calls.length, 2);
});

test('a JSON result is shortened, not cut, to stay under the size cap', () => {
  const ranked = Array.from({ length: 400 }, (_, i) => ({ rank: i, text: 'x'.repeat(300) }));
  const text = tools.jsonCapped({ ranked });
  assert.ok(text.length <= MAX_RESPONSE_CHARS, `length ${text.length}`);
  const parsed = JSON.parse(text);
  assert.ok(parsed.ranked.length < 400);
  assert.match(parsed.truncated, /Lists shortened/);
});
