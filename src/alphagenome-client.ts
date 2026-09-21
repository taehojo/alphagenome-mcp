// src/alphagenome-client.ts

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { getBridgeTimeoutMs, getPythonCandidates } from './utils/config.js';
import {
  ApiKeyError,
  RateLimitError,
  ValidationError,
  NetworkError,
  AtlasNotAvailableError,
  ApiError,
  RankedVariants,
  RegionScan,
  ScoreOptions,
  ScorerList,
  VariantQuery,
  VariantScores,
} from './types.js';
import type { ResolvedSource } from './routing.js';

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
    error instanceof NetworkError ||
    error instanceof AtlasNotAvailableError
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
      case 'AtlasNotAvailableError':
        return new AtlasNotAvailableError(message);
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

  private scorerList: ScorerList | null = null;

  /**
   * Seconds since the epoch by which a long call should stop and return what
   * it has. Leaves room before the bridge timeout so that a slow scan or batch
   * ends with a partial, labelled result instead of a killed process.
   */
  private static deadline(): number {
    const budgetMs = Math.max(10000, getBridgeTimeoutMs() - 20000);
    return (Date.now() + budgetMs) / 1000;
  }

  /**
   * Scores of one variant, from the Atlas (precomputed) or from live inference
   * (score_variant). Both come back in the same shape.
   */
  async scoreVariant(
    source: ResolvedSource,
    variant: VariantQuery,
    options: ScoreOptions = {}
  ): Promise<VariantScores> {
    const action = source === 'atlas' ? 'atlas_lookup_variant' : 'live_score_variant';
    try {
      return await this.callPythonBridge<VariantScores>(action, { ...variant, ...options });
    } catch (error) {
      rethrow(error, source === 'atlas' ? 'Atlas variant lookup' : 'Live variant scoring');
    }
  }

  /**
   * Scores of many variants from one source, ranked.
   */
  async scoreVariants(
    source: ResolvedSource,
    variants: VariantQuery[],
    options: ScoreOptions = {}
  ): Promise<RankedVariants> {
    const action = source === 'atlas' ? 'atlas_lookup_variants' : 'live_score_variants';
    try {
      return await this.callPythonBridge<RankedVariants>(action, {
        variants,
        ...options,
        deadline_epoch: AlphaGenomeClient.deadline(),
      });
    } catch (error) {
      rethrow(error, source === 'atlas' ? 'Atlas batch lookup' : 'Live batch scoring');
    }
  }

  /**
   * Scorers available in the Atlas. Fetched once per server session.
   */
  async listScorers(): Promise<ScorerList> {
    if (this.scorerList) {
      return this.scorerList;
    }
    try {
      this.scorerList = await this.callPythonBridge<ScorerList>('atlas_list_scorers', {});
      return this.scorerList;
    } catch (error) {
      rethrow(error, 'Atlas scorer listing');
    }
  }

  /**
   * Every single-nucleotide substitution in a region, ranked (Atlas only).
   */
  async scanRegion(params: {
    chromosome: string;
    start: number;
    end: number;
    allow_large_region?: boolean;
    scorers?: string[];
    top_n?: number;
  }): Promise<RegionScan> {
    try {
      return await this.callPythonBridge<RegionScan>('atlas_scan_region', {
        ...params,
        deadline_epoch: AlphaGenomeClient.deadline(),
      });
    } catch (error) {
      rethrow(error, 'Atlas region scan');
    }
  }
}
