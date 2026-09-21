# AlphaGenome MCP Server - API Documentation

> **Outdated.** This page describes version 0.1 and has not been updated: it documents a tool that no longer exists (`analyze_region`) and output fields (impact levels, clinical interpretation, recommendations) that were removed in 0.3.0. The current tools, parameters and outputs are in the [README](../README.md) and the [CHANGELOG](../CHANGELOG.md). Results are model predictions for research prioritization, not clinical classifications.

⚠️ **MOCK MODE**: Currently uses simulated data. Real AlphaGenome API integration pending.

## Available Tools

### 1. predict_variant_effect

Predict the regulatory impact of a single genetic variant.

**Tool Name**: `predict_variant_effect`

**Input Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chromosome` | string | Yes | Chromosome (chr1-chr22, chrX, chrY) |
| `position` | number | Yes | Genomic position (1-based, positive integer) |
| `ref` | string | Yes | Reference allele (A, T, G, or C) |
| `alt` | string | Yes | Alternate allele (A, T, G, or C) |
| `output_types` | string[] | No | Specific analyses to run |
| `tissue_type` | string | No | Tissue context (UBERON term) |

**Output Types** (optional):
- `rna_seq`: RNA expression changes
- `cage`: CAGE-seq signals
- `splice`: Splicing predictions
- `histone`: Histone modification changes
- `tf_binding`: Transcription factor binding alterations
- `dnase`: DNase hypersensitivity
- `atac`: ATAC-seq signals
- `contact_map`: 3D chromatin interactions

**Example Usage**:
```
"Use AlphaGenome to analyze the variant chr17:41234567A>T"
```

**Output**: Markdown report with:
- Regulatory impact summary table
- RNA expression analysis
- Splicing predictions
- TF binding site disruptions
- Clinical interpretation
- Recommendations

---

### 2. analyze_region

Identify regulatory elements in a genomic region.

**Tool Name**: `analyze_region`

**Input Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chromosome` | string | Yes | Chromosome (chr1-chr22, chrX, chrY) |
| `start` | number | Yes | Start position (1-based) |
| `end` | number | Yes | End position (must be > start + 1000) |
| `analysis_types` | string[] | No | Specific element types to find |
| `resolution` | string | No | "base" (1bp) or "window" (128bp) |

**Analysis Types** (optional):
- `promoter`: Promoter regions
- `enhancer`: Enhancer elements
- `silencer`: Silencer regions
- `tf_binding`: TF binding sites
- `chromatin_state`: Chromatin state annotations

**Constraints**:
- Minimum region size: 1kb (1,000 bp)
- Maximum region size: 1Mb (1,000,000 bp)
- Optimal range: 10kb - 100kb

**Example Usage**:
```
"Find regulatory elements in chr11:5225464-5227071"
```

**Output**: Markdown report with:
- Promoter locations and scores
- Enhancer positions and target genes
- TF binding site catalog
- Chromatin state map

---

### 3. batch_score_variants

Score and prioritize multiple variants.

**Tool Name**: `batch_score_variants`

**Input Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `variants` | Variant[] | Yes | List of 1-100 variants |
| `scoring_metric` | string | Yes | Metric for scoring |
| `top_n` | number | No | Number of top variants to return (default: 10) |
| `include_interpretation` | boolean | No | Include detailed interpretation (default: false) |

**Variant Object**:
```typescript
{
  chromosome: string;
  position: number;
  ref: string;
  alt: string;
  variant_id?: string;  // Optional: e.g., "rs12345"
}
```

**Scoring Metrics**:
- `rna_seq`: Rank by gene expression changes
- `splice`: Rank by splicing impact
- `regulatory_impact`: Combined regulatory score
- `combined`: All metrics weighted

**Example Usage**:
```
"Score these variants by regulatory impact:
- chr7:117199563C>T
- chr13:32910000G>A
- chr19:1220000A>C
Show me the top 3"
```

**Output**: Markdown report with:
- Top variants ranked table
- Impact distribution histogram
- Prioritization recommendations
- Optional detailed analysis for top variants

---

## Error Handling

