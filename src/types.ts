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
}

export type OutputType =
  | 'rna_seq'
  | 'cage'
  | 'splice'
  | 'histone'
  | 'tf_binding'
  | 'dnase'
  | 'atac'
  | 'contact_map';

export interface VariantResult {
  variant: string;
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
  confidence: number;
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

export type AnalysisType =
  | 'promoter'
  | 'enhancer'
  | 'silencer'
  | 'tf_binding'
  | 'chromatin_state';

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
}

export interface BatchResult {
  total_analyzed: number;
  variants: Array<{
    variant_id?: string;
    variant: string;
    score: number;
    impact_level: string;
    rank: number;
    key_effect?: string;
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

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
