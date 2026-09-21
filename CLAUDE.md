# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AlphaGenome MCP (Model Context Protocol) Server: AlphaGenome as a tool for Claude agents. The agent turns a researcher's question into an analysis; the server answers single-nucleotide variants from the precomputed AlphaGenome Atlas and everything else (indels, multi-nucleotide variants, combinations, custom sequences) with live inference, chooses between the two automatically, and states the source on every result.

**Real API Integration**: Uses the AlphaGenome Python SDK through a Python bridge. Nothing is mocked.

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

# Build, then run the TypeScript unit tests (no API key needed)
npm test

# Python unit tests for the shared summarizer (numpy and pandas only)
npm run test:python
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
   - Spawns the Python bridge once per call; the API key travels on stdin, never on the command line
   - Timeout per call (`ALPHAGENOME_TIMEOUT_MS`, default 180000): the process is killed and a `NetworkError` is raised
   - Interpreter choice: `ALPHAGENOME_PYTHON` pins one; otherwise `python3`, then `python`
   - Reads the JSON on stdout before judging the exit code, and maps `error_type` to typed errors
   - Atlas methods; the scorer list is cached for the session

3. **src/routing.ts** - Atlas or live inference
   - Pure functions, tested without an API key
   - `decideSource(mode, variant)`: `auto` sends a single-base `ref`/`alt` on chr1-22/X/Y to the Atlas and everything else to live; `atlas` throws `ValidationError` for anything else; `live` is always live
   - `shouldFallBackToLive(mode, error)`: true only for `auto` + `AtlasNotAvailableError`. Never for auth, rate limit, network, timeout or validation errors

4. **src/variant-tools.ts** - the 20 variant tools
   - Every tool is a view over two primitives, `scoreRouted` (one variant) and `rankRouted` (many, ranked), built on the narrow `ScoringBackend` interface (`scoreVariant`, `scoreVariants`), so every tool is tested with a fake backend
   - Six tools route (`predict_variant_effect`, `batch_score_variants`, `assess_pathogenicity`, `batch_pathogenicity_filter`, `generate_variant_report`, `explain_variant_impact`); the other fourteen call live inference
   - Every result carries `source`: `atlas`, `live`, or `live (atlas fallback: <reason>)`
   - A mixed batch is two separately ranked groups: the Atlas group ranks by the AVI score, which live inference does not have
   - AVI scorers are dropped from a live call, with a note, rather than failing it

5. **src/tools.ts** - MCP tool definitions (24: 4 Atlas tools, 20 variant tools). Every description states that results are research predictions, not clinical classifications

6. **src/types.ts** - One set of result types for both sources (`VariantScores`, `RankedVariants`, `RegionScan`), custom error classes

7. **src/utils/** - Utility modules
   - **config.ts**: environment variables, as pure functions
   - **validation.ts**: Zod schemas for every tool; caps (500 Atlas variants, 100 live variants, top_n ≤ 100, scan 10,000 bp or 50,000 bp with `allow_large_region`)
   - **formatting.ts**: one set of Markdown formatters for both sources; `formatSourceLine`; `capResponse` (40,000 characters)

8. **scripts/** - Python
   - **alphagenome_bridge.py**: dispatcher. stdout carries exactly one JSON response; logs go to stderr; `classify_error` turns exceptions and gRPC statuses into `error_type`
   - **atlas_actions.py**: `atlas_list_scorers`, `atlas_lookup_variant`, `atlas_lookup_variants`, `atlas_scan_region`
   - **live_actions.py**: `live_score_variant`, `live_score_variants`, using `score_variant` with `RECOMMENDED_VARIANT_SCORERS` (same names as the Atlas scorers, same AnnData shape, quantiles included, indels supported)
   - **summaries.py**: the summarizer shared by both sources. numpy only, so `scripts/tests/` runs without the SDK. Ranked rows, never a matrix. Tissue and gene filters. Ranking rule: one scorer = absolute score; several = largest absolute quantile

### No classification, on either path

Nothing in this server derives a pathogenicity class, a risk label, an impact level or a percent change. Scores and calibrated quantiles are reported as returned and used for ranking. `assess_pathogenicity`, `batch_pathogenicity_filter`, `generate_variant_report` and `explain_variant_impact` keep their names for compatibility only. Do not add thresholds that turn a score into a label; the tests (`FORBIDDEN` in `src/tests/fixtures.ts`) fail if such words appear in a result.

### Atlas facts learned from the real API (SDK 0.9.0)

- Every query needs `requested_scorers`; there is no default. An unknown scorer name comes back as NOT_FOUND ("variant not found"), so names are validated against `scorer_metadata()` first.
- A result is `{scorer: AnnData}`: `X` rows x tracks, `obs` = variant (plus gene or junction for gene-level scorers), `var` = track metadata, `layers['quantiles']` = calibrated scores.
- The SDK raises `ValueError` for both NOT_FOUND and INVALID_ARGUMENT; the gRPC status is on `__cause__`. NOT_FOUND means the Atlas does not hold the variant (fallback allowed). INVALID_ARGUMENT covers a reference base that does not match hg38 (the message names the expected base), a position past the chromosome end, and alleles longer than one base (no fallback).
- `query_variants` fails the whole batch on the first bad variant, so the bridge queries per variant and lists misses separately.
- `query_interval` makes one request per 32 bp and there is a requests-per-minute quota (a 50,000 bp scan exhausted it in testing). Gene-level scorers exceed the 4 MB gRPC message limit in an interval query.
- The Atlas serves 22 scorers: the 19 recommended variant scorers plus `AVI_SCORE`, `AVI_SCORE_FEATURE_IMPORTANCE` and `AVI_SCORE_MODEL_FEATURES` (18 features each). AVI is not available from live inference.
- Quantiles crowd against 1 for strong effects (0.9999024 vs 0.9999838), so they are kept to 7 significant digits.

### Data Flow

```
MCP client → stdio → MCP Server → Validate Input → Route (Atlas or live) → AlphaGenome Client → Python Bridge → AlphaGenome API → Summarise and label the source → MCP client
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
5. Build it in `src/variant-tools.ts` on `scoreRouted` or `rankRouted`, and test it with the fake backend
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
- **publish.yml**: Auto-publishes to npm on release. Creating a GitHub release publishes the package, so do not create one as a side effect

## Python Dependencies

This server requires Python 3.10 or newer and the AlphaGenome SDK (0.9.0 or newer for the Atlas):

```bash
pip install alphagenome numpy
```

The Python bridge (`scripts/alphagenome_bridge.py`, with `scripts/atlas_actions.py` for the Atlas) handles all communication with the AlphaGenome API.

## Important Notes

- Never commit API keys
- Requires valid AlphaGenome API key for production use
- Maintain TypeScript strict mode
- Follow existing error handling patterns
- Update CHANGELOG.md for all changes
