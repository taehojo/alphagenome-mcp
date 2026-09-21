// src/routed-tools.ts

import {
  AtlasBatchResult,
  AtlasVariantQuery,
  AtlasVariantResult,
  BatchResult,
  BatchScoreParams,
  VariantPredictionParams,
  VariantResult,
} from './types.js';
import {
  decideSource,
  fallbackHint,
  partitionBySource,
  shouldFallBackToLive,
  sourceLabel,
  SourceMode,
} from './routing.js';
import { formatBatchResult, formatSourceLine, formatVariantResult } from './utils/formatting.js';
import { capResponse, formatAtlasBatch, formatAtlasVariant } from './utils/atlas-formatting.js';

/**
 * The three tools that choose between the Atlas and live inference.
 *
 * They depend on this narrow interface rather than on the client class, so the
 * routing, the fallback and the labelling can be tested with a fake backend
 * and no API key.
 */
export interface VariantBackend {
  atlasLookupVariant(
    params: AtlasVariantQuery & { scorers?: string[]; top_n?: number }
  ): Promise<AtlasVariantResult>;
  atlasLookupVariants(params: {
    variants: AtlasVariantQuery[];
    scorers?: string[];
    top_n?: number;
  }): Promise<AtlasBatchResult>;
  predictVariant(params: VariantPredictionParams): Promise<VariantResult>;
  assessPathogenicity(params: VariantPredictionParams): Promise<Record<string, unknown>>;
  batchScore(params: BatchScoreParams): Promise<BatchResult>;
}

// `source` is optional here as it is in the tool schema; absent means auto.
type RoutedVariantParams = VariantPredictionParams;
type RoutedBatchParams = BatchScoreParams;

function modeOf(params: { source?: SourceMode }): SourceMode {
  return params.source ?? 'auto';
}

function query(params: VariantPredictionParams): AtlasVariantQuery {
  return {
    chromosome: params.chromosome,
    position: params.position,
    ref: params.ref,
    alt: params.alt,
  };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Atlas scorers that stand in for a live scoring metric when none are named. */
export function scorersForMetric(metric: BatchScoreParams['scoring_metric']): string[] {
  switch (metric) {
    case 'rna_seq':
      return ['RNA_SEQ'];
    case 'splice':
      return ['SPLICE_SITES'];
    default:
      return ['AVI_SCORE'];
  }
}

/**
 * predict_variant_effect: the Atlas for an SNV, live inference otherwise.
 */
export async function predictVariantRouted(
  backend: VariantBackend,
  params: RoutedVariantParams
): Promise<string> {
  const mode = modeOf(params);
  const decision = decideSource(mode, params);

  if (decision.source === 'atlas') {
    try {
      const result = await backend.atlasLookupVariant({
        ...query(params),
        scorers: params.scorers,
      });
      return formatAtlasVariant(result);
    } catch (error) {
      if (!shouldFallBackToLive(mode, error)) {
        throw error;
      }
      const reason = reasonOf(error);
      const live = await backend.predictVariant(params);
      return formatVariantResult({
        ...live,
        source: sourceLabel('live', reason),
        source_hint: fallbackHint(reason),
      });
    }
  }

  const live = await backend.predictVariant(params);
  const note = mode === 'auto' ? `Live inference because: ${decision.reason}.` : undefined;
  return formatVariantResult({ ...live, source: sourceLabel('live'), source_hint: note });
}

/**
 * assess_pathogenicity: from the Atlas this is the AVI score and the strongest
 * effects. The Atlas does not classify variants, so no class is made up.
 */
export async function assessPathogenicityRouted(
  backend: VariantBackend,
  params: RoutedVariantParams
): Promise<Record<string, unknown>> {
  const mode = modeOf(params);
  const decision = decideSource(mode, params);

  if (decision.source === 'atlas') {
    try {
      const result = await backend.atlasLookupVariant({
        ...query(params),
        scorers: params.scorers,
        top_n: 7,
      });
      const avi = result.results.find((entry) => entry.scorer === 'AVI_SCORE');
      return {
        source: sourceLabel('atlas'),
        variant: result.variant,
        avi_score: avi?.top?.[0]
          ? { score: avi.top[0].score, quantile: avi.top[0].quantile ?? null }
          : null,
        strongest_effects: result.results
          .filter((entry) => entry.scorer !== 'AVI_SCORE' && entry.available)
          .map((entry) => ({ scorer: entry.scorer, ...(entry.top?.[0] ?? {}) })),
        classification: null,
        note:
          'The Atlas stores scores, not a pathogenic/benign call, so none is given. ' +
          'AVI_SCORE is the AlphaGenome Variant Impact score; quantile is the calibrated value the Atlas stores with it. ' +
          'Research use only.',
      };
    } catch (error) {
      if (!shouldFallBackToLive(mode, error)) {
        throw error;
      }
      const reason = reasonOf(error);
      const live = await backend.assessPathogenicity(params);
      return {
        source: sourceLabel('live', reason),
        source_hint: fallbackHint(reason),
        ...live,
      };
    }
  }

  const live = await backend.assessPathogenicity(params);
  return { source: sourceLabel('live'), ...live };
}

/**
 * batch_score_variants: each variant is routed on its own.
 *
 * Atlas scores and live scores are different quantities, so a mixed batch is
 * reported as two separately ranked groups, never as one merged ranking.
 */
export async function batchScoreRouted(
  backend: VariantBackend,
  params: RoutedBatchParams
): Promise<string> {
  const mode = modeOf(params);
  const { atlas, live } = partitionBySource(mode, params.variants);
  const liveVariants = live.map((entry) => entry.variant);

  let atlasResult: AtlasBatchResult | undefined;
  let fallbackCount = 0;

  if (atlas.length > 0) {
    atlasResult = await backend.atlasLookupVariants({
      variants: atlas.map((entry) => entry.variant),
      scorers: params.scorers ?? scorersForMetric(params.scoring_metric),
      top_n: params.top_n,
    });
    if (mode === 'auto') {
      // Only "not in the Atlas" is retried live. A variant the Atlas rejected
      // (wrong reference base, out of range) stays rejected.
      for (const missing of atlasResult.not_in_atlas) {
        liveVariants.push(atlas[missing.index].variant);
        fallbackCount += 1;
      }
    }
  }

  let liveResult: BatchResult | undefined;
  if (liveVariants.length > 0) {
    liveResult = await backend.batchScore({ ...params, variants: liveVariants });
  }

  const atlasCount = atlasResult?.found ?? 0;
  const liveCount = liveVariants.length;
  const overall = atlasCount > 0 && liveCount > 0 ? 'mixed' : liveCount > 0 ? 'live' : 'atlas';

  let output = `# AlphaGenome Batch Variant Analysis\n\n`;
  output += formatSourceLine(overall);
  output += `**Answered from**: atlas ${atlasCount}, live ${liveCount}`;
  output += fallbackCount > 0 ? ` (${fallbackCount} after atlas fallback)\n` : `\n`;
  if (overall === 'mixed') {
    output += `**Note**: Atlas scores and live scores are different quantities. The two groups below are ranked separately and must not be compared with each other.\n`;
  }
  output += `\n---\n\n`;
  if (atlasResult) {
    output += formatAtlasBatch(atlasResult) + `\n`;
  }
  if (liveResult) {
    output += formatBatchResult({
      ...liveResult,
      source: sourceLabel(
        'live',
        fallbackCount > 0 ? `${fallbackCount} variant(s) not in the Atlas` : undefined
      ),
      source_counts: { atlas: atlasCount, live: liveCount, atlas_fallback: fallbackCount },
    });
  }
  return capResponse(output);
}