All tools return MCP errors with appropriate error codes:

| Error Type | Error Code | Description |
|------------|------------|-------------|
| Invalid Parameters | `InvalidParams` | Input validation failed |
| API Key Error | `InternalError` | Missing or invalid API key |
| Rate Limit | `InternalError` | API rate limit exceeded |
| Network Error | `InternalError` | Unable to connect to API |
| Unknown Tool | `MethodNotFound` | Tool name not recognized |

**Error Response Format**:
```json
{
  "error": {
    "code": "InvalidParams",
    "message": "Validation error:\nchromosome: Invalid chromosome format"
  }
}
```

---

## Input Validation

### Chromosome Format
- Pattern: `^chr([1-9]|1[0-9]|2[0-2]|X|Y)$`
- Valid: `chr1`, `chr17`, `chrX`, `chrY`
- Invalid: `1`, `Chr1`, `chr23`, `chrM`

### Position
- Must be positive integer (≥ 1)
- No commas or separators
- Example: `41234567` (not `41,234,567`)

### Alleles (ref/alt)
- Only A, T, G, C allowed (case-insensitive)
- Converted to uppercase automatically
- ref ≠ alt (must be different)

### Region Size
- `end` > `start`
- `end - start` ≥ 1000 (minimum 1kb)
- `end - start` ≤ 1000000 (maximum 1Mb)

---

## Output Formats

All tools return results as Markdown text for easy reading in Claude.

### Common Features
- 🧬 Emoji indicators for quick visual parsing
- Tables for structured data
- Color-coded impact levels (🔴 High, 🟡 Moderate, 🟢 Low)
- Detailed analysis sections
- Clinical recommendations
- Important disclaimers

### Markdown Structure
```markdown
# 🧬 [Tool Name] Analysis

⚠️ **MOCK DATA**: Disclaimer

**Key Info**: Values

---

## 📊 Summary Section

[Tables and key findings]

---

## 🔬 Detailed Analysis

[In-depth results]

---

## ⚠️ Disclaimers

[Important notes]

---

*Footer with links*
```

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ALPHAGENOME_API_KEY` | Yes* | - | API key (use "mock" for testing) |
| `ALPHAGENOME_BASE_URL` | No | `https://api.alphagenome.deepmind.com/v1` | API endpoint |
| `USE_MOCK_API` | No | `false` | Force mock mode |

*Required except in mock mode

### Claude Desktop Configuration

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "alphagenome": {
      "command": "node",
      "args": ["/absolute/path/to/build/index.js"],
      "env": {
        "ALPHAGENOME_API_KEY": "mock"
      }
    }
  }
}
```

---

## Rate Limits

(Future: When real API is available)

- Automatic retry with exponential backoff
- Respects `Retry-After` headers
- Maximum 3 retry attempts
- 30-second timeout per request

---

## Best Practices

### For Variant Analysis
1. Start with single variant prediction
2. Check clinical databases (ClinVar, COSMIC) for known variants
3. Use batch scoring for large-scale prioritization
4. Validate computational predictions experimentally

### For Region Analysis
1. Use optimal region size (10-100kb)
2. Focus on gene regulatory regions
3. Cross-reference with ENCODE data
4. Consider tissue-specific context

### For Batch Scoring
1. Pre-filter variants by frequency (e.g., < 1%)
2. Use appropriate scoring metric for your analysis
3. Set reasonable `top_n` (10-20 for initial screening)
4. Follow up high-impact variants individually

---

## Troubleshooting

### Common Issues

**"Validation error: Invalid chromosome"**
- Ensure format is `chrN` (e.g., `chr17`, not `17`)

**"Region must be at least 1kb"**
- Check that `end - start >= 1000`

**"Maximum 100 variants allowed"**
- Split your variant list into smaller batches

**"Reference and alternate alleles must be different"**
- Verify ref ≠ alt in your input

---

## Support

- **GitHub Issues**: https://github.com/taehojo/alphagenome-mcp/issues
- **Documentation**: https://github.com/taehojo/alphagenome-mcp#readme
- **Email**: taehjo@gmail.com
