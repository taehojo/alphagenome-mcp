# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
