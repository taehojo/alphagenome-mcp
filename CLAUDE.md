# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AlphaGenome MCP (Model Context Protocol) Server - A specialized MCP server for genomic variant analysis.

⚠️ **MOCK MODE**: This is a proof-of-concept implementation with simulated data. The real AlphaGenome API from Google DeepMind is not yet publicly available.

## Development Commands

### Building and Testing
```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Watch mode (development)
npm run dev

# Run linter
npm run lint
npm run lint:fix

# Format code
npm run format
npm run format:check

# Type check without building
npm run typecheck
```

### Running Locally
```bash
# Run with mock data (default)
ALPHAGENOME_API_KEY=mock node build/index.js

# The server communicates via stdio (MCP protocol)
# Output to stderr is for logging, stdout is for MCP messages
```

## Architecture

### Core Components

1. **src/index.ts** - Main MCP server entry point
   - Handles MCP protocol communication
   - Routes tool calls to appropriate handlers
   - Error handling and formatting

2. **src/alphagenome-client.ts** - API client
   - Mock implementation for development
   - Ready for real API integration
   - Comprehensive error handling

3. **src/tools.ts** - MCP tool definitions
   - Three main tools: predict_variant_effect, analyze_region, batch_score_variants
   - JSON schema definitions for inputs

4. **src/types.ts** - TypeScript type definitions
   - All interfaces and types
   - Custom error classes

5. **src/utils/** - Utility modules
   - **validation.ts**: Zod schemas for input validation
   - **formatting.ts**: Markdown output formatting

### Data Flow

```
Claude Desktop → stdio → MCP Server → Validate Input → AlphaGenome Client → Format Output → Claude
```

## Mock Data Policy

**CRITICAL**: This project currently uses mock data for demonstration.

- All mock implementations are clearly labeled
- Console warnings indicate mock mode
- Output includes "⚠️ MOCK DATA" disclaimers
- Architecture is ready for real API integration

## Adding New Tools

To add a new MCP tool:

1. Define types in `src/types.ts`
2. Add validation schema in `src/utils/validation.ts`
3. Create tool definition in `src/tools.ts`
4. Implement handler in `src/index.ts` CallToolRequestSchema
5. Add formatting function in `src/utils/formatting.ts`
6. Update `ALL_TOOLS` array
7. Test with Claude Desktop

## Code Style

- TypeScript strict mode enabled
- ESLint + Prettier enforced
- Use async/await (no callbacks)
- Comprehensive error handling
- All exports use named exports (except default in index.ts)
- Comments use TSDoc format

## Testing with Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "alphagenome": {
      "command": "node",
      "args": ["/absolute/path/to/alphagenome-mcp/build/index.js"],
      "env": {
        "ALPHAGENOME_API_KEY": "mock"
      }
    }
  }
}
```

Restart Claude Desktop and test with:
- "Use AlphaGenome to analyze chr17:41234567A>T"
- "Find regulatory elements in chr11:5225464-5227071"

## CI/CD

GitHub Actions workflows:
- **test.yml**: Runs on push/PR (lint, typecheck, build, test)
- **publish.yml**: Auto-publishes to npm on release

## Future: Real API Integration

When AlphaGenome API becomes available:

1. Update `ALPHAGENOME_BASE_URL` environment variable
2. Replace mock methods in `AlphaGenomeClient` with real API calls
3. Update response type mappings if API differs
4. Remove mock warnings from output formatters
5. Update documentation

The architecture is designed for this transition to be straightforward.

## Important Notes

- Never commit API keys
- Keep mock mode clearly labeled
- Maintain TypeScript strict mode
- Follow existing error handling patterns
- Update CHANGELOG.md for all changes
