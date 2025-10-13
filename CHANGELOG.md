# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
