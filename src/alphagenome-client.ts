// src/alphagenome-client.ts

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { getBridgeTimeoutMs, getPythonCandidates } from './utils/config.js';
import {
  VariantPredictionParams,
  RegionAnalysisParams,
  BatchScoreParams,
  VariantResult,
  RegionResult,
  BatchResult,
  ApiKeyError,
  RateLimitError,
  ValidationError,
  NetworkError,
  ApiError,
} from './types.js';

// Re-export error classes for use in index.ts
export { ApiKeyError, RateLimitError, ValidationError, NetworkError, ApiError } from './types.js';

interface BridgeSuccess<T> {
  success: true;
  data: T;
}

interface BridgeFailure {
  success: false;
  error?: string;
  error_type?: string;
}

type BridgeResponse<T> = BridgeSuccess<T> | BridgeFailure;

/** Raised when one candidate interpreter does not exist, so the next can be tried. */
class InterpreterNotFoundError extends Error {}

/**
 * Let typed errors through unchanged and wrap anything else.
 */
function rethrow(error: unknown, label: string): never {
  if (
    error instanceof ApiError ||
    error instanceof ApiKeyError ||
    error instanceof RateLimitError ||
    error instanceof ValidationError ||
    error instanceof NetworkError
  ) {
    throw error;
  }
  throw new ApiError(`${label} failed: ${error}`, 500);
}

/**
 * AlphaGenome API Client
 *
 * Integrates with Google DeepMind's AlphaGenome via a Python bridge.
 * The AlphaGenome API is Python-only (pip install alphagenome), so we spawn
 * a Python subprocess to handle API calls and communicate via JSON over stdin/stdout.
 */
export class AlphaGenomeClient {
  private apiKey: string;
  private pythonBridgePath: string;

  /**
   * Create a new AlphaGenome client
   *
   * @param apiKey - AlphaGenome API key (optional, will use env var if not provided)
   * @throws ApiKeyError if no API key is provided
   */
  constructor(apiKey?: string) {
    // Get API key from parameter or environment variable
    const key = apiKey || process.env.ALPHAGENOME_API_KEY;

    if (!key) {
      throw new ApiKeyError(
        'AlphaGenome API key is required. ' +
          'Provide it via constructor parameter or ALPHAGENOME_API_KEY environment variable.'
      );
    }

    this.apiKey = key;

    // Resolve path to Python bridge script
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    this.pythonBridgePath = path.join(__dirname, '..', 'scripts', 'alphagenome_bridge.py');
  }

  /**
   * Turn a failed bridge response into the matching typed error.
   *
   * The bridge reports failures as JSON on stdout (`success: false`) and also
   * exits non-zero, so the JSON has to be read before the exit code is judged.
   */
  private static toTypedError(response: BridgeFailure): Error {
    const message = response.error || 'Unknown error from Python bridge';
    switch (response.error_type) {
      case 'ValidationError':
      case 'ValueError':
        return new ValidationError(message);
      case 'ApiKeyError':
        return new ApiKeyError(message);
      case 'RateLimitError':
        return new RateLimitError(message);
      case 'NetworkError':
      case 'TimeoutError':
        return new NetworkError(message);
      default:
        return new ApiError(message, 500);
    }
  }

  /**
   * Call the Python bridge with a request
   *
   * @param action - The bridge action to perform
   * @param params - Action-specific parameters
   * @returns Promise resolving to the API response
   */
  private async callPythonBridge<T>(action: string, params: unknown): Promise<T> {
    const requestJson = JSON.stringify({ action, api_key: this.apiKey, params });
    const candidates = getPythonCandidates();
    const timeoutMs = getBridgeTimeoutMs();

    let lastSpawnError: Error | undefined;
    for (const executable of candidates) {
      try {
        return await this.runBridge<T>(executable, requestJson, timeoutMs);
      } catch (error) {
        if (error instanceof InterpreterNotFoundError) {
          lastSpawnError = error;
          continue;
        }
        throw error;
      }
    }

    throw new ApiError(
      `No Python interpreter found (tried: ${candidates.join(', ')}). ` +
        'Install Python 3.10 or newer with `pip install alphagenome`, or set ' +
        'ALPHAGENOME_PYTHON to the interpreter to use. ' +
        (lastSpawnError ? `Last error: ${lastSpawnError.message}` : ''),
      500
    );
  }

