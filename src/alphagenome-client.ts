// src/alphagenome-client.ts

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
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
export {
  ApiKeyError,
  RateLimitError,
  ValidationError,
  NetworkError,
  ApiError,
} from './types.js';

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

    console.error('🧬 AlphaGenome Client initialized');
    console.error(`🐍 Python bridge: ${this.pythonBridgePath}`);
    console.error('✅ Ready to call AlphaGenome API via Python SDK\n');
  }

  /**
   * Call the Python bridge with a request
   *
   * @param action - The action to perform (predict_variant, analyze_region, batch_score)
   * @param params - Action-specific parameters
   * @returns Promise resolving to the API response
   */
  private async callPythonBridge<T>(action: string, params: any): Promise<T> {
    return new Promise((resolve, reject) => {
      const request = {
        action,
        api_key: this.apiKey,
        params,
      };

      const requestJson = JSON.stringify(request);

      // Spawn Python process
      const pythonProcess = spawn('python3', [this.pythonBridgePath]);

      let stdoutData = '';
      let stderrData = '';

      // Collect stdout
      pythonProcess.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      // Collect stderr (for logging)
      pythonProcess.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      // Handle process completion
      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          console.error('Python bridge stderr:', stderrData);
          reject(
            new ApiError(
              `Python bridge exited with code ${code}`,
              500,
              { stderr: stderrData }
            )
          );
          return;
        }

        try {
          const response = JSON.parse(stdoutData);

          if (!response.success) {
            // Handle specific error types
            if (response.error_type === 'ValueError') {
              reject(new ValidationError(response.error));
            } else if (response.error?.includes('rate limit')) {
              reject(new RateLimitError(response.error));
            } else if (response.error?.includes('API key')) {
              reject(new ApiKeyError(response.error));
            } else {
              reject(new ApiError(response.error, 500));
            }
            return;
          }

          resolve(response.data as T);
        } catch (parseError) {
          reject(
            new ApiError(
              `Failed to parse Python bridge response: ${parseError}`,
              500,
              { stdout: stdoutData }
            )
          );
        }
      });

      // Handle process errors
      pythonProcess.on('error', (error) => {
        if (error.message.includes('ENOENT')) {
          reject(
            new ApiError(
              'Python3 not found. Please ensure Python 3 is installed and in your PATH. ' +
                'Also ensure you have installed alphagenome: pip install alphagenome',
              500
            )
          );
        } else {
          reject(new NetworkError(`Failed to spawn Python process: ${error.message}`));
        }
      });

      // Send request to Python process via stdin
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
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(`Variant prediction failed: ${error}`, 500);
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
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(`Region analysis failed: ${error}`, 500);
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
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(`Batch scoring failed: ${error}`, 500);
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
