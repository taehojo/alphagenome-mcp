# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-09-21

AlphaGenome as a tool for Claude agents: the precomputed AlphaGenome Atlas for single-nucleotide variants, live inference for everything else, chosen automatically, with the source stated on every result.

### Added
- AlphaGenome Atlas tools (precomputed scores, no model call)
  - atlas_list_scorers: the scorers the Atlas serves, cached for the session
  - atlas_lookup_variant: strongest tracks per scorer for one single-nucleotide variant
  - atlas_lookup_variants: up to 500 variants ranked; missing and rejected variants listed separately
  - atlas_scan_region: every substitution in up to 50,000 bp, ranked
- `source` parameter (`auto` default, `atlas`, `live`) and `scorers` parameter on predict_variant_effect, assess_pathogenicity and batch_score_variants
- Every result states its source: `atlas`, `live`, or `live (atlas fallback: <reason>)`. Batches report how many variants came from each source and how many fell back
- Response size cap: Atlas results are ranked summaries (top_n default 25, maximum 100), never a score matrix, and no response exceeds 40,000 characters
- `ALPHAGENOME_PYTHON` to choose the interpreter; `python3` then `python` are tried otherwise (fixes Windows, where `python3` usually does not exist)
- `ALPHAGENOME_TIMEOUT_MS` (default 180000). A call that runs over is stopped with a clear error instead of hanging
- Unit tests for validation, formatting, routing, configuration and the routed tools; they run without an API key and in CI

### Changed
- README reframed around the agent use case; installation now recommends passing the key through `env` rather than `--api-key`, documents `claude mcp add` for Claude Code and the Claude Desktop config paths for macOS and Windows
- Python 3.10 or newer is required, as the `alphagenome` package requires it (the README said 3.8)
- From the Atlas, assess_pathogenicity returns the AVI score and the strongest effects with `classification: null`. The Atlas stores scores, not a pathogenic/benign call
- The version reported to MCP clients comes from package.json (it was hard-coded to 0.1.5)

### Fixed
- A missing API key no longer kills the server on the first tool call; the caller gets an error and the server keeps running
- Bridge errors reach the caller with their real message and type. The bridge reports failures as JSON on stdout and exits non-zero; the client used to look at the exit code first and replace the message with "exited with code 1"
- Authentication, rate limit, timeout and validation failures are now distinct errors instead of one generic API error
- `output_types` given as names (`"rna_seq"`, `"splice"`, ...) crashed live inference with `'str' object has no attribute 'to_proto'`; they are now mapped to the SDK's enum
- A failed `alphagenome` import is reported on stdout as JSON, so the client can show it
- `npm test` matched no files and passed with 0 tests; `npm run format:check` and `npm run lint` failed on Windows because of single-quoted globs

### Removed
- The constant `confidence: 0.85` in live RNA-seq results. It was a placeholder, not a model output
- Unused `axios` and `axios-retry` dependencies

## [0.2.0] - 2025-10-13

### Added
- 10 new Group C wrapper tools (total 20 tools now)
  - predict_tf_binding_impact: Focus on transcription factor binding effects
  - predict_chromatin_impact: Assess chromatin accessibility changes
  - compare_protective_risk: Compare protective vs risk alleles directly
  - batch_pathogenicity_filter: Filter variants by pathogenicity threshold
  - compare_variants_same_gene: Rank variants within a single gene
  - predict_allele_specific_effects: Analyze allele-specific regulatory effects
  - annotate_regulatory_context: Comprehensive regulatory context annotation
  - batch_modality_screen: Screen variants across specific regulatory modalities
  - generate_variant_report: Generate comprehensive clinical report
  - explain_variant_impact: Human-readable impact explanation

### Changed
- README completely restructured to emphasize wrapper architecture
  - Removed artificial Group A/B/C classification
  - Organized tools by 7 functional categories
  - All 20 tools now documented as lightweight wrappers around single predict_variant() API
- Updated all query examples to use natural English ("Use alphagenome to...")
- Removed parentheses from query examples for better readability
- Fixed all README examples to show actual API output (not simplified versions)
  - Tissue-specific analysis now shows real field names and structure
  - Variant comparison shows actual output format with splice_delta
  - Allele comparison shows actual allele_comparisons object structure

### Fixed
- batch_modality_screen OutputType serialization error
- batch_modality_screen JSON serialization of OutputType enums
- Documentation now matches actual API responses (truthfulness principle)

### Documentation
- Added paper.tex and paper.pdf with comprehensive technical documentation
- Added "Wrapper Versatility Demonstration" section showing same variant analyzed 6 different ways
- Enhanced interpretations with percentage explanations
- All examples verified with real AlphaGenome API using Alzheimer's disease variants

## [0.1.5] - 2025-10-12

### Verified
- Confirmed full end-to-end functionality with real AlphaGenome API
- Tested with rs113700824 variant analysis (APOE region)
- Validated Python bridge integration and MCP tool calls
- All three tools (predict_variant_effect, analyze_region, batch_score_variants) operational

### Documentation
- Verified working installation command: `npx -y @jolab/alphagenome-mcp@latest --api-key YOUR_KEY`
- Confirmed compatibility with Claude Desktop MCP integration
- Python bridge successfully interfaces with AlphaGenome SDK

## [0.1.4] - 2025-10-12

### Fixed
- Minimized stderr logging to match working MCP servers (sequential-thinking pattern)
- Reduced startup message to single line: "AlphaGenome MCP Server running on stdio"
- Removed all informational logging during initialization
- Removed client initialization logging that could interfere with stdio transport

### Changed
- Simplified error messages to avoid redundant stderr output
- Followed MCP best practices from @modelcontextprotocol/server-sequential-thinking

## [0.1.3] - 2025-10-12

### Changed
- Optimized server initialization to be fully non-blocking
- Reduced logging verbosity in AlphaGenomeClient constructor to avoid stdio interference
- Added initialization time warning for first API call (30-60s expected)

### Fixed
- MCP health check timeout issues by ensuring no blocking operations during startup
- Client initialization now completely deferred until first tool call

## [0.1.2] - 2025-10-12

### Changed
- Removed all "MOCK MODE" warnings from tool descriptions
- Updated documentation to reflect real AlphaGenome API usage
- Clarified that server uses Google DeepMind's AlphaGenome SDK via Python bridge

## [0.1.1] - 2025-10-11

### Added
- Command-line argument parsing for `--api-key` flag
- Support for `claude mcp add` with `--api-key` parameter

### Fixed
- Connection failure when using `npx -y @jolab/alphagenome-mcp` without environment variable
- API key can now be provided via CLI argument, matching behavior of other MCP servers

## [0.1.0] - 2025-10-11

### Added
- Initial project setup
- Real AlphaGenome API integration via Python bridge
- Three core MCP tools: predict_variant_effect, analyze_region, batch_score_variants
- Comprehensive input validation with Zod
- Beautiful Markdown output formatting
- TypeScript strict mode configuration
- ESLint and Prettier setup
- Python bridge for AlphaGenome SDK integration

### Notes
- Uses Google DeepMind's AlphaGenome Python SDK
- Architecture designed for production use