  /**
   * Run the bridge once with a specific interpreter.
   */
  private runBridge<T>(executable: string, requestJson: string, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const pythonProcess = spawn(executable, [this.pythonBridgePath]);

      let stdoutData = '';
      let stderrData = '';
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        finish(() => {
          pythonProcess.kill();
          reject(
            new NetworkError(
              `AlphaGenome request timed out after ${timeoutMs} ms. ` +
                'Raise ALPHAGENOME_TIMEOUT_MS for large regions or batches.'
            )
          );
        });
      }, timeoutMs);

      pythonProcess.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      // stderr carries bridge logs only; stdout carries the JSON response.
      pythonProcess.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      pythonProcess.on('close', (code) => {
        finish(() => {
          let response: BridgeResponse<T> | undefined;
          try {
            response = JSON.parse(stdoutData) as BridgeResponse<T>;
          } catch {
            response = undefined;
          }

          if (response && response.success) {
            resolve(response.data);
            return;
          }

          if (response && !response.success) {
            reject(AlphaGenomeClient.toTypedError(response));
            return;
          }

          reject(
            new ApiError(
              code === 0
                ? 'Python bridge returned a response that is not valid JSON'
                : `Python bridge exited with code ${code}: ${stderrData.trim()}`,
              500,
              { stderr: stderrData, stdout: stdoutData.slice(0, 2000) }
            )
          );
        });
      });

      pythonProcess.on('error', (error: NodeJS.ErrnoException) => {
        finish(() => {
          if (error.code === 'ENOENT') {
            reject(new InterpreterNotFoundError(`${executable}: not found`));
          } else {
            reject(new NetworkError(`Failed to spawn Python process: ${error.message}`));
          }
        });
      });

      // The API key travels on stdin, never on the command line.
      pythonProcess.stdin.on('error', () => {
        // Ignored: a missing interpreter surfaces through the 'error' event above.
      });
      pythonProcess.stdin.write(requestJson);
      pythonProcess.stdin.end();
    });
  }

  /**
   * Predict the regulatory impact of a genetic variant
   *
   * @param params - Variant prediction parameters
   * @returns Promise resolving to variant prediction results
   */
  async predictVariant(params: VariantPredictionParams): Promise<VariantResult> {
    try {
      const result = await this.callPythonBridge<VariantResult>('predict_variant', {
        chromosome: params.chromosome,
        position: params.position,
        reference_bases: params.ref,
        alternate_bases: params.alt,
        output_types: params.output_types,
        tissue_type: params.tissue_type || 'brain',
      });

      return result;
    } catch (error) {
      rethrow(error, 'Variant prediction');
    }
  }

  /**
   * Analyze a genomic region for regulatory elements
   *
   * @param params - Region analysis parameters
   * @returns Promise resolving to region analysis results
   */
  async analyzeRegion(params: RegionAnalysisParams): Promise<RegionResult> {
    try {
      const result = await this.callPythonBridge<RegionResult>('analyze_region', {
        chromosome: params.chromosome,
        start: params.start,
        end: params.end,
        analysis_types: params.analysis_types,
        resolution: params.resolution,
      });

      return result;
    } catch (error) {
      rethrow(error, 'Region analysis');
    }
  }

  /**
   * Score multiple variants and rank by impact
   *
   * @param params - Batch scoring parameters
   * @returns Promise resolving to batch scoring results
   */
  async batchScore(params: BatchScoreParams): Promise<BatchResult> {
    try {
      const result = await this.callPythonBridge<BatchResult>('batch_score', {
        variants: params.variants,
        scoring_metric: params.scoring_metric,
        top_n: params.top_n,
      });

      return result;
    } catch (error) {
      rethrow(error, 'Batch scoring');
    }
  }

  /**
   * Assess pathogenicity of a variant
   */
  async assessPathogenicity(params: VariantPredictionParams): Promise<any> {
    try {
      return await this.callPythonBridge('assess_pathogenicity', {
        chromosome: params.chromosome,
        position: params.position,
        ref: params.ref,
        alt: params.alt,
        tissue_type: params.tissue_type,
      });
    } catch (error) {
      rethrow(error, 'Pathogenicity assessment');
    }
  }

  /**
   * Predict tissue-specific effects
   */
  async predictTissueSpecific(params: any): Promise<any> {
    try {
      return await this.callPythonBridge('predict_tissue_specific', params);
    } catch (error) {
      rethrow(error, 'Tissue-specific prediction');
    }
  }

  /**
   * Compare two variants
   */
  async compareVariants(params: any): Promise<any> {
    try {
      return await this.callPythonBridge('compare_variants', params);
    } catch (error) {
      rethrow(error, 'Variant comparison');
    }
  }

  /**
   * Predict splice impact
   */
  async predictSpliceImpact(params: VariantPredictionParams): Promise<any> {
    try {
      return await this.callPythonBridge('predict_splice_impact', {
        chromosome: params.chromosome,
        position: params.position,
        ref: params.ref,
        alt: params.alt,
        tissue_type: params.tissue_type,
      });
    } catch (error) {
      rethrow(error, 'Splice impact prediction');
    }
  }

  /**
   * Predict expression impact
   */
  async predictExpressionImpact(params: VariantPredictionParams): Promise<any> {
    try {
      return await this.callPythonBridge('predict_expression_impact', {
        chromosome: params.chromosome,
        position: params.position,
        ref: params.ref,
        alt: params.alt,
        tissue_type: params.tissue_type,
      });
    } catch (error) {
      rethrow(error, 'Expression impact prediction');
    }
  }

  /**
   * Analyze GWAS locus
   */
  async analyzeGwasLocus(params: any): Promise<any> {
    try {
      return await this.callPythonBridge('analyze_gwas_locus', params);
    } catch (error) {
      rethrow(error, 'GWAS locus analysis');
    }
  }

  /**
   * Compare alleles
   */
  async compareAlleles(params: any): Promise<any> {
    try {
      return await this.callPythonBridge('compare_alleles', params);
    } catch (error) {
      rethrow(error, 'Allele comparison');
    }
  }

  /**
   * Batch tissue comparison
   */
  async batchTissueComparison(params: any): Promise<any> {
    try {
      return await this.callPythonBridge('batch_tissue_comparison', params);
    } catch (error) {
      rethrow(error, 'Batch tissue comparison');
    }
  }

  /**
   * Predict TF binding impact
   */
  async predictTfBindingImpact(params: VariantPredictionParams): Promise<any> {
    try {
      return await this.callPythonBridge('predict_tf_binding_impact', params);
    } catch (error) {
      rethrow(error, 'TF binding impact prediction');
    }
  }

  /**
   * Predict chromatin impact
   */
  async predictChromatinImpact(params: VariantPredictionParams): Promise<any> {
    try {
      return await this.callPythonBridge('predict_chromatin_impact', params);
    } catch (error) {
      rethrow(error, 'Chromatin impact prediction');
    }
  }

  /**
   * Compare protective vs risk variants
   */
  async compareProtectiveRisk(params: any): Promise<any> {
    try {
      return await this.callPythonBridge('compare_protective_risk', params);
    } catch (error) {
      rethrow(error, 'Protective vs risk comparison');
    }
  }

  /**
   * Filter variants by pathogenicity threshold
   */
  async batchPathogenicityFilter(params: any): Promise<any> {
    try {
      return await this.callPythonBridge('batch_pathogenicity_filter', params);
    } catch (error) {
      rethrow(error, 'Batch pathogenicity filter');
    }
  }

  /**
   * Compare variants in the same gene
   */
  async compareVariantsSameGene(params: any): Promise<any> {
    try {
      return await this.callPythonBridge('compare_variants_same_gene', params);
    } catch (error) {
      rethrow(error, 'Same-gene variant comparison');
    }
  }

  /**
   * Predict allele-specific effects
   */
  async predictAlleleSpecificEffects(params: VariantPredictionParams): Promise<any> {
    try {
      return await this.callPythonBridge('predict_allele_specific_effects', params);
    } catch (error) {
      rethrow(error, 'Allele-specific effects prediction');
    }
  }

  /**
   * Annotate regulatory context
   */
  async annotateRegulatoryContext(params: VariantPredictionParams): Promise<any> {
    try {
      return await this.callPythonBridge('annotate_regulatory_context', params);
    } catch (error) {
      rethrow(error, 'Regulatory context annotation');
    }
  }

  /**
   * Batch modality screen
   */
  async batchModalityScreen(params: any): Promise<any> {
    try {
      return await this.callPythonBridge('batch_modality_screen', params);
    } catch (error) {
      rethrow(error, 'Batch modality screen');
    }
  }

  /**
   * Generate comprehensive variant report
   */
  async generateVariantReport(params: VariantPredictionParams): Promise<any> {
    try {
      return await this.callPythonBridge('generate_variant_report', params);
    } catch (error) {
      rethrow(error, 'Variant report generation');
    }
  }

  /**
   * Explain variant impact in human-readable format
   */
  async explainVariantImpact(params: VariantPredictionParams): Promise<any> {
    try {
      return await this.callPythonBridge('explain_variant_impact', params);
    } catch (error) {
      rethrow(error, 'Variant impact explanation');
    }
  }

  /**
   * Test the connection to AlphaGenome API
   *
   * @returns Promise resolving to true if connection successful
   */
  async testConnection(): Promise<boolean> {
    try {
      // Test with a simple variant prediction
      await this.predictVariant({
        chromosome: 'chr1',
        position: 1000000,
        ref: 'A',
        alt: 'T',
      });
      return true;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }
}
