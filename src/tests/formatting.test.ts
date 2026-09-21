// src/tests/formatting.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  capResponse,
  formatRankedVariants,
  formatRegionScan,
  formatSourceLine,
  formatVariantScores,
  MAX_RESPONSE_CHARS,
  quantile,
} from '../utils/formatting.js';
import type { RegionScan } from '../types.js';
import { FORBIDDEN, rankedVariants, snv, variantScores, withoutNotes } from './fixtures.js';

test('an Atlas result and a live result go through the same formatter', () => {
  const atlas = formatVariantScores(variantScores('atlas', snv, { scorers: ['DNASE'] }));
  const live = formatVariantScores(variantScores('live', snv, { scorers: ['DNASE'] }));
  assert.match(atlas, /\*\*Source\*\*: atlas\n/);
  assert.match(live, /\*\*Source\*\*: live\n/);
  // Same layout: only the source line and the numbers differ.
  const shape = (text: string) => text.replace(/atlas|live/g, 'X').replace(/[\d.]+/g, 'N');
  assert.equal(shape(atlas), shape(live));
});

test('scores and quantiles are printed, with the gene, tissue and assay', () => {
  const text = formatVariantScores(variantScores('live', snv, { scorers: ['RNA_SEQ'] }));
  assert.match(text, /\| -0\.8843 \| -0\.9999997 \| ABI3, HeLa-S3, RNA_SEQ assay \|/);
});

test('a quantile keeps the digits that separate strong effects', () => {
  assert.equal(quantile(0.9999024), '0.9999024');
  assert.equal(quantile(-0.9999997), '-0.9999997');
  assert.equal(quantile(null), '-');
});

test('a fallback and its note are visible', () => {
  const text = formatVariantScores({
    ...variantScores('live', snv),
    source: 'live (atlas fallback: Variant not found)',
    source_note: 'Check the genome build.',
  });
  assert.match(text, /\*\*Source\*\*: live \(atlas fallback: Variant not found\)/);
  assert.match(text, /\*\*Note\*\*: Check the genome build\./);
});

test('tissue and gene filters are stated', () => {
  const text = formatVariantScores(
    variantScores('live', snv, { tissues: ['UBERON:0000955'], genes: ['ABI3'] })
  );
  assert.match(text, /\*\*Tissues\*\*: UBERON:0000955/);
  assert.match(text, /\*\*Genes\*\*: ABI3/);
});

test('a scorer emptied by the filters says so instead of showing an empty table', () => {
  const scores = variantScores('live', snv, { scorers: ['DNASE'] });
  scores.results[0].top = [];
  assert.match(formatVariantScores(scores), /No tracks left after the tissue and gene filters/);
});

test('no result carries a class, a risk label or a percent change', () => {
  for (const source of ['atlas', 'live'] as const) {
    assert.doesNotMatch(withoutNotes(formatVariantScores(variantScores(source, snv))), FORBIDDEN);
    assert.doesNotMatch(
      withoutNotes(formatRankedVariants(rankedVariants(source, [snv, snv]))),
      FORBIDDEN
    );
  }
});

test('every result says it is a research prediction, not a clinical classification', () => {
  assert.match(formatVariantScores(variantScores('live', snv)), /Not a clinical classification/);
  assert.match(
    formatRankedVariants(rankedVariants('atlas', [snv])),
    /Not a clinical classification/
  );
});

test('a ranking with one scorer shows where; with several it shows every scorer', () => {
  const one = formatRankedVariants(rankedVariants('atlas', [snv]));
  assert.match(one, /\| Rank \| Variant \| AVI_SCORE \| Quantile \| Where \|/);
  const several = formatRankedVariants(rankedVariants('live', [snv]));
  assert.match(several, /RNA_SEQ \(score \/ quantile\)/);
  assert.match(several, /SPLICE_SITES \(score \/ quantile\)/);
});

test('variants the Atlas does not hold are listed with the reason', () => {
  const text = formatRankedVariants(rankedVariants('atlas', [snv, snv], {}, [1]));
  assert.match(text, /\*\*Not in the Atlas\*\*: 1/);
  assert.match(text, /### Not in the Atlas \(1\)/);
  assert.match(text, /position unresolved/);
});

const scan: RegionScan = {
  source: 'atlas',
  region: 'chr17:49209289-49229289',
  width_bp: 20001,
  scorers: ['AVI_SCORE'],
  ranked_by: 'absolute AVI_SCORE score',
  variants_scanned: 9216,
  complete: false,
  scanned_region: 'chr17:49209289-49212360',
  stopped_because: 'time limit reached',
  ranking_value_distribution: { median: 0.15, p90: 0.7, p99: 1.4, max: 2.5 },
  response_cap: 'top 25 of 9216 substitutions',
  ranked: rankedVariants('atlas', [snv]).ranked,
};

test('an incomplete scan states the range that was really scanned', () => {
  const text = formatRegionScan(scan);
  assert.match(text, /\*\*Region requested\*\*: chr17:49209289-49229289 \(20,001 bp\)/);
  assert.match(
    text,
    /\*\*Incomplete\*\*: scanned chr17:49209289-49212360 only \(time limit reached\)\. The ranking/
  );
  assert.match(text, /covers the scanned part, not the whole request/);
});

test('a complete scan says so', () => {
  const text = formatRegionScan({
    ...scan,
    complete: true,
    scanned_region: scan.region,
    stopped_because: undefined,
  });
  assert.match(text, /\*\*Region scanned\*\*: chr17:49209289-49229289 \(complete\)/);
  assert.doesNotMatch(text, /Incomplete/);
});

test('no response can exceed the size cap', () => {
  const capped = capResponse('x'.repeat(MAX_RESPONSE_CHARS * 2));
  assert.ok(capped.length <= MAX_RESPONSE_CHARS);
  assert.match(capped, /Response truncated/);
  assert.equal(capResponse('short'), 'short');
});

test('a ranking of 100 variants stays under the cap', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ ...snv, position: snv.position + i }));
  const text = formatRankedVariants(rankedVariants('live', many, { top_n: 100 }));
  assert.ok(text.length <= MAX_RESPONSE_CHARS, `length ${text.length}`);
});

test('the source line helper', () => {
  assert.equal(formatSourceLine('atlas'), '**Source**: atlas\n');
  assert.equal(formatSourceLine('live', 'why'), '**Source**: live\n**Note**: why\n');
});
