#!/usr/bin/env node

// src/index.ts

import { createRequire } from 'module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { AlphaGenomeClient } from './alphagenome-client.js';
import { ApiKeyError, NetworkError, RateLimitError, ValidationError } from './types.js';
import { ALL_TOOLS } from './tools.js';
import {
  validateInput,
  variantPredictionSchema,
  regionAnalysisSchema,
  batchScoreSchema,
} from './utils/validation.js';
import { formatVariantResult, formatRegionResult, formatBatchResult } from './utils/formatting.js';
import type { VariantPredictionParams, RegionAnalysisParams, BatchScoreParams } from './types.js';

/**
 * AlphaGenome MCP Server
 *
 * Integrates Google DeepMind's AlphaGenome with Claude Desktop
 * for AI-powered genomic variant analysis.
 *
 * Uses AlphaGenome Python SDK via subprocess bridge for real-time predictions.
 */

// Parse command-line arguments for API key
function parseApiKey(): string | undefined {
  const args = process.argv.slice(2);
  const apiKeyIndex = args.indexOf('--api-key');

  if (apiKeyIndex !== -1 && apiKeyIndex + 1 < args.length) {
    return args[apiKeyIndex + 1];
  }

  return undefined;
}

const CLI_API_KEY = parseApiKey();

// The version reported to MCP clients comes from package.json, so it cannot
// drift from the published package. build/index.js sits one level below it.
const require = createRequire(import.meta.url);
const { version: PACKAGE_VERSION } = require('../package.json') as { version: string };

// Create MCP server
const server = new Server(
  {
    name: 'alphagenome-mcp',
    version: PACKAGE_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Initialize AlphaGenome client (lazy initialization)
let client: AlphaGenomeClient | null = null;

/**
 * Get or create AlphaGenome client instance
 */
function getClient(): AlphaGenomeClient {
  if (!client) {
    try {
      // Use CLI API key if provided, otherwise fall back to env var
      client = new AlphaGenomeClient(CLI_API_KEY);
    } catch (error) {
      if (error instanceof ApiKeyError) {
        // Report the problem to the caller and keep serving. Exiting here would
        // take the whole server down the first time any tool is called.
        throw new McpError(
          ErrorCode.InvalidRequest,
          'AlphaGenome API key is missing. Get a key from https://alphagenome.deepmind.com ' +
            'and set ALPHAGENOME_API_KEY in the "env" block of your MCP client configuration ' +
            '(preferred), or pass --api-key on the command line.'
        );
      }
      throw error;
    }
  }
  return client;
}

// ============================================================================
// MCP Request Handlers
// ============================================================================

/**
 * Handle ListTools request - return available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: ALL_TOOLS };
});

/**
 * Handle CallTool request - execute tool and return results
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'predict_variant_effect': {
        // Validate input
        const params = validateInput(variantPredictionSchema, args) as VariantPredictionParams;

        // Call AlphaGenome API
        const result = await getClient().predictVariant(params);

        // Format output
        const formatted = formatVariantResult(result);

        return {
          content: [
            {
              type: 'text',
              text: formatted,
            },
          ],
        };
      }

      case 'batch_score_variants': {
        const params = validateInput(batchScoreSchema, args) as BatchScoreParams;
        const result = await getClient().batchScore(params);
        const formatted = formatBatchResult(result);

        return {
          content: [
            {
              type: 'text',
              text: formatted,
            },
          ],
        };
      }

      case 'assess_pathogenicity': {
        const params = validateInput(variantPredictionSchema, args) as VariantPredictionParams;
        const result = await getClient().assessPathogenicity(params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'predict_tissue_specific': {
        const result = await getClient().predictTissueSpecific(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'compare_variants': {
        const result = await getClient().compareVariants(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'predict_splice_impact': {
        const params = validateInput(variantPredictionSchema, args) as VariantPredictionParams;
        const result = await getClient().predictSpliceImpact(params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'predict_expression_impact': {
        const params = validateInput(variantPredictionSchema, args) as VariantPredictionParams;
        const result = await getClient().predictExpressionImpact(params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'analyze_gwas_locus': {
        const result = await getClient().analyzeGwasLocus(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'compare_alleles': {
        const result = await getClient().compareAlleles(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'batch_tissue_comparison': {
        const result = await getClient().batchTissueComparison(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'predict_tf_binding_impact': {
        const params = validateInput(variantPredictionSchema, args) as VariantPredictionParams;
        const result = await getClient().predictTfBindingImpact(params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'predict_chromatin_impact': {
        const params = validateInput(variantPredictionSchema, args) as VariantPredictionParams;
        const result = await getClient().predictChromatinImpact(params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'compare_protective_risk': {
        const result = await getClient().compareProtectiveRisk(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'batch_pathogenicity_filter': {
        const result = await getClient().batchPathogenicityFilter(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'compare_variants_same_gene': {
        const result = await getClient().compareVariantsSameGene(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'predict_allele_specific_effects': {
        const params = validateInput(variantPredictionSchema, args) as VariantPredictionParams;
        const result = await getClient().predictAlleleSpecificEffects(params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'annotate_regulatory_context': {
        const params = validateInput(variantPredictionSchema, args) as VariantPredictionParams;
        const result = await getClient().annotateRegulatoryContext(params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'batch_modality_screen': {
        const result = await getClient().batchModalityScreen(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'generate_variant_report': {
        const params = validateInput(variantPredictionSchema, args) as VariantPredictionParams;
        const result = await getClient().generateVariantReport(params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'explain_variant_impact': {
        const params = validateInput(variantPredictionSchema, args) as VariantPredictionParams;
        const result = await getClient().explainVariantImpact(params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error: unknown) {
    // Handle different error types with appropriate MCP error codes
    if (error instanceof McpError) {
      throw error;
    }

    if (error instanceof Error) {
      // Validation errors
      if (error.message.includes('Validation error')) {
        throw new McpError(ErrorCode.InvalidParams, `Input validation failed:\n${error.message}`);
      }

      // API errors
      if (error instanceof ApiKeyError) {
        throw new McpError(ErrorCode.InvalidRequest, `API key error: ${error.message}`);
      }

      if (error instanceof NetworkError) {
        throw new McpError(ErrorCode.InternalError, `Network error: ${error.message}`);
      }

      if (error instanceof RateLimitError) {
        throw new McpError(ErrorCode.InternalError, `Rate limit exceeded: ${error.message}`);
      }

      if (error instanceof ValidationError) {
        throw new McpError(ErrorCode.InvalidParams, `Validation error: ${error.message}`);
      }

      // Generic error
      throw new McpError(ErrorCode.InternalError, `An unexpected error occurred: ${error.message}`);
    }

    // Unknown error type
    console.error('Unexpected error:', error);
    throw new McpError(
      ErrorCode.InternalError,
      'An unexpected error occurred. Please check server logs.'
    );
  }
});

// ============================================================================
// Server Startup
// ============================================================================

/**
 * Main server startup function
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('AlphaGenome MCP Server running on stdio');
}

// Start the server
main().catch((error) => {
  console.error('❌ Fatal error starting server:', error);
  process.exit(1);
});
