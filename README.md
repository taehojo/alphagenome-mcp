# AlphaGenome MCP Server

[![npm version](https://badge.fury.io/js/%40jolab%2Falphagenome-mcp.svg)](https://www.npmjs.com/package/@jolab/alphagenome-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Model Context Protocol (MCP) server that provides natural language access to Google DeepMind's AlphaGenome variant effect prediction API.

## Overview

AlphaGenome MCP Server provides a natural language interface to Google DeepMind's AlphaGenome variant effect prediction API. Query genomic variants using plain English instead of writing Python code, designed for exploratory analysis and rapid prototyping.

**Key Features:**
- **Natural Language Interface**: Query variants using plain English instead of writing code
- **Wrapper Architecture**: 20 specialized tools built as wrappers around a single API endpoint
- **Comprehensive Analysis**: Access all AlphaGenome modalities (RNA-seq, ChIP-seq, ATAC-seq, splicing, etc.)
- **Research Tool**: Designed for exploratory genomics research and variant prioritization

## Quick Start

```bash
# Install Python dependencies
pip install alphagenome numpy

# Add to Claude Desktop
claude mcp add alphagenome -- npx -y @jolab/alphagenome-mcp@latest --api-key YOUR_API_KEY
```

Test in Claude Desktop:
```
"Use alphagenome to analyze chr19:44908684T>C"
```

## Architecture

### System Design

AlphaGenome MCP Server implements a multi-tier architecture:

```
┌─────────────────────────┐
│  Researcher             │
└───────────┬─────────────┘
            │ Natural language query
            ↓
┌─────────────────────────┐
│  Claude Desktop         │ ← MCP Client
└───────────┬─────────────┘
            │ JSON-RPC over stdio
            ↓
┌─────────────────────────┐
│  MCP Server (TypeScript)│ ← Tool routing, validation
└───────────┬─────────────┘
            │ subprocess
            ↓
┌─────────────────────────┐
│  Python Bridge          │ ← Interface to AlphaGenome SDK
└───────────┬─────────────┘
            │ HTTP
            ↓
┌─────────────────────────┐
│  AlphaGenome API        │ ← Google DeepMind's service
└─────────────────────────┘
```

### Wrapper Pattern

All 20 tools are lightweight wrappers around the same `predict_variant()` API endpoint. They differ only in parameter configuration and output formatting:

```python
# Same underlying API call
predict_variant(variant, interval, ontology_terms, requested_outputs)

# Different wrappers provide specialized views:
- assess_pathogenicity()    → Clinical scoring
- predict_tf_binding_impact() → TF binding only
- compare_variants()         → Side-by-side comparison
- generate_variant_report()  → Formatted report
```

**Benefits of Wrapper Architecture:**
- Single API implementation serves 20 different functions
- Specialized outputs through parameter configuration
- Easy maintenance (update once, all tools benefit)
- Consistent interface across all tools

### Input Validation

All inputs undergo validation before API submission:
- Chromosomes: Pattern-matched for chr1-22, chrX, chrY
- Positions: Validated as positive integers
- Alleles: A/T/G/C nucleotide validation
- Tissue types: UBERON ontology term validation

Invalid inputs return human-readable error messages, enabling conversational error recovery.

## Available Tools

### Core Analysis

#### predict_variant_effect
Full regulatory impact prediction across all 11 modalities.
```
"Use alphagenome to analyze chr19:44908684T>C"
```

#### assess_pathogenicity
Clinical pathogenicity scoring with evidence breakdown.
```
"Use alphagenome to assess the pathogenicity of rs429358"
```
**Result:** `Pathogenic (score: 1.0)` with expression, splicing, and TF binding evidence.

### Tissue-Specific Analysis

#### predict_tissue_specific
Compare variant effects across multiple tissues.
```
"Use alphagenome to compare rs429358 effects in brain and liver"
```
**Result:** Tissue-differential expression (brain: -0.23%, liver: +0.07%)

#### batch_tissue_comparison
Multi-variant × multi-tissue analysis.
```
"Use alphagenome to test 5 variants in brain, liver, and heart"
```

### Variant Comparison

#### compare_variants
Direct side-by-side comparison.
```
"Use alphagenome to compare APOE ε4 (rs429358) vs ε2 (rs7412)"
```

#### compare_alleles
Compare different mutations at the same position.
```
"Use alphagenome to compare T>C, T>G, T>A at chr19:44908684"
```

#### compare_protective_risk
Compare protective vs risk alleles.
```
"Use alphagenome to compare APOE protective vs risk alleles"
```

#### compare_variants_same_gene
Rank variants within a gene.
```
"Use alphagenome to compare these 5 BRCA1 variants"
```

### Modality-Specific Analysis

#### predict_splice_impact
Splicing effects only.
```
"Use alphagenome to analyze splicing impact of chr6:41129252C>T"
```

#### predict_expression_impact
Gene expression changes only.
```
"Use alphagenome to show expression impact of rs744373"
```

#### predict_tf_binding_impact
Transcription factor binding changes.
```
"Use alphagenome to show TF binding changes for rs429358"
```

#### predict_chromatin_impact
Chromatin accessibility changes.
```
"Use alphagenome to analyze chromatin impact of rs429358"
```

#### batch_modality_screen
Screen variants for specific effects.
```
"Use alphagenome to screen 20 variants for splicing effects"
```

### Multiple Variant Processing

#### batch_score_variants
Rank multiple variants by regulatory impact.
```
"Use alphagenome to score these AD variants: rs429358, rs7412, rs75932628"
```

#### analyze_gwas_locus
Fine-mapping and causal variant identification.
```
"Use alphagenome to analyze GWAS locus with 10 variants"
```

#### batch_pathogenicity_filter
Filter variants by pathogenicity threshold.
```
"Use alphagenome to filter these 100 variants for pathogenicity > 0.7"
```

### Regulatory Annotation

#### annotate_regulatory_context
Comprehensive regulatory context.
```
"Use alphagenome to annotate regulatory context of rs429358"
```

#### predict_allele_specific_effects
Allele-specific regulatory effects.
```
"Use alphagenome to show allele-specific effects for rs429358"
```

### Clinical Reporting

#### generate_variant_report
Comprehensive clinical report.
```
"Use alphagenome to generate a clinical report for rs429358"
```

#### explain_variant_impact
Human-readable explanation.
```
"Use alphagenome to explain the impact of rs429358 in simple terms"
```

## Installation

### Requirements

- Node.js ≥18.0.0
- Python ≥3.8
- AlphaGenome API key from Google DeepMind
- Python packages: `alphagenome`, `numpy`

### Setup

1. **Install Python dependencies:**
```bash
pip install alphagenome numpy
```

2. **Install via npm (recommended):**
```bash
claude mcp add alphagenome -- npx -y @jolab/alphagenome-mcp@latest --api-key YOUR_API_KEY
```

3. **Or configure manually:**

Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "alphagenome": {
      "command": "npx",
      "args": ["-y", "@jolab/alphagenome-mcp@latest"],
      "env": {
        "ALPHAGENOME_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Verification

Test in Claude Desktop:
```
"Use alphagenome to analyze chr19:44908684T>C"
```

Expected: Detailed regulatory impact report within 30-60 seconds.

**Important:** Always include "use alphagenome" in queries to explicitly invoke the server.

## Usage Examples

All examples show actual API results from tests with Alzheimer's disease variants.

### Pathogenicity Assessment
```
User: "Use alphagenome to assess the pathogenicity of rs429358"
```
**Result:**
```json
{
  "variant": "chr19:44908684T>C",
  "classification": "PATHOGENIC",
  "pathogenicity_score": 1.0,
  "evidence": {
    "expression_impact": 0.0023,
    "splicing_impact": 0.0263,
    "tf_binding_impact": 24.0
  },
  "recommendation": "Further clinical evaluation recommended"
}
```

### Tissue-Specific Analysis
```
User: "Use alphagenome to compare rs429358 effects in brain and liver"
```
**Result:**
```json
{
  "variant": "chr19:44908684T>C",
  "tissue_results": {
    "brain": {
      "expression_impact": -0.0023,
      "impact_level": "high"
    },
    "liver": {
      "expression_impact": 0.0007,
      "impact_level": "high"
    }
  }
}
```
**Interpretation:** Tissue-differential effects. Brain shows downregulation (-0.23%) while liver shows upregulation (+0.07%).

### Variant Comparison
```
User: "Use alphagenome to compare APOE ε4 (rs429358) vs ε2 (rs7412)"
```
**Result:**
```json
{
  "variant1": {
    "id": "chr19:44908684T>C",
    "impact": "high",
    "expression_fc": -0.0023
  },
  "variant2": {
    "id": "chr19:44908822C>T",
    "impact": "high",
    "expression_fc": 0.0012
  },
  "comparison": {
    "more_severe": "chr19:44908684T>C"
  }
}
```

### TF Binding Analysis
```
User: "Use alphagenome to show TF binding changes for rs429358"
```
**Result:**
```json
{
  "variant": "chr19:44908684T>C",
  "tf_binding": [{
    "change": 24.0
  }],
  "impact_level": "high"
}
```

### Allele Comparison
```
User: "Use alphagenome to compare T>C, T>G, T>A at chr19:44908684"
```
**Result:**
```json
{
  "position": "chr19:44908684",
  "allele_comparisons": {
    "T>C": { "expression_fc": -0.0023, "impact": "high" },
    "T>G": { "expression_fc": -0.0038, "impact": "high" },
    "T>A": { "expression_fc": 0.0035, "impact": "high" }
  }
}
```
**Interpretation:** All three alternative alleles show high regulatory impact with varying expression effects.

### Clinical Report
```
User: "Use alphagenome to generate a clinical report for rs429358"
```
**Result:**
```
VARIANT REPORT: chr19:44908684T>C (rs429358)

Classification: PATHOGENIC
Pathogenicity Score: 1.0

Evidence Summary:
- Expression Impact: 0.0023 (fold change)
- Splicing Impact: 0.0263 (delta score)
- TF Binding Impact: 24.0 (change score)

Recommendation: Further clinical evaluation recommended
```

## Performance

- **First call**: 30-60 seconds (initialization)
- **Subsequent calls**: 8-15 seconds per variant
- **Batch processing**: ~7 seconds per variant
- **Recommended**: <100 variants per session for interactive use
- **Modalities**: 11 (RNA-seq, CAGE, PRO-cap, splice sites, DNase, ATAC, histone mods, TF binding, contact maps)
- **Resolution**: Single base-pair for most modalities

## Limitations

### Technical Limitations
- **Internet required**: Active connection and API access needed
- **Variant types**: Single nucleotide variants (SNVs) only; InDels and structural variants not fully supported
- **Genomic distance**: Accuracy decreases for regulatory elements >100kb from transcription start sites
- **Species**: Human (GRCh38) and mouse genomes only
- **API dependency**: Performance depends on AlphaGenome API availability

### Research vs Clinical Use
- **Research tool only**: Not validated for clinical diagnostics
- **No clinical validation**: Predictions require validation by qualified professionals
- **Not FDA approved**: Should not be used for clinical diagnosis or treatment decisions
- **Sample size**: Current demonstrations use 4 test variants (minimal functional verification)
- **No accuracy benchmarking**: Comparative studies with other tools not performed

### Interface Limitations
- **API key required**: Must obtain AlphaGenome API access from Google DeepMind
- **MCP client needed**: Requires Claude Desktop or compatible MCP client
- **Natural language variability**: Query interpretation may vary
- **Error recovery**: While conversational error recovery is possible, some errors require API-level debugging

### Known Issues
- Response time variability depending on variant complexity
- Memory usage increases with large batch operations
- Tissue types limited to UBERON ontology terms
- No support for custom genome assemblies

## Use Cases

### Research Applications (Appropriate)
- Post-GWAS variant prioritization
- Exploratory functional genomics
- Regulatory element characterization
- Variant effect hypothesis generation
- Educational demonstrations

### Clinical Applications (Not Appropriate)
- ❌ Clinical diagnosis
- ❌ Treatment decisions
- ❌ Genetic counseling without additional validation
- ❌ Population screening

## Development

### Build from Source

```bash
git clone https://github.com/taehojo/alphagenome-mcp.git
cd alphagenome-mcp
npm install
pip install -r requirements.txt
npm run build
```

### Project Structure

```
src/
├── index.ts              # MCP server entry point
├── alphagenome-client.ts # API client (Python bridge)
├── tools.ts              # MCP tool definitions
├── types.ts              # TypeScript type definitions
└── utils/
    ├── validation.ts     # Input validation (Zod schemas)
    └── formatting.ts     # Output formatting
scripts/
└── alphagenome_bridge.py # Python bridge to AlphaGenome SDK
```

### Testing

```bash
npm run lint           # ESLint check
npm run typecheck      # TypeScript type checking
npm run build          # Compile to build/
```

## Citation

If you use this software in your research, please cite:

```bibtex
@software{jo2025alphagenome_mcp,
  author = {Jo, Taeho},
  title = {AlphaGenome MCP Server},
  year = {2025},
  url = {https://github.com/taehojo/alphagenome-mcp},
  version = {0.2.0}
}
```

AlphaGenome model:
```bibtex
@article{avsec2025alphagenome,
  title = {AlphaGenome: advancing regulatory variant effect prediction with a unified DNA sequence model},
  author = {Avsec, Žiga and Latysheva, Natasha and Cheng, Jun and others},
  journal = {bioRxiv},
  year = {2025}
}
```

## Acknowledgments

- **Google DeepMind** for developing and providing access to the AlphaGenome API
- **Anthropic** for developing the Model Context Protocol specification and Claude Desktop

## License

MIT License - Copyright (c) 2025 Taeho Jo

See [LICENSE](LICENSE) file for details.

## Links

- **npm Package**: https://www.npmjs.com/package/@jolab/alphagenome-mcp
- **GitHub Repository**: https://github.com/taehojo/alphagenome-mcp
- **Issue Tracker**: https://github.com/taehojo/alphagenome-mcp/issues
- **AlphaGenome**: https://deepmind.google/discover/blog/alphagenome/
- **Model Context Protocol**: https://modelcontextprotocol.io/
- **Claude Desktop**: https://claude.ai/download

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Support

- **Issues**: https://github.com/taehojo/alphagenome-mcp/issues
- **Discussions**: https://github.com/taehojo/alphagenome-mcp/discussions
