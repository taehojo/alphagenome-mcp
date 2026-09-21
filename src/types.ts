// src/types.ts

/**
 * TypeScript type definitions for AlphaGenome MCP Server
 */

// ============================================================================
// Variant Prediction Types
// ============================================================================

export interface VariantPredictionParams {
  chromosome: string;
  position: number;
  ref: string;
  alt: string;
  output_types?: OutputType[];
  tissue_type?: string;
  /** Where to answer from: auto (default), atlas, or live. */
  source?: 'auto' | 'atlas' | 'live';
  /** Atlas scorers to use instead of the default set. */
  scorers?: string[];
}

export type OutputType =
  'rna_seq' | 'cage' | 'splice' | 'histone' | 'tf_binding' | 'dnase' | 'atac' | 'contact_map';

export interface VariantResult {
  variant: string;
  /** "atlas", "live", or "live (atlas fallback: <reason>)". Set by the server. */
  source?: string;
  /** Why an eligible variant was not answered from the Atlas, when that is likely fixable. */
  source_hint?: string;
  gene_context?: string;
  predictions: {
    rna_seq?: RnaSeqPrediction;
    splice?: SplicePrediction;
    tf_binding?: TFBindingPrediction[];
    histone?: HistonePrediction;
    dnase?: DnasePrediction;
    atac?: AtacPrediction;
  };
  interpretation: {
    impact_level: 'low' | 'moderate' | 'high' | 'critical';
    clinical_significance?: string;
    recommendations: string[];
  };
}

export interface RnaSeqPrediction {
  reference_score: number;
  alternate_score: number;
  fold_change: number;
}

export interface SplicePrediction {
  reference_score: number;
  alternate_score: number;
  delta: number;
  consequence: string;
}

export interface TFBindingPrediction {
  factor: string;
  ref_score: number;
  alt_score: number;
  change: number;
}

export interface HistonePrediction {
  marks: Array<{
    type: string;
    ref_signal: number;
    alt_signal: number;
  }>;
}

export interface DnasePrediction {
  reference_score: number;
  alternate_score: number;
  delta: number;
}

export interface AtacPrediction {
  reference_score: number;
  alternate_score: number;
  delta: number;
}

// ============================================================================
// Region Analysis Types
// ============================================================================

export interface RegionAnalysisParams {
  chromosome: string;
  start: number;
  end: number;
  analysis_types?: AnalysisType[];
  resolution?: 'base' | 'window';
}

export type AnalysisType = 'promoter' | 'enhancer' | 'silencer' | 'tf_binding' | 'chromatin_state';

export interface RegionResult {
  region: string;
  elements: {
    promoters?: PromoterElement[];
    enhancers?: EnhancerElement[];
    silencers?: SilencerElement[];
    tf_binding_sites?: TFBindingSite[];
    chromatin_states?: ChromatinState[];
  };
}

export interface PromoterElement {
  start: number;
  end: number;
  score: number;
  type: string;
  associated_gene?: string;
  activity?: string;
}

export interface EnhancerElement {
  start: number;
  end: number;
  score: number;
  type?: string;
  target_gene?: string;
  distance_to_tss?: number;
  chromatin_loop?: boolean;
}

export interface SilencerElement {
  start: number;
  end: number;
  score: number;
  target_gene?: string;
}

export interface TFBindingSite {
  position: number;
  factor: string;
  score: number;
  strand: '+' | '-';
  sequence?: string;
}

export interface ChromatinState {
  start: number;
  end: number;
  state: string;
  activity: string;
}

// ============================================================================
// Batch Scoring Types
// ============================================================================

export interface BatchScoreParams {
  variants: Array<{
    chromosome: string;
    position: number;
    ref: string;
    alt: string;
    variant_id?: string;
  }>;
  scoring_metric: 'rna_seq' | 'splice' | 'regulatory_impact' | 'combined';
  top_n?: number;
  include_interpretation?: boolean;
  /** Where to answer from: auto (default), atlas, or live. */
  source?: 'auto' | 'atlas' | 'live';
  /** Atlas scorers to use instead of the default set. */
  scorers?: string[];
}

export interface BatchResult {
  total_analyzed: number;
  /** "atlas", "live", or "mixed" when variants were answered from both. */
  source?: string;
  /** How many variants each source answered. */
  source_counts?: { atlas: number; live: number; atlas_fallback: number };
  variants: Array<{
    variant_id?: string;
    variant: string;
    score: number;
    impact_level: string;
    rank: number;
    key_effect?: string;
    source?: string;
  }>;
  distribution: Record<string, number>;
}

// ============================================================================
// Error Types
// ============================================================================

export class ApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiKeyError';
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * The Atlas answered, and the answer is that it does not hold this variant or
 * region (not found, or outside its coverage). This is the only Atlas failure
 * that source=auto may answer with live inference instead.
 */
export class AtlasNotAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AtlasNotAvailableError';
  }
}

export class ApiError extends Error {
  public statusCode?: number;
  public data?: any;

  constructor(message: string, statusCode?: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.data = data;
  }
}

// ============================================================================
// AlphaGenome Atlas Types
// ============================================================================

/** One cell of a scorer's matrix: a score for one track (and gene or junction, if the scorer has them). */
export interface AtlasCell {
  score: number | null;
  /** The Atlas's calibrated score for the same cell (the SDK's `quantiles` layer), when the scorer has one. */
  quantile?: number | null;
  gene_name?: string;
  gene_id?: string;
  junction_Start?: number;
  junction_End?: number;
  track?: Record<string, string | number | boolean>;
}

export interface AtlasScorerInfo {
  name: string;
  is_signed: boolean;
  tracks: number;
  assays?: string[];
  biosamples?: number;
  track_names?: string[];
}

export interface AtlasScorerList {
  source: 'atlas';
  organism: string;
  coverage: string;
  scorer_count: number;
  default_scorers: { single_variant: string[]; many_variants_and_regions: string[] };
  scorers: AtlasScorerInfo[];
}

export interface AtlasScorerSummary {
  scorer: string;
  available: boolean;
  is_signed?: boolean;
  rows?: number;
  tracks?: number;
  max_abs_score?: number | null;
  median_abs_score?: number | null;
  top?: AtlasCell[];
}

export interface AtlasVariantResult {
  source: 'atlas';
  variant: string;
  scorers: string[];
  rows_per_scorer: number;
  response_cap: string;
  results: AtlasScorerSummary[];
}

export interface AtlasRankedVariant {
  rank: number;
  variant: string;
  variant_id?: string;
  index?: number;
  position?: number;
  scores: Record<string, AtlasCell>;
}

export interface AtlasSkippedVariant {
  index: number;
  variant: string;
  variant_id?: string;
  reason: string;
}

export interface AtlasBatchResult {
  source: 'atlas';
  scorers: string[];
  ranked_by: string;
  requested: number;
  found: number;
  not_in_atlas: AtlasSkippedVariant[];
  invalid: AtlasSkippedVariant[];
  response_cap: string;
  ranked: AtlasRankedVariant[];
}

export interface AtlasRegionResult {
  source: 'atlas';
  region: string;
  width_bp: number;
  scorers: string[];
  ranked_by: string;
  variants_scanned: number;
  complete: boolean;
  abs_score_distribution: { median: number; p90: number; p99: number; max: number } | null;
  response_cap: string;
  ranked: AtlasRankedVariant[];
  scanned_region?: string;
  stopped_because?: string;
}

export interface AtlasVariantQuery {
  chromosome: string;
  position: number;
  ref: string;
  alt: string;
  variant_id?: string;
}
