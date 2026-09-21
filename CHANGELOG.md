# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- README is English only. The Korean half duplicated the English one and doubled its length; it is removed, together with the language switcher
- README opens with the how-it-works diagram (`docs/media/how-it-works.png`) and a demo video (the three-minute recording shown at 2x speed, since GitHub's player has no default playback rate), and shows a longer illustrated explainer of the research workflow (`docs/media/explainer.png`) near the end, under "Why this server exists". `docs/` is not part of the npm package
- README links to the rarevariants study browser (AlphaGenome scores for rare variants in 85 Alzheimer's disease genes), and states that its scores were computed with the SDK directly, not with this server

## [0.3.0] - 2026-09-21

AlphaGenome as a tool for Claude agents: the precomputed AlphaGenome Atlas for single-nucleotide variants, live inference for indels and other variants the Atlas cannot precompute, chosen automatically, with the source stated on every result.

### BREAKING CHANGES

Live inference no longer classifies variants, and the output of every live tool has changed.

- **Why.** The old live path took the largest `|alt - ref|` over the whole 1 Mb window, on raw track values, and compared it with fixed thresholds (0.5, 0.2). Raw ChIP-seq values are in the hundreds, so practically every variant came out as `high` impact and `likely_pathogenic`. A 2 bp deletion whose mean predictions did not change was reported as "163200%", "HIGH RISK", "LIKELY_PATHOGENIC". Those labels were artefacts, not predictions.
- **What replaces it.** Live inference now uses the SDK's `score_variant` with its recommended variant scorers. They have the same names as the Atlas scorers and return the same shape (scores with calibrated quantiles, per track and per gene), so an Atlas result and a live result go through one summarizer and can be read side by side. Indels and multi-nucleotide variants are scored correctly.
- **Removed from every result, on both paths:** `classification`/`clinical_significance` values, `impact_level`, `pathogenicity_score`, risk labels, recommendations, percent-change and fold-change statements, `ase_ratio`, `regulatory_context` labels, `more_severe`. Scores and quantiles are reported as returned.
- **Tools that keep their name but changed meaning:**
  - `assess_pathogenicity`: predicted effect size per modality, the largest absolute quantile, and the AVI score from the Atlas. `classification` is always `null`.
  - `batch_pathogenicity_filter`: `threshold` is now the smallest absolute quantile (0 to 1, default 0.99) a variant must reach to be kept. It filters on predicted effect size, not on pathogenicity.
  - `generate_variant_report`: a research summary with more rows per scorer and, from the Atlas, the AVI feature attributions. No classification, no recommendation.
  - `explain_variant_impact`: sentences that restate the returned scores and quantiles. Descriptive only.
- **Other tools:** all fourteen remaining variant tools return the new shape (strongest effect per scorer with score, quantile and where it was seen; rankings by predicted effect). `compare_variants` and `compare_protective_risk` report which variant has the larger quantile per scorer instead of which is "more severe".
- `predict_variant_effect` no longer filters to brain by default; `tissue_type` filters only when given. `batch_score_variants` no longer accepts `include_interpretation`.
- These are model predictions for research prioritization, not clinical classifications, and every tool description and result now says so.

### Added
- AlphaGenome Atlas tools (precomputed scores, no model call)
  - atlas_list_scorers: the scorers the Atlas serves, cached for the session
  - atlas_lookup_variant: strongest tracks per scorer for one single-nucleotide variant
  - atlas_lookup_variants: up to 500 variants ranked; missing and rejected variants listed separately
  - atlas_scan_region: every substitution in a region, ranked. At most 10,000 bp; up to 50,000 bp only with `allow_large_region: true`, because a scan is one API request per 32 bp under a requests-per-minute quota. A scan stopped by the quota or the time limit returns the partial result, marked incomplete, with the range that was really scanned
- The AlphaGenome Variant Impact score as a first-class output: `AVI_SCORE` is the default for ranking many variants and for region scans, and `AVI_SCORE_FEATURE_IMPORTANCE` is shown by generate_variant_report and explain_variant_impact. AVI is served by the Atlas only, so it exists for single-nucleotide variants; a live result has none and says so
- `source` parameter (`auto` default, `atlas`, `live`) and `scorers` parameter on predict_variant_effect, batch_score_variants, assess_pathogenicity, batch_pathogenicity_filter, generate_variant_report and explain_variant_impact
- `tissue_type` and `tissues` accept ontology CURIEs (`UBERON:0000955`) as well as names, and filter tracks on both paths
- Every result states its source: `atlas`, `live`, or `live (atlas fallback: <reason>)`. Batches report how many variants came from each source and how many fell back
- Response size cap: Atlas results are ranked summaries (top_n default 25, maximum 100), never a score matrix, and no response exceeds 40,000 characters
- `ALPHAGENOME_PYTHON` to choose the interpreter; `python3` then `python` are tried otherwise (fixes Windows, where `python3` usually does not exist)
- `ALPHAGENOME_TIMEOUT_MS` (default 180000). A call that runs over is stopped with a clear error instead of hanging
- Unit tests that run without an API key and in CI: TypeScript tests for validation, formatting, routing, configuration, the tool definitions and all twenty variant tools against a fake backend; Python tests for the shared summarizer

### Changed
- README reframed around the agent use case; installation now recommends passing the key through `env` rather than `--api-key`, documents `claude mcp add` for Claude Code and the Claude Desktop config paths for macOS and Windows
- Python 3.10 or newer is required, as the `alphagenome` package requires it (the README said 3.8)
- Installation guide: where to get a key, a virtual-environment setup with `ALPHAGENOME_PYTHON` for macOS, Linux and Windows, a verification step, and a troubleshooting table keyed on the server's error messages. Live inference timings updated to the measured 3-10 seconds (they said 30-60)
- The publish workflow runs the unit tests before publishing; its last step, which was not valid JavaScript and could never run, is replaced by a job summary
- The version reported to MCP clients comes from package.json (it was hard-coded to 0.1.5)
- `docs/API.md` is now a tool reference generated from the definitions in `src/tools.ts` (`npm run docs:api`), and CI fails if it is out of date. It used to describe version 0.1, including a tool that no longer exists
- README has a Roadmap section: combinations of variants and custom sequences are planned, and no tool in this release provides them

### Fixed
- A missing API key no longer kills the server on the first tool call; the caller gets an error and the server keeps running. The error now points to https://alphagenome.google/api; the address it used to give no longer resolves
- Bridge errors reach the caller with their real message and type. The bridge reports failures as JSON on stdout and exits non-zero; the client used to look at the exit code first and replace the message with "exited with code 1"
- Authentication, rate limit, timeout and validation failures are now distinct errors instead of one generic API error
- `output_types` given as names (`"rna_seq"`, `"splice"`, ...) crashed live inference with `'str' object has no attribute 'to_proto'`; they now select scorers by name on both paths
- `compare_variants_same_gene` ignored its `gene_name` parameter (the bridge read `gene`)
- A failed `alphagenome` import is reported on stdout as JSON, so the client can show it
- `bin` in package.json was written `./build/index.js`. npm 11 treats that as invalid and drops the entry from the published metadata, which would have left `npx @jolab/alphagenome-mcp` with nothing to run. Now `build/index.js`, as `npm pkg fix` writes it
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
