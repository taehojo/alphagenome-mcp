# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AlphaGenome MCP (Model Context Protocol) Server - A specialized MCP server for genomic variant analysis using Google DeepMind's AlphaGenome AI.

**Real API Integration**: Uses AlphaGenome Python SDK via a Python bridge for production-grade genomic analysis.

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
# Run with your AlphaGenome API key
ALPHAGENOME_API_KEY=your-key-here node build/index.js

# Or provide via command-line argument
node build/index.js --api-key your-key-here

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
   - Python subprocess bridge to AlphaGenome SDK
   - Real-time API calls to Google DeepMind's service
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
Claude Desktop → stdio → MCP Server → Validate Input → AlphaGenome Client → Python Bridge → AlphaGenome API → Format Output → Claude
```

## API Integration

**Production-Ready**: Uses Google DeepMind's AlphaGenome Python SDK via subprocess bridge.

- Real-time predictions from AlphaGenome AI
- Python bridge handles API communication
- Requires valid AlphaGenome API key
- Supports all AlphaGenome modalities (RNA-seq, CAGE, splicing, ChIP-seq, etc.)

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
        "ALPHAGENOME_API_KEY": "your-api-key-here"
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

## Python Dependencies

This server requires Python 3 and the AlphaGenome SDK:

```bash
pip install alphagenome numpy
```

The Python bridge script (`scripts/alphagenome_bridge.py`) handles all communication with the AlphaGenome API.

## Important Notes

- Never commit API keys
- Requires valid AlphaGenome API key for production use
- Maintain TypeScript strict mode
- Follow existing error handling patterns
- Update CHANGELOG.md for all changes
