# AlphaGenome MCP Server

[![npm version](https://badge.fury.io/js/%40jolab%2Falphagenome-mcp.svg)](https://www.npmjs.com/package/@jolab/alphagenome-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

A Model Context Protocol (MCP) server providing programmatic access to Google DeepMind's AlphaGenome for computational genomics research and variant analysis.

## Overview

This server implements the Model Context Protocol to integrate AlphaGenome's deep learning-based genomic prediction capabilities with Claude Desktop and other MCP-compatible clients. AlphaGenome leverages transformer architectures trained on large-scale genomic datasets to predict regulatory effects of genetic variants across multiple modalities.

### Scientific Capabilities

**Variant Effect Prediction**
- Quantitative prediction of regulatory impact on gene expression (RNA-seq)
- Splice site disruption analysis and alternative splicing predictions
- Transcription factor binding affinity changes (ChIP-seq)
- Chromatin accessibility alterations (ATAC-seq, DNase-seq)
- Histone modification pattern changes (ChIP-seq for histone marks)

**Regulatory Element Discovery**
- *De novo* identification of promoter regions
- Enhancer-promoter interaction prediction
- Transcription factor binding site (TFBS) annotation
- Chromatin state segmentation analysis

**High-Throughput Variant Prioritization**
- Batch processing of variants from GWAS or sequencing studies
- Regulatory impact scoring and ranking
- Integration of multiple functional predictions

## Technical Architecture

### System Components

```
Claude Desktop (or MCP client)
    ↓ stdio
MCP Server (TypeScript/Node.js)
    ↓ subprocess
Python Bridge
    ↓ API calls
AlphaGenome SDK (Python)
    ↓ HTTPS
Google DeepMind AlphaGenome API
```

The server uses a subprocess-based Python bridge to interface with the AlphaGenome Python SDK, as the official API is Python-only. All predictions are performed by Google DeepMind's hosted AlphaGenome model.

### Implementation Details

- **MCP Protocol**: Full implementation of Anthropic's Model Context Protocol specification
- **Input Validation**: Zod-based schema validation for genomic coordinates and parameters
- **Error Handling**: Comprehensive error propagation from API through to client
- **Output Formatting**: Structured Markdown formatting for variant reports

## Installation

### Requirements

- Node.js ≥18.0.0
- Python ≥3.8
- AlphaGenome API key (obtain from Google DeepMind)

### Python Dependencies

```bash
pip install alphagenome numpy
```

### MCP Server Installation

```bash
# Global installation
npm install -g @jolab/alphagenome-mcp

# Or use via npx (no installation required)
npx @jolab/alphagenome-mcp
```

### Configuration

#### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "alphagenome": {
      "command": "npx",
      "args": ["-y", "@jolab/alphagenome-mcp"],
      "env": {
        "ALPHAGENOME_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Alternatively, use the Claude CLI:

```bash
claude mcp add alphagenome -- npx -y @jolab/alphagenome-mcp --api-key YOUR_API_KEY
```

#### Standalone Usage

```bash
ALPHAGENOME_API_KEY=your-key node build/index.js
# Or with command-line argument
node build/index.js --api-key your-key
```

## Usage

### Variant Analysis Example

```
Analyze the regulatory impact of chr17:41234567A>T
```

This queries the AlphaGenome API to predict:
- Gene expression changes (log2 fold change)
- Splice site alterations
- Transcription factor binding disruptions
- Clinical significance assessment

### Regulatory Region Analysis

```
Identify regulatory elements in chr11:5225464-5227071
```

Returns predicted locations and strengths of:
- Promoters
- Enhancers
- Transcription factor binding sites
- Chromatin states

### Batch Variant Scoring

```
Score the following variants by regulatory impact:
chr7:117199563C>T
chr13:32910000G>A
chr19:1220000A>C
```

Performs high-throughput analysis and returns variants ranked by predicted functional impact.

## Development

### Building from Source

```bash
git clone https://github.com/taehojo/alphagenome-mcp.git
cd alphagenome-mcp

# Install dependencies
npm install
pip install -r requirements.txt

# Build TypeScript
npm run build

# Run development server
npm run dev
```

### Project Structure

```
alphagenome-mcp/
├── src/
│   ├── index.ts              # MCP server implementation
│   ├── alphagenome-client.ts # AlphaGenome API client
│   ├── tools.ts              # MCP tool definitions
│   ├── types.ts              # TypeScript type definitions
│   └── utils/
│       ├── validation.ts     # Zod validation schemas
│       └── formatting.ts     # Output formatting
├── scripts/
│   └── alphagenome_bridge.py # Python bridge to AlphaGenome SDK
├── tests/                     # Unit and integration tests
└── docs/                      # Additional documentation
```

### Testing

```bash
npm run lint        # ESLint type checking
npm run typecheck   # TypeScript compilation check
npm test            # Run test suite
```

## API Reference

### MCP Tools

#### `predict_variant_effect`

Predicts regulatory impact of a single nucleotide variant.

**Parameters:**
- `chromosome`: string (format: chr1-chr22, chrX, chrY)
- `position`: integer (1-based genomic coordinate)
- `ref`: string (reference allele: A, T, G, C)
- `alt`: string (alternate allele: A, T, G, C)
- `output_types`: array (optional: specific modalities to analyze)
- `tissue_type`: string (optional: tissue context for predictions)

#### `analyze_region`

Analyzes a genomic region for regulatory elements.

**Parameters:**
- `chromosome`: string
- `start`: integer (1-based start position)
- `end`: integer (1-based end position)
- `analysis_types`: array (optional: element types to identify)
- `resolution`: string (base or window resolution)

#### `batch_score_variants`

Scores multiple variants and ranks by regulatory impact.

**Parameters:**
- `variants`: array of variant objects
- `scoring_metric`: string (rna_seq, splice, regulatory_impact, combined)
- `top_n`: integer (number of top variants to return)

## Scientific Applications

This tool is designed for:

- **Post-GWAS Analysis**: Functional interpretation of genome-wide association study findings
- **Clinical Variant Interpretation**: Assessment of regulatory variants in diagnostic sequencing
- **Regulatory Genomics Research**: Investigation of gene regulation mechanisms
- **Precision Medicine**: Identification of regulatory variants affecting drug response
- **Evolutionary Genomics**: Analysis of regulatory sequence conservation and divergence

## Citations

If you use this tool in your research, please cite:

- AlphaGenome: [Google DeepMind's AlphaGenome publication](https://deepmind.google/discover/blog/alphagenome/)
- Model Context Protocol: [Anthropic MCP Documentation](https://modelcontextprotocol.io/)

## License

MIT License - see [LICENSE](LICENSE) file for details.

Copyright (c) 2025 Taeho Jo

## Technical Support

- **Issues**: [GitHub Issues](https://github.com/taehojo/alphagenome-mcp/issues)
- **Email**: taehjo@gmail.com
- **Repository**: [github.com/taehojo/alphagenome-mcp](https://github.com/taehojo/alphagenome-mcp)

## Acknowledgments

This project implements the Model Context Protocol specification by Anthropic and provides programmatic access to Google DeepMind's AlphaGenome AI model for genomic variant analysis.
