// src/alphagenome-client.ts

import axios, { AxiosInstance, AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import {
  VariantPredictionParams,
  VariantResult,
  RegionAnalysisParams,
  RegionResult,
  BatchScoreParams,
  BatchResult,
  ApiKeyError,
  RateLimitError,
  ValidationError as TypeValidationError,
  NetworkError,
  ApiError,
} from './types.js';

// Re-export error classes for convenience
export { ApiKeyError, RateLimitError, ValidationError, NetworkError, ApiError } from './types.js';

/**
 * Configuration for AlphaGenome API client
 */
interface AlphaGenomeConfig {
  apiKey: string;
  baseURL: string;
  timeout: number;
  retryAttempts: number;
}

/**
 * AlphaGenome API Client
 *
 * ⚠️ MOCK MODE: Currently uses simulated data for demonstration.
 * The real AlphaGenome API from Google DeepMind is not yet publicly available.
 */
export class AlphaGenomeClient {
  private config: AlphaGenomeConfig;
  private client: AxiosInstance | null = null;
  private useMock: boolean;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.ALPHAGENOME_API_KEY;
    this.useMock = !key || key === 'mock' || process.env.USE_MOCK_API === 'true';

    if (!key && !this.useMock) {
      throw new ApiKeyError(
        'AlphaGenome API key is required. ' +
          'Set ALPHAGENOME_API_KEY environment variable or pass it to constructor. ' +
          'Use ALPHAGENOME_API_KEY=mock for testing.'
      );
    }

    this.config = {
      apiKey: key || 'mock',
      baseURL: process.env.ALPHAGENOME_BASE_URL || 'https://api.alphagenome.deepmind.com/v1',
      timeout: 30000,
      retryAttempts: 3,
    };

    if (this.useMock) {
      console.error('⚠️  Using MOCK AlphaGenome API for development/demonstration');
      console.error('    Real AlphaGenome API from DeepMind is not yet publicly available');
      console.error('    All predictions are simulated data for proof-of-concept\n');
    } else {
      this.client = this.createAxiosInstance();
    }
  }

  /**
   * Create configured Axios instance with retry logic
   */
  private createAxiosInstance(): AxiosInstance {
    const instance = axios.create({
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': '@jolab/alphagenome-mcp/0.1.0',
      },
    });

    axiosRetry(instance, {
      retries: this.config.retryAttempts,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error) => {
        return (
          axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status === 429
        );
      },
    });

    return instance;
  }

  /**
   * Predict regulatory impact of a genetic variant
   */
  async predictVariant(params: VariantPredictionParams): Promise<VariantResult> {
    if (this.useMock) {
      return this.mockPredictVariant(params);
    }

    try {
      const response = await this.client!.post('/predict/variant', params);
      return response.data;
    } catch (error) {
      throw this.handleError(error as AxiosError);
    }
  }

  /**
   * Analyze regulatory elements in a genomic region
   */
  async analyzeRegion(params: RegionAnalysisParams): Promise<RegionResult> {
    if (this.useMock) {
      return this.mockAnalyzeRegion(params);
    }

    try {
      const response = await this.client!.post('/analyze/region', params);
      return response.data;
    } catch (error) {
      throw this.handleError(error as AxiosError);
    }
  }

  /**
   * Score multiple variants in batch
   */
  async batchScore(params: BatchScoreParams): Promise<BatchResult> {
    if (this.useMock) {
      return this.mockBatchScore(params);
    }

    try {
      const response = await this.client!.post('/batch/score', params);
      return response.data;
    } catch (error) {
      throw this.handleError(error as AxiosError);
    }
  }

  // ============================================================================
  // Mock Implementations (for development/demonstration)
  // ============================================================================

  /**
   * Mock variant prediction with realistic simulated data
   */
  private mockPredictVariant(params: VariantPredictionParams): VariantResult {
    // Simulate varying impact levels based on position
    const impact_scores = [0.92, 0.78, 0.65, 0.43, 0.21];
    const random_score = impact_scores[Math.floor(Math.random() * impact_scores.length)];

    // Determine impact level based on score
    let impact_level: 'low' | 'moderate' | 'high' | 'critical';
    if (random_score > 0.85) impact_level = 'high';
    else if (random_score > 0.6) impact_level = 'moderate';
    else impact_level = 'low';

    return {
      variant: `${params.chromosome}:${params.position}${params.ref}>${params.alt}`,
      gene_context: 'BRCA1',
      predictions: {
        rna_seq: {
          reference_score: 2.34,
          alternate_score: 1.12,
          fold_change: -2.09,
          confidence: random_score,
        },
        splice: {
          reference_score: 0.89,
          alternate_score: 0.67,
          delta: -0.22,
          consequence: 'donor_weakening',
        },
        tf_binding: [
          { factor: 'p53', ref_score: 0.89, alt_score: 0.44, change: -0.45 },
          { factor: 'NF-κB', ref_score: 0.67, alt_score: 0.44, change: -0.23 },
        ],
      },
      interpretation: {
        impact_level,
        clinical_significance:
          impact_level === 'high' ? 'likely_pathogenic' : 'uncertain_significance',
        recommendations: [
          'Functional validation recommended',
          'Check ClinVar and COSMIC databases',
          'Consider segregation analysis in family',
          'Consult with genetic counselor for clinical interpretation',
        ],
      },
    };
  }

  /**
   * Mock region analysis with realistic simulated regulatory elements
   */
  private mockAnalyzeRegion(params: RegionAnalysisParams): RegionResult {
    const regionSize = params.end - params.start;
    const numPromoters = Math.floor(regionSize / 50000) + 1;
    const numEnhancers = Math.floor(regionSize / 20000) + 1;

    return {
      region: `${params.chromosome}:${params.start.toLocaleString()}-${params.end.toLocaleString()}`,
      elements: {
        promoters: Array.from({ length: numPromoters }, (_, i) => ({
          start: params.start + i * 50000,
          end: params.start + i * 50000 + 200,
          score: 0.89 - i * 0.1,
          type: i === 0 ? 'core_promoter' : 'alternative_promoter',
          associated_gene: 'HBB',
          activity: 'highly active in erythroid cells',
        })),
        enhancers: Array.from({ length: numEnhancers }, (_, i) => ({
          start: params.start + i * 20000 + 500,
          end: params.start + i * 20000 + 700,
          score: 0.92 - i * 0.08,
          type: 'distal_enhancer',
          target_gene: 'HBB',
          distance_to_tss: 400 + i * 100,
          chromatin_loop: i === 0,
        })),
        tf_binding_sites: [
          {
            position: params.start + 150,
            factor: 'GATA1',
            score: 0.91,
            strand: '+' as const,
          },
          {
            position: params.start + 220,
            factor: 'TAL1',
            score: 0.87,
            strand: '+' as const,
          },
          {
            position: params.start + 650,
            factor: 'KLF1',
            score: 0.84,
            strand: '-' as const,
          },
        ],
        chromatin_states: [
          {
            start: params.start,
            end: params.start + 700,
            state: 'Active Promoter',
            activity: 'High',
          },
          {
            start: params.start + 700,
            end: params.start + 1500,
            state: 'Strong Enhancer',
            activity: 'Very High',
          },
        ],
      },
    };
  }

  /**
   * Mock batch scoring with realistic score distribution
   */
  private mockBatchScore(params: BatchScoreParams): BatchResult {
    const scored = params.variants.map((v, i) => {
      const baseScore = 0.95 - i * 0.05;
      const score = Math.max(0.1, baseScore);

      let impact_level: string;
      if (score > 0.8) impact_level = 'high';
      else if (score > 0.5) impact_level = 'moderate';
      else impact_level = 'low';

      return {
        variant_id: v.variant_id,
        variant: `${v.chromosome}:${v.position}${v.ref}>${v.alt}`,
        score,
        impact_level,
        rank: i + 1,
        key_effect: i < 3 ? 'Promoter disruption' : 'Regulatory element affected',
      };
    });

    // Calculate distribution
    const distribution: Record<string, number> = {
      high: scored.filter((v) => v.impact_level === 'high').length,
      moderate: scored.filter((v) => v.impact_level === 'moderate').length,
      low: scored.filter((v) => v.impact_level === 'low').length,
    };

    return {
      total_analyzed: params.variants.length,
      variants: scored.slice(0, params.top_n || 10),
      distribution,
    };
  }

  /**
   * Handle API errors with user-friendly messages
   */
  private handleError(error: AxiosError): Error {
    if (!error.response) {
      return new NetworkError(
        'Unable to connect to AlphaGenome API. Please check your internet connection.'
      );
    }

    const status = error.response.status;
    const data = error.response.data as any;

    switch (status) {
      case 401:
        return new ApiKeyError(
          'Invalid AlphaGenome API key. Please check your ALPHAGENOME_API_KEY.'
        );
      case 429:
        const retryAfter = error.response.headers['retry-after'] || 'unknown';
        return new RateLimitError(
          `AlphaGenome API rate limit exceeded. Retry after: ${retryAfter} seconds`
        );
      case 400:
        return new TypeValidationError(
          `Invalid request: ${data.message || 'Please check your input parameters'}`
        );
      case 500:
      case 502:
      case 503:
        return new ApiError('AlphaGenome API is temporarily unavailable. Please try again later.');
      default:
        return new ApiError(
          `AlphaGenome API error (${status}): ${data.message || 'Unknown error'}`
        );
    }
  }
}
