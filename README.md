# AlphaGenome MCP Server

[![npm version](https://badge.fury.io/js/%40jolab%2Falphagenome-mcp.svg)](https://www.npmjs.com/package/@jolab/alphagenome-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An MCP server that provides natural language access to Google DeepMind's AlphaGenome for regulatory genomics analysis and variant effect prediction.

## Features

- **Variant Effect Prediction**: Analyze regulatory impacts of genetic variants across 11 molecular modalities (RNA-seq, ChIP-seq, ATAC-seq, splicing, etc.)
- **Regulatory Element Discovery**: Identify promoters, enhancers, and transcription factor binding sites in genomic regions
- **Batch Variant Scoring**: Prioritize multiple variants by regulatory impact for GWAS and sequencing studies
- **Natural Language Interface**: Query variants using rsIDs or genomic coordinates without coding
- **Multi-Modal Analysis**: Unified predictions for gene expression, chromatin accessibility, TF binding, and 3D chromatin structure

## Tools

### predict_variant_effect

Predicts the regulatory impact of a single genetic variant.

**Inputs:**
- `chromosome` (string): Chromosome name (chr1-chr22, chrX, chrY)
- `position` (number): Genomic position (1-based)
- `ref` (string): Reference allele (A/T/G/C)
- `alt` (string): Alternate allele (A/T/G/C)
- `tissue_type` (string, optional): Tissue context (UBERON term, e.g., "UBERON:0000955" for brain)
- `output_types` (array, optional): Specific modalities to analyze

**Example:**
```
"Analyze the regulatory impact of chr19:44908684T>C in brain tissue"
```

### analyze_region

Identifies regulatory elements in a genomic region.

**Inputs:**
- `chromosome` (string): Chromosome name
- `start` (number): Start position (1-based)
- `end` (number): End position
- `analysis_types` (array, optional): Element types to find (promoter, enhancer, etc.)
- `resolution` (string, optional): "base" (1bp) or "window" (128bp)

**Example:**
```
"Find enhancers in chr11:5225464-5227071"
```

### batch_score_variants

Scores and ranks multiple variants by regulatory impact.

**Inputs:**
- `variants` (array): List of variants with chr, pos, ref, alt
- `scoring_metric` (string): Metric for ranking (rna_seq, splice, regulatory_impact, combined)
- `top_n` (number, optional): Number of top variants to return
- `include_interpretation` (boolean, optional): Include clinical interpretation

**Example:**
```
"Score these variants by splicing impact: chr7:117199563C>T, chr2:127892810G>A"
```

## Installation

### Requirements

- Node.js ≥18.0.0
- Python ≥3.8 with `alphagenome` and `numpy`
- AlphaGenome API key ([request here](https://deepmind.google/discover/blog/alphagenome/))

### Quick Start

```bash
# Install Python dependencies
pip install alphagenome numpy

# Add to Claude Desktop
claude mcp add alphagenome -- npx -y @jolab/alphagenome-mcp@latest --api-key YOUR_API_KEY
```

## Configuration

### Usage with Claude Desktop

Add to your `claude_desktop_config.json`:

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

Or use command-line argument:

```json
{
  "mcpServers": {
    "alphagenome": {
      "command": "npx",
      "args": [
        "-y",
        "@jolab/alphagenome-mcp@latest",
        "--api-key",
        "your-api-key-here"
      ]
    }
  }
}
```

### Verification

Test the installation:
```
"Analyze chr19:44908684T>C with AlphaGenome"
```

Expected: Detailed regulatory impact report within 30-60 seconds.

## Usage Examples

### Basic Analysis

**Single Variant:**
```
"What is the regulatory impact of rs429358?"
```

**Specific Tissue:**
```
"Analyze chr6:41129252C>T in brain tissue"
```

**Custom Modalities:**
```
"Show only RNA-seq and splicing effects for chr2:127892810G>A"
```

### Advanced Queries

**Region Exploration:**
```
"Find all regulatory elements in the APOE gene region"
```

**Variant Prioritization:**
```
"Rank these 10 variants by their impact on gene expression"
```

**Cross-Tissue Comparison:**
```
"Compare the effect of this variant in brain vs liver"
```

**Mechanistic Investigation:**
```
"Which transcription factors are affected by rs744373?"
```

## Use Cases

- **Post-GWAS Analysis**: Prioritize GWAS hits by functional impact
- **Clinical Interpretation**: Assess pathogenicity of VUS (variants of uncertain significance)
- **Drug Target Discovery**: Identify regulatory variants affecting target genes
- **Synthetic Biology**: Design tissue-specific regulatory elements
- **Evolutionary Genomics**: Analyze regulatory changes across species

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
├── index.ts              # MCP server
├── alphagenome-client.ts # API client
├── tools.ts              # Tool definitions
└── utils/                # Validation & formatting
scripts/
└── alphagenome_bridge.py # Python bridge
```

### Testing

```bash
npm run lint
npm run typecheck
npm run build
```

## Architecture

```
Claude Desktop → MCP Server (TypeScript) → Python Bridge → AlphaGenome API
```

The server uses a Python subprocess bridge to interface with AlphaGenome's Python-only SDK.

## Performance

- **First call**: 30-60 seconds (initialization)
- **Subsequent calls**: 5-15 seconds
- **Recommended**: <1000 variants per session
- **Modalities**: 11 (RNA-seq, CAGE, PRO-cap, splice sites, DNase, ATAC, histone mods, TF binding, contact maps)
- **Resolution**: Single base-pair for most modalities

## Limitations

- Requires active internet and API access
- InDels and structural variants not fully supported
- Accuracy decreases for regulatory elements >100kb from TSS
- Human and mouse genomes only
- Research use only (not validated for clinical diagnostics)

## Citation

```bibtex
@software{jo2025alphagenome_mcp,
  author = {Jo, Taeho},
  title = {AlphaGenome MCP Server},
  year = {2025},
  url = {https://github.com/taehojo/alphagenome-mcp},
  version = {0.1.5}
}
```

AlphaGenome:
```bibtex
@article{avsec2025alphagenome,
  title = {AlphaGenome: Unified prediction of variant effects},
  author = {Avsec, Žiga and Latysheva, Natasha and Cheng, Jun and others},
  journal = {bioRxiv},
  year = {2025},
  doi = {10.1101/2025.06.27.600757}
}
```

## License

MIT License - Copyright (c) 2025 Taeho Jo

## Links

- **npm**: https://www.npmjs.com/package/@jolab/alphagenome-mcp
- **GitHub**: https://github.com/taehojo/alphagenome-mcp
- **Issues**: https://github.com/taehojo/alphagenome-mcp/issues
- **AlphaGenome**: https://deepmind.google/discover/blog/alphagenome/
- **Model Context Protocol**: https://modelcontextprotocol.io/
