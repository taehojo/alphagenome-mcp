#!/usr/bin/env node

// src/index.ts

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { AlphaGenomeClient } from './alphagenome-client.js';
import { ApiKeyError, RateLimitError, ValidationError } from './types.js';
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

// Create MCP server
const server = new Server(
  {
    name: 'alphagenome-mcp',
    version: '0.1.3',
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
        console.error('\n❌ AlphaGenome API Key Error:\n');
        console.error(error.message);
        console.error('\nTo fix this:');
        console.error('1. Get an API key from https://alphagenome.deepmind.com');
        console.error('2. Provide it via command-line:');
        console.error('   --api-key YOUR_API_KEY');
        console.error('3. Or set it in your environment or Claude config:');
        console.error('   export ALPHAGENOME_API_KEY=your-key-here');
        console.error('4. Or use mock mode for testing: ALPHAGENOME_API_KEY=mock\n');
        process.exit(1);
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

      case 'analyze_region': {
        const params = validateInput(regionAnalysisSchema, args) as RegionAnalysisParams;
        const result = await getClient().analyzeRegion(params);
        const formatted = formatRegionResult(result);

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
        throw new McpError(ErrorCode.InternalError, `API key error: ${error.message}`);
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
  console.error('🧬 AlphaGenome MCP Server v0.1.3');
  console.error('📡 Starting server on stdio transport...\n');

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('✅ Server ready and listening');
  console.error('💡 Note: First API call may take 30-60s to initialize');
  console.error('🔗 GitHub: https://github.com/taehojo/alphagenome-mcp');
  console.error('📦 npm: @jolab/alphagenome-mcp');
  console.error('🐍 Python requirements: python3, pip install alphagenome\n');
}

// Start the server
main().catch((error) => {
  console.error('❌ Fatal error starting server:', error);
  process.exit(1);
});
