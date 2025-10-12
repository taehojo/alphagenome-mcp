# AlphaGenome MCP Server

[![npm version](https://badge.fury.io/js/%40jolab%2Falphagenome-mcp.svg)](https://www.npmjs.com/package/@jolab/alphagenome-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

A Model Context Protocol server providing programmatic access to Google DeepMind's AlphaGenome for computational genomics research and variant analysis.

## Overview

This server integrates AlphaGenome's deep learning-based predictions with Claude Desktop via the Model Context Protocol. AlphaGenome uses transformer architectures trained on large-scale genomic datasets to predict regulatory effects across multiple modalities including RNA-seq, ChIP-seq, ATAC-seq, and chromatin accessibility.

### Capabilities

- **Variant Effect Prediction**: Quantitative assessment of regulatory impact on gene expression, splicing, transcription factor binding, and chromatin accessibility
- **Regulatory Element Discovery**: Identification of promoters, enhancers, TFBS, and chromatin states
- **Variant Prioritization**: High-throughput scoring and ranking for GWAS and sequencing studies

### Architecture

```
Claude Desktop → stdio → MCP Server → subprocess → Python Bridge → AlphaGenome API
```

The server uses a Python bridge to interface with AlphaGenome's Python-only SDK.

## Installation

### Requirements

- Node.js ≥18.0.0
- Python ≥3.8 with `alphagenome` and `numpy`
- AlphaGenome API key

### Setup

```bash
# Install Python dependencies
pip install alphagenome numpy

# Configure Claude Desktop
claude mcp add alphagenome -- npx -y @jolab/alphagenome-mcp --api-key YOUR_API_KEY
```

Alternatively, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "alphagenome": {
      "command": "npx",
      "args": ["-y", "@jolab/alphagenome-mcp"],
      "env": {"ALPHAGENOME_API_KEY": "your-api-key-here"}
    }
  }
}
```

## Usage

### Examples

**Variant Analysis**
```
Analyze the regulatory impact of chr17:41234567A>T
```

**Region Analysis**
```
Identify regulatory elements in chr11:5225464-5227071
```

**Batch Scoring**
```
Score these variants by regulatory impact: chr7:117199563C>T, chr13:32910000G>A, chr19:1220000A>C
```

## Development

```bash
git clone https://github.com/taehojo/alphagenome-mcp.git
cd alphagenome-mcp
npm install && pip install -r requirements.txt
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

## API

### Tools

- `predict_variant_effect(chromosome, position, ref, alt, [output_types], [tissue_type])`
- `analyze_region(chromosome, start, end, [analysis_types], [resolution])`
- `batch_score_variants(variants[], scoring_metric, [top_n])`

## Applications

Designed for post-GWAS analysis, clinical variant interpretation, regulatory genomics research, precision medicine, and evolutionary genomics studies.

## Citation

If you use this tool in research, please cite:
- AlphaGenome: https://deepmind.google/discover/blog/alphagenome/
- Model Context Protocol: https://modelcontextprotocol.io/

## License

MIT License - Copyright (c) 2025 Taeho Jo

## Support

- Issues: [GitHub Issues](https://github.com/taehojo/alphagenome-mcp/issues)
- Email: taehjo@gmail.com
- Repository: https://github.com/taehojo/alphagenome-mcp
