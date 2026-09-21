// src/variant-tools.ts

import {
  OutputType,
  RankedVariant,
  RankedVariants,
  ScoreCell,
  ScoreOptions,
  VariantQuery,
  VariantScores,
} from './types.js';
import {
  decideSource,
  fallbackHint,
  partitionBySource,
  ResolvedSource,
  shouldFallBackToLive,
  sourceLabel,
  SourceMode,
} from './routing.js';
import {
  capResponse,
  describeCell,
  formatRankedGroup,
  formatSourceLine,
  formatVariantScores,
  MAX_RESPONSE_CHARS,
  RESEARCH_NOTE,
} from './utils/formatting.js';

/**
 * The variant tools.
 *
 * Every tool is a view over two primitives, "score one variant" and "score
 * many variants and rank them", each answered by the Atlas or by live
 * inference in the same shape. The tools depend on this narrow interface
 * rather than on the client class, so routing, fallback, labelling and every
 * tool's output are tested with a fake backend and no API key.
 *
 * No tool derives a pathogenicity class, a risk label or a percent change.
 * They report scores and calibrated quantiles as returned, and rank by them.
 */
export interface ScoringBackend {
  scoreVariant(
    source: ResolvedSource,
    variant: VariantQuery,
    options?: ScoreOptions
  ): Promise<VariantScores>;
  scoreVariants(
    source: ResolvedSource,
    variants: VariantQuery[],
    options?: ScoreOptions
  ): Promise<RankedVariants>;
}

// Kept in step with DEFAULT_VARIANT_SCORERS in scripts/atlas_actions.py and
// DEFAULT_SCORERS in scripts/live_actions.py. Tools that name their own
// scorers need to know which names each source can serve.
export const ATLAS_ONLY_PREFIX = 'AVI_';
export const AVI_SCORERS = ['AVI_SCORE', 'AVI_SCORE_FEATURE_IMPORTANCE'];
export const MODALITY_SCORERS = [
  'RNA_SEQ',
  'CAGE',
  'DNASE',
  'CHIP_HISTONE',
  'CHIP_TF',
  'SPLICE_SITES',
];

const OUTPUT_TYPE_SCORERS: Record<OutputType, string[]> = {
  rna_seq: ['RNA_SEQ'],
  cage: ['CAGE'],
  splice: ['SPLICE_SITES', 'SPLICE_SITE_USAGE', 'SPLICE_JUNCTIONS'],
  histone: ['CHIP_HISTONE'],
  tf_binding: ['CHIP_TF'],
  dnase: ['DNASE'],
  atac: ['ATAC'],
  contact_map: ['CONTACT_MAPS'],
};

export const MODALITY_SCREEN_SCORERS: Record<string, string[]> = {
  expression: ['RNA_SEQ', 'CAGE'],
  splicing: ['SPLICE_SITES', 'SPLICE_SITE_USAGE'],
  tf_binding: ['CHIP_TF'],
  chromatin: ['DNASE', 'ATAC'],
};

export function scorersForOutputTypes(types?: OutputType[]): string[] | undefined {
  if (!types || types.length === 0) return undefined;
  return [...new Set(types.flatMap((type) => OUTPUT_TYPE_SCORERS[type]))];
}

/** Scorers that stand in for a batch scoring metric when none are named. */
export function scorersForMetric(
  metric: 'rna_seq' | 'splice' | 'regulatory_impact' | 'combined',
  source: ResolvedSource
): string[] | undefined {
  if (metric === 'rna_seq') return ['RNA_SEQ'];
  if (metric === 'splice') return ['SPLICE_SITES'];
  // The overall metrics: the AVI score from the Atlas; from live inference,
  // where there is no AVI, every modality (ranked by the largest quantile).
  return source === 'atlas' ? ['AVI_SCORE'] : undefined;
}

/**
 * The AVI scorers exist in the Atlas only. A live call leaves them out and
 * says so, rather than failing a request that also named other scorers.
 */
