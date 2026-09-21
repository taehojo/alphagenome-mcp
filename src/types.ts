// src/types.ts

/**
 * TypeScript type definitions for AlphaGenome MCP Server
 *
 * The Atlas and live inference return variant scores in one shape, so there is
 * one set of result types and a `source` field that says which one answered.
 */

// ============================================================================
// Requests
// ============================================================================

export interface VariantQuery {
  chromosome: string;
  position: number;
  ref: string;
  alt: string;
  variant_id?: string;
}

/** What narrows a result: scorers to use, tissues and genes to keep, rows to return. */
export interface ScoreOptions {
  scorers?: string[];
  /** Tissue names ("brain") or ontology CURIEs ("UBERON:0000955"). */
  tissues?: string[];
  genes?: string[];
  top_n?: number;
}

export type OutputType =
  'rna_seq' | 'cage' | 'splice' | 'histone' | 'tf_binding' | 'dnase' | 'atac' | 'contact_map';

// ============================================================================
// Results
// ============================================================================

/** One cell of a scorer's matrix: a score for one track (and gene or junction, if the scorer has them). */
export interface ScoreCell {
  score: number | null;
  /** The calibrated score returned with it (the SDK's `quantiles` layer), when the scorer has one. */
  quantile?: number | null;
  gene_name?: string;
  gene_id?: string;
  junction_Start?: number;
  junction_End?: number;
  track?: Record<string, string | number | boolean>;
}

export interface ScorerSummary {
  scorer: string;
  available: boolean;
  is_signed?: boolean;
  rows?: number;
  tracks?: number;
  max_abs_score?: number | null;
  median_abs_score?: number | null;
  top?: ScoreCell[];
}

/** One variant: the strongest cells of each scorer. Never the matrix. */
export interface VariantScores {
  /** "atlas", "live", or "live (atlas fallback: <reason>)". */
  source: string;
  /** Why the variant was routed the way it was, when that is worth saying. */
  source_note?: string;
  variant: string;
  scorers: string[];
  rows_per_scorer: number;
  response_cap: string;
  results: ScorerSummary[];
  tissue_filter?: string[];
  gene_filter?: string[];
}

export interface RankedVariant {
  rank: number;
  variant: string;
  variant_id?: string;
  index?: number;
  position?: number;
  scores: Record<string, ScoreCell>;
}

export interface SkippedVariant {
  index: number;
  variant: string;
  variant_id?: string;
  reason: string;
}

/** Many variants from one source, ranked. */
export interface RankedVariants {
  source: string;
  scorers: string[];
  ranked_by: string;
  requested: number;
  found: number;
  /** Atlas only: variants the Atlas does not hold. */
  not_in_atlas: SkippedVariant[];
  /** Variants the source rejected or could not score, with the reason. */
  invalid: SkippedVariant[];
  complete: boolean;
  response_cap: string;
  ranked: RankedVariant[];
  tissue_filter?: string[];
  gene_filter?: string[];
}

export interface RegionScan {
  source: 'atlas';
  region: string;
  width_bp: number;
  scorers: string[];
  ranked_by: string;
  variants_scanned: number;
  complete: boolean;
  /** The part of the region that was really scanned; differs from `region` when incomplete. */
  scanned_region: string;
  stopped_because?: string;
  ranking_value_distribution: { median: number; p90: number; p99: number; max: number } | null;
  response_cap: string;
  ranked: RankedVariant[];
}

export interface ScorerInfo {
  name: string;
  is_signed: boolean;
  tracks: number;
  assays?: string[];
  biosamples?: number;
  track_names?: string[];
}

export interface ScorerList {
  source: 'atlas';
  organism: string;
  coverage: string;
  scorer_count: number;
  default_scorers: { single_variant: string[]; many_variants_and_regions: string[] };
  scorers: ScorerInfo[];
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
 * The Atlas answered, and the answer is that it does not hold this variant.
 * This is the only Atlas failure that source=auto may answer with live
 * inference instead.
 */
export class AtlasNotAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AtlasNotAvailableError';
  }
}

export class ApiError extends Error {
  public statusCode?: number;
  public data?: unknown;

  constructor(message: string, statusCode?: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.data = data;
  }
}
