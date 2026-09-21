// src/tests/tools.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ALL_TOOLS } from '../tools.js';

const byName = new Map(ALL_TOOLS.map((tool) => [tool.name, tool]));
const properties = (name: string) =>
  Object.keys((byName.get(name)!.inputSchema.properties ?? {}) as object);

test('24 tools with unique names', () => {
  assert.equal(ALL_TOOLS.length, 24);
  assert.equal(byName.size, 24);
});

test('every tool that returns predictions says they are not clinical classifications', () => {
  for (const tool of ALL_TOOLS) {
    if (tool.name === 'atlas_list_scorers') continue;
    assert.match(tool.description ?? '', /not clinical classifications/, tool.name);
  }
});

test('the tools that kept a pathogenicity name say that they do not classify', () => {
  assert.match(byName.get('assess_pathogenicity')!.description!, /does NOT classify/);
  assert.match(byName.get('batch_pathogenicity_filter')!.description!, /NOT on pathogenicity/);
  assert.match(byName.get('generate_variant_report')!.description!, /not a clinical report/);
  assert.match(
    byName.get('explain_variant_impact')!.description!,
    /no statement about pathogenicity/
  );
});

test('no description promises a classification, a risk label or a clinical use', () => {
  for (const tool of ALL_TOOLS) {
    assert.doesNotMatch(
      tool.description ?? '',
      /likely_pathogenic|clinical interpretation|diagnostic|clinical scoring|pathogenicity score/i,
      tool.name
    );
  }
});

test('the routed tools take source and scorers', () => {
  for (const name of [
    'predict_variant_effect',
    'batch_score_variants',
    'assess_pathogenicity',
    'batch_pathogenicity_filter',
    'generate_variant_report',
    'explain_variant_impact',
  ]) {
    assert.ok(properties(name).includes('source'), name);
    assert.ok(properties(name).includes('scorers'), name);
  }
});

test('the scan tool documents its limits and the opt-in', () => {
  const scan = byName.get('atlas_scan_region')!;
  assert.ok(properties('atlas_scan_region').includes('allow_large_region'));
  assert.match(scan.description!, /at most 10,000 bp/);
  assert.match(scan.description!, /allow_large_region=true/);
  assert.match(scan.description!, /Incomplete/);
});

test('the AVI scorers are presented as outputs of the Atlas', () => {
  assert.match(byName.get('atlas_list_scorers')!.description!, /AVI_SCORE_FEATURE_IMPORTANCE/);
  assert.match(byName.get('atlas_lookup_variants')!.description!, /AVI_SCORE/);
});