export function scorersForLive(scorers?: string[]): { scorers?: string[]; note?: string } {
  if (!scorers) return {};
  const kept = scorers.filter((name) => !name.toUpperCase().startsWith(ATLAS_ONLY_PREFIX));
  if (kept.length === scorers.length) return { scorers };
  return {
    scorers: kept.length > 0 ? kept : undefined,
    note: 'AVI scorers are served by the Atlas only and were left out of this live result.',
  };
}

function modeOf(params: { source?: SourceMode }): SourceMode {
  return params.source ?? 'auto';
}

function queryOf(params: VariantQuery): VariantQuery {
  const { chromosome, position, ref, alt, variant_id } = params;
  return variant_id
    ? { chromosome, position, ref, alt, variant_id }
    : { chromosome, position, ref, alt };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function joinNotes(...notes: Array<string | undefined>): string | undefined {
  const kept = notes.filter((note): note is string => Boolean(note));
  return kept.length > 0 ? kept.join(' ') : undefined;
}

type ScorersBySource = string[] | undefined | ((source: ResolvedSource) => string[] | undefined);

function pick(scorers: ScorersBySource, source: ResolvedSource): string[] | undefined {
  return typeof scorers === 'function' ? scorers(source) : scorers;
}

// ============================================================================
// The two routed primitives
// ============================================================================

/**
 * Score one variant: the Atlas for a single-nucleotide variant, live inference
 * otherwise. Falls back to live only in auto mode and only when the Atlas
 * reports that it does not hold the variant.
 */
export async function scoreRouted(
  backend: ScoringBackend,
  mode: SourceMode,
  variant: VariantQuery,
  options: Omit<ScoreOptions, 'scorers'> & { scorers?: ScorersBySource } = {}
): Promise<VariantScores> {
  const decision = decideSource(mode, variant);
  const { scorers, ...rest } = options;

  const live = async (label: string, note?: string): Promise<VariantScores> => {
    const forLive = scorersForLive(pick(scorers, 'live'));
    const result = await backend.scoreVariant('live', queryOf(variant), {
      ...rest,
      scorers: forLive.scorers,
    });
    return { ...result, source: label, source_note: joinNotes(note, forLive.note) };
  };

  if (decision.source === 'atlas') {
    try {
      const result = await backend.scoreVariant('atlas', queryOf(variant), {
        ...rest,
        scorers: pick(scorers, 'atlas'),
      });
      return { ...result, source: sourceLabel('atlas') };
    } catch (error) {
      if (!shouldFallBackToLive(mode, error)) {
        throw error;
      }
      const reason = reasonOf(error);
      return live(sourceLabel('live', reason), fallbackHint(reason));
    }
  }

  return live(
    sourceLabel('live'),
    mode === 'auto' ? `Live inference because: ${decision.reason}.` : undefined
  );
}

export interface RoutedRanking {
  /** "atlas", "live" or "mixed". */
  source: string;
  counts: { atlas: number; live: number; atlas_fallback: number };
  /** One ranked group per source. Never merged: the two are ranked on their own. */
  groups: RankedVariants[];
}

/**
 * Score many variants, each routed on its own.
 *
 * A mixed batch comes back as two separately ranked groups. The Atlas group is
 * ranked by the AVI score by default and the live group cannot be (there is no
 * live AVI), so one merged ranking would compare different quantities.
 */
export async function rankRouted(
  backend: ScoringBackend,
  mode: SourceMode,
  variants: VariantQuery[],
  options: Omit<ScoreOptions, 'scorers'> & { scorers?: ScorersBySource } = {}
): Promise<RoutedRanking> {
  const { scorers, ...rest } = options;
  const { atlas, live } = partitionBySource(mode, variants);
  const liveVariants = live.map((entry) => queryOf(entry.variant));
  const groups: RankedVariants[] = [];
  let fallbackCount = 0;
  let atlasCount = 0;

  if (atlas.length > 0) {
    const result = await backend.scoreVariants(
      'atlas',
      atlas.map((entry) => queryOf(entry.variant)),
      { ...rest, scorers: pick(scorers, 'atlas') }
    );
    atlasCount = result.found;
    if (mode === 'auto') {
      // Only "not in the Atlas" is retried live. A variant the Atlas rejected
      // (wrong reference base, out of range) stays rejected.
      for (const missing of result.not_in_atlas) {
        liveVariants.push(queryOf(atlas[missing.index].variant));
        fallbackCount += 1;
      }
    }
    groups.push({ ...result, source: sourceLabel('atlas') });
  }

  if (liveVariants.length > 0) {
    const forLive = scorersForLive(pick(scorers, 'live'));
    const result = await backend.scoreVariants('live', liveVariants, {
      ...rest,
      scorers: forLive.scorers,
    });
    groups.push({
      ...result,
      source: sourceLabel(
        'live',
        fallbackCount > 0 ? `${fallbackCount} variant(s) not in the Atlas` : undefined
      ),
    });
  }

  const liveCount = liveVariants.length;
  const source = atlasCount > 0 && liveCount > 0 ? 'mixed' : liveCount > 0 ? 'live' : 'atlas';
  return {
    source,
    counts: { atlas: atlasCount, live: liveCount, atlas_fallback: fallbackCount },
    groups,
  };
}

// ============================================================================
// Compact views for JSON results
// ============================================================================

export interface Effect {
  scorer: string;
  score: number | null;
  quantile: number | null;
  where: string;
}

function effectOf(scorer: string, cell: ScoreCell): Effect {
  return { scorer, score: cell.score, quantile: cell.quantile ?? null, where: describeCell(cell) };
}

/** The strongest cell of each scorer. */
export function strongestEffects(result: VariantScores): Effect[] {
  return result.results
    .filter((entry) => entry.available && entry.top && entry.top.length > 0)
    .map((entry) => effectOf(entry.scorer, entry.top![0]));
}

function largestAbsQuantile(effects: Effect[]): number | null {
  const values = effects
    .map((effect) => effect.quantile)
    .filter((value): value is number => value !== null && value !== undefined)
    .map(Math.abs);
  return values.length > 0 ? Math.max(...values) : null;
}

function slimRanked(entry: RankedVariant) {
  return {
    rank: entry.rank,
    variant: entry.variant,
    ...(entry.variant_id ? { variant_id: entry.variant_id } : {}),
    effects: Object.entries(entry.scores).map(([scorer, cell]) => effectOf(scorer, cell)),
  };
}

function slimGroup(group: RankedVariants) {
  return {
    source: group.source,
    scorers: group.scorers,
    ranked_by: group.ranked_by,
    requested: group.requested,
    scored: group.found,
    complete: group.complete,
    ...(group.tissue_filter ? { tissue_filter: group.tissue_filter } : {}),
    ...(group.gene_filter ? { gene_filter: group.gene_filter } : {}),
    ranked: group.ranked.map(slimRanked),
    not_in_atlas: group.not_in_atlas,
    not_scored: group.invalid,
  };
}

/**
 * JSON text that respects the response size cap. JSON cannot be cut mid-way,
 * so ranked lists are shortened until the text fits, and the result says so.
 */
export function jsonCapped(value: Record<string, unknown>, limit = MAX_RESPONSE_CHARS): string {
  let text = JSON.stringify(value, null, 2);
  let keep = 50;
  while (text.length > limit && keep >= 1) {
    const trimmed = JSON.parse(JSON.stringify(value), (key, inner) =>
      Array.isArray(inner) && ['ranked', 'passed', 'not_scored', 'not_in_atlas'].includes(key)
        ? inner.slice(0, keep)
        : inner
    ) as Record<string, unknown>;
    trimmed.truncated = `Lists shortened to ${keep} entries to stay under ${limit} characters.`;
    text = JSON.stringify(trimmed, null, 2);
    keep = Math.floor(keep / 2);
  }
  return text;
}

function signNote(effect: Effect, signed: boolean): string {
  if (!signed || effect.score === null || effect.score === 0) return '';
  return effect.score > 0
    ? ' (positive: predicted higher with the alternate allele than the reference)'
    : ' (negative: predicted lower with the alternate allele than the reference)';
}

// ============================================================================
// Tool parameters
// ============================================================================

export interface SingleVariantParams extends VariantQuery {
  tissue_type?: string;
  source?: SourceMode;
  scorers?: string[];
  output_types?: OutputType[];
}

function tissuesOf(params: { tissue_type?: string }): string[] | undefined {
  return params.tissue_type ? [params.tissue_type] : undefined;
}

// ============================================================================
// Tools that route between the Atlas and live inference
// ============================================================================

/** predict_variant_effect */
export async function predictVariantEffect(
  backend: ScoringBackend,
  params: SingleVariantParams
): Promise<string> {
  const result = await scoreRouted(backend, modeOf(params), params, {
    scorers: params.scorers ?? scorersForOutputTypes(params.output_types),
    tissues: tissuesOf(params),
  });
  return formatVariantScores(result, 'Variant Effect');
}

/** batch_score_variants */
export async function batchScoreVariants(
  backend: ScoringBackend,
  params: {
    variants: VariantQuery[];
    scoring_metric: 'rna_seq' | 'splice' | 'regulatory_impact' | 'combined';
    top_n?: number;
    source?: SourceMode;
    scorers?: string[];
  }
): Promise<string> {
  const ranking = await rankRouted(backend, modeOf(params), params.variants, {
    scorers: params.scorers ?? ((source) => scorersForMetric(params.scoring_metric, source)),
    top_n: params.top_n,
  });

  let output = `# AlphaGenome: Batch Variant Ranking\n\n`;
  output += formatSourceLine(ranking.source);
  output += `**Answered from**: atlas ${ranking.counts.atlas}, live ${ranking.counts.live}`;
  output +=
    ranking.counts.atlas_fallback > 0
      ? ` (${ranking.counts.atlas_fallback} after atlas fallback)\n`
      : `\n`;
  if (ranking.groups.length > 1) {
    output += `**Note**: the two groups below are ranked separately and must not be compared with each other. The Atlas group is ranked by what the Atlas serves (the AVI score by default); live inference has no AVI score.\n`;
  }
  for (const group of ranking.groups) {
    output += `\n---\n\n## From ${group.source.startsWith('atlas') ? 'the Atlas' : 'live inference'}\n\n`;
    output += formatRankedGroup(group);
  }
  output += `\n---\n\n*${RESEARCH_NOTE}*\n`;
  return capResponse(output);
}

/**
 * assess_pathogenicity
 *
 * The name is kept for compatibility. It reports predicted effect size and
 * quantile per modality (and the AVI score from the Atlas). It does not
 * classify: `classification` is always null.
 */
export async function assessPathogenicity(
  backend: ScoringBackend,
  params: SingleVariantParams
): Promise<Record<string, unknown>> {
  const result = await scoreRouted(backend, modeOf(params), params, {
    scorers: params.scorers,
    tissues: tissuesOf(params),
    top_n: 7,
  });
  const effects = strongestEffects(result);
  const avi = effects.find((effect) => effect.scorer === 'AVI_SCORE');
  const modalities = effects.filter((effect) => !effect.scorer.startsWith(ATLAS_ONLY_PREFIX));
  return {
    source: result.source,
    ...(result.source_note ? { source_note: result.source_note } : {}),
    variant: result.variant,
    avi_score: avi ? { score: avi.score, quantile: avi.quantile } : null,
    strongest_effects: modalities,
    largest_abs_quantile: largestAbsQuantile(modalities),
    classification: null,
    note:
      'No pathogenic/benign classification is given: AlphaGenome predicts molecular effects, it does not classify variants. ' +
      'avi_score is the AlphaGenome Variant Impact score, served by the Atlas for single-nucleotide variants only (null otherwise). ' +
      RESEARCH_NOTE,
  };
}

/**
 * batch_pathogenicity_filter
 *
 * The name is kept for compatibility. It keeps the variants whose largest
 * absolute quantile reaches the threshold, ranked, per source.
 */
export async function batchPathogenicityFilter(
  backend: ScoringBackend,
  params: { variants: VariantQuery[]; threshold?: number; source?: SourceMode; scorers?: string[] }
): Promise<string> {
  const threshold = params.threshold ?? 0.99;
  const ranking = await rankRouted(backend, modeOf(params), params.variants, {
    scorers: params.scorers ?? ((source) => (source === 'atlas' ? ['AVI_SCORE'] : undefined)),
    top_n: 100,
  });
  const groups = ranking.groups.map((group) => {
    const slim = slimGroup(group);
    const passed = slim.ranked.filter(
      (entry) => (largestAbsQuantile(entry.effects) ?? -1) >= threshold
    );
    const { ranked, ...rest } = slim;
    return { ...rest, passed_count: passed.length, of: ranked.length, passed };
  });
  return jsonCapped({
    source: ranking.source,
    answered_from: ranking.counts,
    threshold,
    threshold_meaning:
      'Smallest absolute quantile a variant must reach, in any requested scorer, to be kept. Quantiles are the calibrated scores returned by AlphaGenome (0 to 1 in absolute value).',
    groups,
    note:
      'A filter on predicted effect size, not on pathogenicity. Groups from different sources are not comparable with each other. ' +
      RESEARCH_NOTE,
  });
}

/**
 * generate_variant_report
 *
 * A fuller view of one variant: more rows per scorer and, from the Atlas, the
 * AVI score with its feature attributions.
 */
export async function generateVariantReport(
  backend: ScoringBackend,
  params: SingleVariantParams
): Promise<string> {
  const result = await scoreRouted(backend, modeOf(params), params, {
    scorers:
      params.scorers ??
      ((source) => (source === 'atlas' ? [...AVI_SCORERS, ...MODALITY_SCORERS] : undefined)),
    tissues: tissuesOf(params),
    top_n: 40,
  });
  const header =
    `**Generated**: ${new Date().toISOString()}\n` +
    `**What this is**: predicted molecular effects of the variant, ranked by absolute score within each scorer, with the calibrated quantile returned by AlphaGenome. There is no pathogenicity classification in this report.\n\n`;
  const body = formatVariantScores(result, 'Variant Report');
  const split = body.indexOf('\n\n') + 2;
  return capResponse(body.slice(0, split) + header + body.slice(split));
}

/**
 * explain_variant_impact
 *
 * Plain sentences built from the returned numbers. Descriptive only.
 */
export async function explainVariantImpact(
  backend: ScoringBackend,
  params: SingleVariantParams
): Promise<Record<string, unknown>> {
  const result = await scoreRouted(backend, modeOf(params), params, {
    scorers:
      params.scorers ??
      ((source) => (source === 'atlas' ? [...AVI_SCORERS, ...MODALITY_SCORERS] : undefined)),
    tissues: tissuesOf(params),
    top_n: 40,
  });
  const signedBy = new Map(result.results.map((entry) => [entry.scorer, Boolean(entry.is_signed)]));
  const effects = strongestEffects(result);
  const sentences: string[] = [];

  const avi = effects.find((effect) => effect.scorer === 'AVI_SCORE');
  if (avi) {
    sentences.push(
      `AlphaGenome Variant Impact (AVI) score: ${avi.score} (quantile ${avi.quantile}).`
    );
    const attribution = result.results.find(
      (entry) => entry.scorer === 'AVI_SCORE_FEATURE_IMPORTANCE'
    );
    const features = (attribution?.top ?? [])
      .slice(0, 3)
      .map((entry) => `${entry.track?.name ?? 'feature'} (${entry.score})`);
    if (features.length > 0) {
      sentences.push(`Largest contributions to the AVI score: ${features.join(', ')}.`);
    }
  }

  const modalities = effects
    .filter((effect) => !effect.scorer.startsWith(ATLAS_ONLY_PREFIX))
    .sort((a, b) => Math.abs(b.quantile ?? 0) - Math.abs(a.quantile ?? 0));
  for (const effect of modalities) {
    sentences.push(
      `${effect.scorer}: largest predicted effect in ${effect.where || 'the only track'}, score ${effect.score}, quantile ${effect.quantile}${signNote(effect, signedBy.get(effect.scorer) ?? false)}.`
    );
  }
  if (sentences.length === 0) {
    sentences.push('No scores were returned for this variant.');
  }

  return {
    source: result.source,
    ...(result.source_note ? { source_note: result.source_note } : {}),
    variant: result.variant,
    summary: sentences,
    strongest_effects: modalities,
    note:
      'Sentences restate the returned scores and quantiles, ordered by absolute quantile. They describe predicted molecular effects and make no statement about pathogenicity. ' +
      RESEARCH_NOTE,
  };
}

// ============================================================================
// Live-inference tools: one variant
// ============================================================================

async function focused(
  backend: ScoringBackend,
  params: SingleVariantParams,
  focus: string,
  scorers: string[]
): Promise<Record<string, unknown>> {
  const result = await scoreRouted(backend, 'live', params, {
    scorers,
    tissues: tissuesOf(params),
    top_n: 12,
  });
  return { focus, ...result, note: RESEARCH_NOTE };
}

export const predictSpliceImpact = (backend: ScoringBackend, params: SingleVariantParams) =>
  focused(backend, params, 'splicing', ['SPLICE_SITES', 'SPLICE_SITE_USAGE', 'SPLICE_JUNCTIONS']);

export const predictExpressionImpact = (backend: ScoringBackend, params: SingleVariantParams) =>
  focused(backend, params, 'gene expression', ['RNA_SEQ', 'CAGE']);

export const predictTfBindingImpact = (backend: ScoringBackend, params: SingleVariantParams) =>
  focused(backend, params, 'transcription factor binding', ['CHIP_TF']);

export const predictChromatinImpact = (backend: ScoringBackend, params: SingleVariantParams) =>
  focused(backend, params, 'chromatin accessibility', ['ATAC', 'DNASE']);

/**
 * predict_allele_specific_effects: the RNA_SEQ scorer is the log fold change
 * of the alternate allele against the reference, per gene and tissue, which is
 * the allelic effect. RNA_SEQ_ACTIVE gives the expression level alongside it.
 */
export const predictAlleleSpecificEffects = (
  backend: ScoringBackend,
  params: SingleVariantParams
) =>
  focused(backend, params, 'alternate versus reference allele, expression', [
    'RNA_SEQ',
    'RNA_SEQ_ACTIVE',
  ]);

export const annotateRegulatoryContext = (backend: ScoringBackend, params: SingleVariantParams) =>
  focused(backend, params, 'regulatory context across modalities', [
    'ATAC',
    'DNASE',
    'CHIP_HISTONE',
    'CHIP_TF',
    'CAGE',
    'RNA_SEQ',
    'SPLICE_SITES',
    'POLYADENYLATION',
    'CONTACT_MAPS',
  ]);

/** predict_tissue_specific: the same variant, filtered to one tissue at a time. */
export async function predictTissueSpecific(
  backend: ScoringBackend,
  params: VariantQuery & { tissues?: string[] }
): Promise<Record<string, unknown>> {
  const tissues = params.tissues?.length ? params.tissues : ['brain', 'liver', 'heart'];
  const byTissue: Record<string, unknown> = {};
  let variant = '';
  for (const tissue of tissues) {
    const result = await scoreRouted(backend, 'live', params, { tissues: [tissue], top_n: 6 });
    variant = result.variant;
    byTissue[tissue] = { tissue_filter: result.tissue_filter, effects: strongestEffects(result) };
  }
  return {
    source: sourceLabel('live'),
    variant,
    tissues: byTissue,
    note:
      'Each tissue shows the strongest track of each scorer among the tracks of that tissue. Scorers without tissue metadata (SPLICE_SITES) are the same in every tissue. ' +
      RESEARCH_NOTE,
  };
}

// ============================================================================
// Live-inference tools: several variants
// ============================================================================

async function sideBySide(
  backend: ScoringBackend,
  labelled: Array<{ label: string; variant: VariantQuery }>
): Promise<Record<string, unknown>> {
  const scored = await Promise.all(
    labelled.map(async ({ label, variant }) => {
      const result = await scoreRouted(backend, 'live', variant, { top_n: 6 });
      return { label, variant: result.variant, effects: strongestEffects(result) };
    })
  );
  const larger: Record<string, string> = {};
  for (const scorer of MODALITY_SCORERS) {
    const best = scored
      .map((entry) => ({
        label: entry.label,
        value: Math.abs(entry.effects.find((e) => e.scorer === scorer)?.quantile ?? -1),
      }))
      .sort((a, b) => b.value - a.value)[0];
    if (best && best.value >= 0) larger[scorer] = best.label;
  }
  return {
    source: sourceLabel('live'),
    variants: scored,
    larger_abs_quantile_by_scorer: larger,
    note:
      'larger_abs_quantile_by_scorer names the variant with the larger predicted effect for each scorer. It is a comparison of predicted effect sizes, not of severity or risk. ' +
      RESEARCH_NOTE,
  };
}

export const compareVariants = (
  backend: ScoringBackend,
  params: { variant1: VariantQuery; variant2: VariantQuery }
) =>
  sideBySide(backend, [
    { label: 'variant1', variant: params.variant1 },
    { label: 'variant2', variant: params.variant2 },
  ]);

/**
 * compare_protective_risk: the labels are the caller's. The tool compares
 * predicted effect sizes and does not judge which allele is protective.
 */
export const compareProtectiveRisk = (
  backend: ScoringBackend,
  params: { protective_variant: VariantQuery; risk_variant: VariantQuery }
) =>
  sideBySide(backend, [
    { label: 'protective_variant', variant: params.protective_variant },
    { label: 'risk_variant', variant: params.risk_variant },
  ]);

async function rankedLive(
  backend: ScoringBackend,
  variants: VariantQuery[],
  options: ScoreOptions,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const result = await backend.scoreVariants('live', variants.map(queryOf), {
    top_n: 25,
    ...options,
  });
  return jsonCapped({
    ...extra,
    ...slimGroup({ ...result, source: sourceLabel('live') }),
    note: RESEARCH_NOTE,
  });
}

export const analyzeGwasLocus = (
  backend: ScoringBackend,
  params: { variants: VariantQuery[]; chromosome?: string; start?: number; end?: number }
) =>
  rankedLive(
    backend,
    params.variants,
    {},
    params.chromosome
      ? { locus: `${params.chromosome}:${params.start ?? '?'}-${params.end ?? '?'}` }
      : {}
  );

export const compareAlleles = (
  backend: ScoringBackend,
  params: { chromosome: string; position: number; ref: string; alts: string[] }
) =>
  rankedLive(
    backend,
    params.alts.map((alt) => ({
      chromosome: params.chromosome,
      position: params.position,
      ref: params.ref,
      alt,
      variant_id: `${params.ref}>${alt}`,
    })),
    {},
    { position: `${params.chromosome}:${params.position}`, reference: params.ref }
  );

/** compare_variants_same_gene: with a gene, the gene-level scorers restricted to it. */
export const compareVariantsSameGene = (
  backend: ScoringBackend,
  params: { variants: VariantQuery[]; gene_name?: string }
) =>
  rankedLive(
    backend,
    params.variants,
    params.gene_name ? { genes: [params.gene_name], scorers: ['RNA_SEQ', 'SPLICE_SITES'] } : {},
    params.gene_name ? { gene: params.gene_name } : {}
  );

export const batchModalityScreen = (
  backend: ScoringBackend,
  params: { variants: VariantQuery[]; modality: string }
) =>
  rankedLive(
    backend,
    params.variants,
    { scorers: MODALITY_SCREEN_SCORERS[params.modality] },
    { modality: params.modality }
  );

/** batch_tissue_comparison: one ranking per tissue. */
export async function batchTissueComparison(
  backend: ScoringBackend,
  params: { variants: VariantQuery[]; tissues: string[] }
): Promise<string> {
  const byTissue: Record<string, unknown> = {};
  for (const tissue of params.tissues) {
    const result = await backend.scoreVariants('live', params.variants.map(queryOf), {
      tissues: [tissue],
      top_n: 25,
    });
    byTissue[tissue] = slimGroup({ ...result, source: sourceLabel('live') });
  }
  return jsonCapped({ source: sourceLabel('live'), tissues: byTissue, note: RESEARCH_NOTE });
}
