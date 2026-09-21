// src/tests/fixtures.ts

import type { ScoringBackend } from '../variant-tools.js';
import type { ResolvedSource } from '../routing.js';
import type {
  RankedVariants,
  ScoreOptions,
  ScorerSummary,
  VariantQuery,
  VariantScores,
} from '../types.js';

/**
 * A stand-in for the client. It answers in the shape the real bridge returns
 * for both sources, and records every call so a test can check which source
 * was asked, for which variants, with which options.
 */

export const snv: VariantQuery = { chromosome: 'chr17', position: 49210289, ref: 'C', alt: 'T' };
export const deletion: VariantQuery = {
  chromosome: 'chr17',
  position: 49210289,
  ref: 'CCC',
  alt: 'C',
};

export function label(variant: VariantQuery): string {
  return `${variant.chromosome}:${variant.position}:${variant.ref}>${variant.alt}`;
}

/** Numbers from the real API for chr17:49210289 C>T (Atlas 2.778, live 2.846 for DNASE). */
function summary(scorer: string, source: ResolvedSource): ScorerSummary {
  if (scorer === 'AVI_SCORE') {
    return {
      scorer,
      available: true,
      is_signed: false,
      rows: 1,
      tracks: 1,
      max_abs_score: 1.039,
      median_abs_score: 1.039,
      top: [{ score: 1.039, quantile: 0.9965, track: { name: 'AVI_SCORE' } }],
    };
  }
  if (scorer === 'AVI_SCORE_FEATURE_IMPORTANCE') {
    return {
      scorer,
      available: true,
      is_signed: false,
      rows: 1,
      tracks: 18,
      max_abs_score: 0.29,
      median_abs_score: 0.01,
      top: [
        { score: 0.29, track: { name: 'MAX_ABS_DNASE' } },
        { score: 0.12, track: { name: 'MAX_ABS_CAGE' } },
      ],
    };
  }
  const score = source === 'atlas' ? 2.778 : 2.846;
  return {
    scorer,
    available: true,
    is_signed: true,
    rows: scorer === 'RNA_SEQ' ? 61 : 1,
    tracks: 305,
    max_abs_score: score,
    median_abs_score: 0.2351,
    top: [
      {
        score: scorer === 'RNA_SEQ' ? -0.8843 : score,
        quantile: scorer === 'RNA_SEQ' ? -0.9999997 : 0.9999024,
        ...(scorer === 'RNA_SEQ' ? { gene_name: 'ABI3', gene_id: 'ENSG00000108798.9' } : {}),
        track: { biosample_name: 'HeLa-S3', 'Assay title': `${scorer} assay` },
      },
    ],
  };
}

const ATLAS_DEFAULTS = [
  'AVI_SCORE',
  'RNA_SEQ',
  'CAGE',
  'DNASE',
  'CHIP_HISTONE',
  'CHIP_TF',
  'SPLICE_SITES',
];
const LIVE_DEFAULTS = ['RNA_SEQ', 'CAGE', 'DNASE', 'CHIP_HISTONE', 'CHIP_TF', 'SPLICE_SITES'];

export function variantScores(
  source: ResolvedSource,
  variant: VariantQuery,
  options: ScoreOptions = {}
): VariantScores {
  const scorers = options.scorers ?? (source === 'atlas' ? ATLAS_DEFAULTS : LIVE_DEFAULTS);
  return {
    source,
    variant: label(variant),
    scorers,
    rows_per_scorer: 1,
    response_cap: 'top 1 cells per scorer',
    results: scorers.map((scorer) => summary(scorer, source)),
    ...(options.tissues ? { tissue_filter: options.tissues } : {}),
    ...(options.genes ? { gene_filter: options.genes } : {}),
  };
}

export function rankedVariants(
  source: ResolvedSource,
  variants: VariantQuery[],
  options: ScoreOptions = {},
  missing: number[] = []
): RankedVariants {
  const scorers = options.scorers ?? (source === 'atlas' ? ['AVI_SCORE'] : LIVE_DEFAULTS);
  const found = variants.filter((_, index) => !missing.includes(index));
  return {
    source,
    scorers,
    ranked_by: scorers.length === 1 ? `absolute ${scorers[0]} score` : 'largest absolute quantile',
    requested: variants.length,
    found: found.length,
    not_in_atlas: missing.map((index) => ({
      index,
      variant: label(variants[index]),
      reason: 'Variant not found (position unresolved)',
    })),
    invalid: [],
    complete: true,
    response_cap: `top ${options.top_n ?? 25}`,
    ranked: found.map((variant, i) => ({
      rank: i + 1,
      variant: label(variant),
      ...(variant.variant_id ? { variant_id: variant.variant_id } : {}),
      scores: Object.fromEntries(
        scorers.map((scorer) => [
          scorer,
          // Descending quantiles: 0.9999, 0.9899, 0.9799, ...
          { ...summary(scorer, source).top![0], quantile: 0.9999 - i * 0.01 },
        ])
      ),
    })),
    ...(options.tissues ? { tissue_filter: options.tissues } : {}),
    ...(options.genes ? { gene_filter: options.genes } : {}),
  };
}

export interface Call {
  kind: 'one' | 'many';
  source: ResolvedSource;
  variants: VariantQuery[];
  options: ScoreOptions;
}

export function fakeBackend(
  overrides: {
    /** Thrown by every Atlas call. */
    atlasError?: Error;
    /** Indexes the Atlas batch reports as not held. */
    atlasMissing?: number[];
  } = {}
) {
  const calls: Call[] = [];
  const backend: ScoringBackend = {
    async scoreVariant(source, variant, options = {}) {
      if (source === 'atlas' && overrides.atlasError) throw overrides.atlasError;
      calls.push({ kind: 'one', source, variants: [variant], options });
      return variantScores(source, variant, options);
    },
    async scoreVariants(source, variants, options = {}) {
      if (source === 'atlas' && overrides.atlasError) throw overrides.atlasError;
      calls.push({ kind: 'many', source, variants, options });
      return rankedVariants(
        source,
        variants,
        options,
        source === 'atlas' ? (overrides.atlasMissing ?? []) : []
      );
    },
  };
  return {
    backend,
    calls,
    sources: () => calls.map((call) => `${call.source}:${call.variants.length}`),
  };
}

/**
 * Words that must never appear in the data part of a result: no classification,
 * risk label or percent change. The explanatory notes, which say that no
 * classification is given, are removed before this is applied.
 */
export const FORBIDDEN =
  /likely_|pathogenic|benign|high risk|impact_level|confidence|\d\s?%|fold.?change|clinical_significance|severe/i;

/** The data part of a Markdown result. */
export function withoutNotes(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\*\*(What this is|Note)\*\*|^\*AlphaGenome model predictions/.test(line))
    .join('\n');
}

/** The data part of a JSON result. */
export function withoutNoteFields(value: Record<string, unknown>): string {
  const data = { ...value };
  for (const key of ['note', 'threshold_meaning', 'source_note']) delete data[key];
  return JSON.stringify(data);
}
