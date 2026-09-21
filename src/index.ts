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
import {
  ApiKeyError,
  AtlasNotAvailableError,
  NetworkError,
  RateLimitError,
  ValidationError,
} from './types.js';
import { ALL_TOOLS } from './tools.js';
import * as schemas from './utils/validation.js';
import { validateInput } from './utils/validation.js';
import {
  formatRankedVariants,
  formatRegionScan,
  formatScorerList,
  formatVariantScores,
} from './utils/formatting.js';
import * as tools from './variant-tools.js';

/**
 * AlphaGenome MCP Server
 *
 * AlphaGenome as a tool for Claude agents: the precomputed AlphaGenome Atlas
 * for single-nucleotide variants, live inference for indels and other variants
 * the Atlas cannot precompute, chosen automatically, with the source stated
 * on every result.
 *
 * Talks to the AlphaGenome Python SDK through a subprocess bridge.
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
// Tool handlers
// ============================================================================

type Handler = (args: unknown) => Promise<string | Record<string, unknown>>;

/**
 * Every tool: validate the input, then run it against the client. A handler
 * returns Markdown, or an object that is sent as JSON. Either way the result
 * states its source.
 */
const HANDLERS: Record<string, Handler> = {
  // Choose between the Atlas and live inference
  predict_variant_effect: (args) =>
    tools.predictVariantEffect(getClient(), validateInput(schemas.variantPredictionSchema, args)),
  batch_score_variants: (args) =>
    tools.batchScoreVariants(getClient(), validateInput(schemas.batchScoreSchema, args)),
  assess_pathogenicity: (args) =>
    tools.assessPathogenicity(getClient(), validateInput(schemas.variantPredictionSchema, args)),
  batch_pathogenicity_filter: (args) =>
    tools.batchPathogenicityFilter(
      getClient(),
      validateInput(schemas.pathogenicityFilterSchema, args)
    ),
  generate_variant_report: (args) =>
    tools.generateVariantReport(getClient(), validateInput(schemas.variantPredictionSchema, args)),
  explain_variant_impact: (args) =>
    tools.explainVariantImpact(getClient(), validateInput(schemas.variantPredictionSchema, args)),

  // Live inference
  predict_tissue_specific: (args) =>
    tools.predictTissueSpecific(getClient(), validateInput(schemas.tissueSpecificSchema, args)),
  compare_variants: (args) =>
    tools.compareVariants(getClient(), validateInput(schemas.compareVariantsSchema, args)),
  predict_splice_impact: (args) =>
    tools.predictSpliceImpact(getClient(), validateInput(schemas.singleVariantSchema, args)),
  predict_expression_impact: (args) =>
    tools.predictExpressionImpact(getClient(), validateInput(schemas.singleVariantSchema, args)),
  analyze_gwas_locus: (args) =>
    tools.analyzeGwasLocus(getClient(), validateInput(schemas.gwasLocusSchema, args)),
  compare_alleles: (args) =>
    tools.compareAlleles(getClient(), validateInput(schemas.compareAllelesSchema, args)),
  batch_tissue_comparison: (args) =>
    tools.batchTissueComparison(getClient(), validateInput(schemas.batchTissueSchema, args)),
  predict_tf_binding_impact: (args) =>
    tools.predictTfBindingImpact(getClient(), validateInput(schemas.singleVariantSchema, args)),
  predict_chromatin_impact: (args) =>
    tools.predictChromatinImpact(getClient(), validateInput(schemas.singleVariantSchema, args)),
  compare_protective_risk: (args) =>
    tools.compareProtectiveRisk(
      getClient(),
      validateInput(schemas.compareProtectiveRiskSchema, args)
    ),
  compare_variants_same_gene: (args) =>
    tools.compareVariantsSameGene(getClient(), validateInput(schemas.sameGeneSchema, args)),
  predict_allele_specific_effects: (args) =>
    tools.predictAlleleSpecificEffects(
      getClient(),
      validateInput(schemas.singleVariantSchema, args)
    ),
  annotate_regulatory_context: (args) =>
    tools.annotateRegulatoryContext(getClient(), validateInput(schemas.singleVariantSchema, args)),
  batch_modality_screen: (args) =>
    tools.batchModalityScreen(getClient(), validateInput(schemas.modalityScreenSchema, args)),

  // AlphaGenome Atlas: precomputed scores, no model call
  atlas_list_scorers: async () => formatScorerList(await getClient().listScorers()),
  atlas_lookup_variant: async (args) => {
    const { scorers, top_n, ...variant } = validateInput(schemas.atlasLookupVariantSchema, args);
    const result = await getClient().scoreVariant('atlas', variant, { scorers, top_n });
    return formatVariantScores(result, 'Atlas Variant Lookup');
  },
  atlas_lookup_variants: async (args) => {
    const { variants, scorers, top_n } = validateInput(schemas.atlasLookupVariantsSchema, args);
    const result = await getClient().scoreVariants('atlas', variants, { scorers, top_n });
    return formatRankedVariants(result, 'Atlas Variant Ranking');
  },
  atlas_scan_region: async (args) =>
    formatRegionScan(
      await getClient().scanRegion(validateInput(schemas.atlasScanRegionSchema, args))
    ),
};

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
    const handler = HANDLERS[name];
    if (!handler) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    const result = await handler(args);
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return { content: [{ type: 'text', text }] };
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

      if (error instanceof AtlasNotAvailableError) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Not in the AlphaGenome Atlas: ${error.message} Use source=auto or source=live to run live inference instead.`
        );
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
