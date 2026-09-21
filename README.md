# AlphaGenome MCP Server

<p align="center">
  <a href="#english">English</a> •
  <a href="#korean">한국어</a>
</p>

[![npm version](https://badge.fury.io/js/%40jolab%2Falphagenome-mcp.svg)](https://www.npmjs.com/package/@jolab/alphagenome-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<div id="english">

AlphaGenome as a tool for Claude agents. A Model Context Protocol (MCP) server that lets an agent turn a researcher's question into an AlphaGenome analysis.

> **한국어 요약:** AlphaGenome을 Claude 에이전트의 도구로 만드는 MCP 서버입니다. 에이전트가 연구자의 질문을 분석으로 바꿉니다. 단일 염기 변이는 미리 계산된 AlphaGenome Atlas에서 즉시 조회하고, indel, 다염기 변이, 변이 조합, 사용자 서열은 실시간 추론으로 처리합니다. 어느 쪽에서 답했는지 항상 결과에 표시합니다. [한국어 전체 문서 보기](#korean)

## Overview

A researcher asks a question; the agent decides which AlphaGenome calls answer it, runs them, and reads the results back. This server gives the agent the two ways AlphaGenome can be asked:

- **The AlphaGenome Atlas** for single-nucleotide variants. The Atlas holds precomputed predictions for every possible single-nucleotide substitution in the human genome, so a lookup answers in seconds and a whole region can be ranked without running the model.
- **Live inference** for everything the Atlas does not hold: indels, multi-nucleotide variants, combinations of variants, custom sequences.

The server chooses between the two automatically, and **every result states its source** (`source: atlas` or `source: live`), so a precomputed score is never mistaken for a fresh model call or the other way round.

**Key Features:**
- **Atlas first**: single-nucleotide variants are answered from the precomputed Atlas; live inference runs only when it is needed
- **Always says where the answer came from**: `source: atlas`, `source: live`, or `source: live (atlas fallback: <reason>)`
- **Region scans without the model**: rank every substitution in up to 50,000 bp by the AlphaGenome Variant Impact (AVI) score
- **24 tools**: 4 Atlas tools and 20 live-inference tools
- **Comprehensive Analysis**: Access all AlphaGenome modalities (RNA-seq, ChIP-seq, ATAC-seq, splicing, etc.)
- **Research Tool**: Designed for exploratory genomics research and variant prioritization

## ⚡ Quick Start

**Get started in 3 minutes:**

1. **Install dependencies**
   ```bash
   pip install alphagenome numpy
   ```

2. **Add to your MCP client** (supports Claude Code, Claude Desktop, Gemini CLI, Cursor, Windsurf)
   ```bash
   claude mcp add alphagenome --env ALPHAGENOME_API_KEY=YOUR_API_KEY -- npx -y @jolab/alphagenome-mcp@latest
   ```

   See [Installation](#installation) for other MCP clients.

3. **Run your first query**

   Restart your MCP client and try:
   ```
   "Use alphagenome to analyze chr19:44908684T>C"
   ```

4. **View results**

   This is a single-nucleotide variant, so it is answered from the Atlas in a few seconds and the report starts with `Source: atlas`. An indel would run live inference instead (30-60 seconds) and say `Source: live`.

**Want more?** Check out the [24 tools](#available-tools) below.

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

### Atlas or live inference

| | AlphaGenome Atlas | Live inference |
|---|---|---|
| What it answers | Single-nucleotide substitutions on hg38 (chr1-22, chrX, chrY) | Anything: indels, multi-nucleotide variants, combinations, custom sequences |
| How | Looks up precomputed scores | Runs the AlphaGenome model |
| Typical time | 2-5 seconds per variant, about 7 seconds for a 2,000 bp region | 30-60 seconds per variant |

Three tools choose between the two on their own: `predict_variant_effect`, `assess_pathogenicity` and `batch_score_variants`. They take an optional `source` parameter:

| `source` | Behaviour |
|---|---|
| `auto` (default) | Atlas when `ref` and `alt` are single bases on chr1-22, chrX or chrY; live inference otherwise. If the Atlas does not hold the variant, falls back to live inference and says so: `source: live (atlas fallback: <reason>)` |
| `atlas` | Atlas only. Never falls back; a variant the Atlas cannot answer is an error |
| `live` | Always runs the model |

The fallback is deliberately narrow. It happens only when the Atlas reports that it does not hold the variant. Authentication, rate limit, network and timeout errors are returned as errors, and so is a variant the Atlas rejects: if the reference base does not match hg38, the Atlas says which base it expected, and the server passes that message on instead of running the model on a mistyped variant. In a batch, each variant is routed on its own and the result reports how many came from each source and how many fell back. Atlas scores and live scores are different quantities, so a mixed batch is reported as two separately ranked groups.

### Wrapper Pattern

The 20 live-inference tools are lightweight wrappers around the same `predict_variant()` API endpoint. They differ only in parameter configuration and output formatting:

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

### AlphaGenome Atlas

Precomputed scores, no model call. Every Atlas response is a summary: ranked rows, never a full score matrix. One variant alone is thousands of numbers per scorer (61 genes x 371 tracks for RNA-seq at the APOE locus), so responses are capped at `top_n` rows (default 25, maximum 100) and at 40,000 characters.

#### atlas_list_scorers
The scorers the Atlas serves (22 at the time of writing), with the number of tracks and the assays behind each. Cached for the session.
```
"Which scorers does the AlphaGenome Atlas have?"
```

#### atlas_lookup_variant
Scores of one single-nucleotide variant: the strongest tracks per scorer, ranked by absolute score, with the gene, tissue or cell type, and assay of each.
```
"Look up chr19:44908684 T>C in the AlphaGenome Atlas"
```

#### atlas_lookup_variants
Up to 500 single-nucleotide variants in one call, ranked by absolute score. Variants the Atlas does not hold, and variants it rejects (for example a reference base that does not match hg38), are listed separately with the reason instead of failing the whole call.
```
"Rank these 200 GWAS SNPs by their Atlas scores"
```

#### atlas_scan_region
Every possible single-nucleotide substitution in a region of up to 50,000 bp, ranked by absolute score. Answers "which positions in this region matter most?" without running the model.
```
"Scan chr17:49209289-49211289 and show the 10 substitutions with the largest predicted effect"
```

**Default scorers.** Override with the `scorers` parameter; names come from `atlas_list_scorers`.

| Used for | Default | Why |
|---|---|---|
| One variant (`atlas_lookup_variant`, `predict_variant_effect`) | `AVI_SCORE`, `RNA_SEQ`, `CAGE`, `DNASE`, `CHIP_HISTONE`, `CHIP_TF`, `SPLICE_SITES` | One representative scorer per modality: overall impact, expression, transcription start, accessibility, histone marks, TF binding, splicing |
| Many variants and regions (`atlas_lookup_variants`, `atlas_scan_region`, `batch_score_variants`) | `AVI_SCORE` | One number per variant makes the ranking meaningful and keeps the call inside the API's request quota. Measured on a 2,000 bp scan: `AVI_SCORE` 2 s, `DNASE` 17 s, `CHIP_TF` 86 s |

For `batch_score_variants`, the `scoring_metric` picks the Atlas scorer when `scorers` is not given: `rna_seq` uses `RNA_SEQ`, `splice` uses `SPLICE_SITES`, `regulatory_impact` and `combined` use `AVI_SCORE`.

**About the AVI score.** The AlphaGenome Variant Impact (AVI) score is served by the Atlas API as the scorer `AVI_SCORE`, with its feature attributions as `AVI_SCORE_FEATURE_IMPORTANCE` and `AVI_SCORE_MODEL_FEATURES`. This server reports the stored score and the calibrated value the Atlas stores with it (shown as `Quantile`) exactly as returned. It does not turn them into a pathogenic or benign call: from the Atlas, `assess_pathogenicity` returns `classification: null`.

**Limits to know about.**
- The Atlas API has a requests-per-minute quota, and a region scan uses one request per 32 bp. Long scans wait and retry when the quota is hit. If the time limit (`ALPHAGENOME_TIMEOUT_MS`) is reached first, the result is returned with `Incomplete` and the part of the region that was scanned, never silently truncated.
- Scorers with one row per gene or junction (`RNA_SEQ`, `SPLICE_JUNCTIONS`, ...) return more data per request than the API allows for a region scan. Scan with `AVI_SCORE` first, then look up the top variants with `atlas_lookup_variant`.
- Human reference genome (hg38) only. Positions are 1-based.

### Core Analysis

#### predict_variant_effect
Regulatory impact of a variant. A single-nucleotide variant is answered from the Atlas; an indel or multi-nucleotide variant runs live inference across all 11 modalities. Optional `source` and `scorers`.
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
- Python ≥3.10 (required by the `alphagenome` package)
- `alphagenome` ≥0.9.0 for the Atlas tools
- AlphaGenome API key from Google DeepMind
- Python packages: `alphagenome`, `numpy`

### Environment variables

| Variable | Purpose |
|---|---|
| `ALPHAGENOME_API_KEY` | Your API key. Put it in the `env` block of the MCP client configuration. This is preferred over `--api-key`, which leaves the key in the process list and in shell history |
| `ALPHAGENOME_PYTHON` | Python interpreter to use, for example a virtualenv (`/path/to/venv/bin/python`) or, on Windows, `C:\path\to\venv\Scripts\python.exe`. Without it the server tries `python3`, then `python` |
| `ALPHAGENOME_TIMEOUT_MS` | Time allowed for one call, in milliseconds (default 180000). Raise it for large region scans and batches |

### Setup

**1. Install Python dependencies:**
```bash
pip install alphagenome numpy
```

**2. Configure for your MCP client:**

<details>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add alphagenome --env ALPHAGENOME_API_KEY=YOUR_API_KEY -- npx -y @jolab/alphagenome-mcp@latest
```

This writes the server to `~/.claude.json`. Add `--scope project` to write it to `.mcp.json` in the current project instead.

**Test:**
```
"Use alphagenome to analyze chr19:44908684T>C"
```
</details>

<details>
<summary><b>Claude Desktop</b></summary>

Add to `claude_desktop_config.json`:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "alphagenome": {
      "command": "npx",
      "args": ["-y", "@jolab/alphagenome-mcp@latest"],
      "env": { "ALPHAGENOME_API_KEY": "YOUR_API_KEY" }
    }
  }
}
```

**Test:**
```
"Use alphagenome to analyze chr19:44908684T>C"
```
</details>

<details>
<summary><b>Gemini CLI</b></summary>

Add to `~/.gemini/settings.json`:
```json
{
  "mcpServers": {
    "alphagenome": {
      "command": "npx",
      "args": ["-y", "@jolab/alphagenome-mcp@latest"],
      "env": { "ALPHAGENOME_API_KEY": "YOUR_API_KEY" }
    }
  }
}
```

**Test:**
```
"Use alphagenome to analyze chr19:44908684T>C"
```
</details>

<details>
<summary><b>Cursor</b></summary>

Add to `.cursor/mcp.json` in your project root:
```json
{
  "mcpServers": {
    "alphagenome": {
      "command": "npx",
      "args": ["-y", "@jolab/alphagenome-mcp@latest"],
      "env": { "ALPHAGENOME_API_KEY": "YOUR_API_KEY" }
    }
  }
}
```

**Test:**
```
"Use alphagenome to analyze chr19:44908684T>C"
```
</details>

<details>
<summary><b>Windsurf</b></summary>

Add to your Windsurf settings JSON:
```json
{
  "mcpServers": {
    "alphagenome": {
      "command": "npx",
      "args": ["-y", "@jolab/alphagenome-mcp@latest"],
      "env": { "ALPHAGENOME_API_KEY": "YOUR_API_KEY" }
    }
  }
}
```

**Test:**
```
"Use alphagenome to analyze chr19:44908684T>C"
```
</details>

### Verification

Expected: for a single-nucleotide variant, a report that starts with `Source: atlas` within a few seconds. For an indel, a report that says `Source: live` within 30-60 seconds.

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

- **Atlas**: 2-5 seconds per variant, about 7 seconds for a 2,000 bp region scan (with `AVI_SCORE`)
- **Live inference**: 30-60 seconds per variant
- **Modalities**: 11 (RNA-seq, CAGE, PRO-cap, splice sites, DNase, ATAC, histone mods, TF binding, contact maps)

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
├── alphagenome-client.ts # API client (Python bridge, timeout, interpreter choice)
├── routing.ts            # Atlas or live inference: the rule, as pure functions
├── routed-tools.ts       # The three tools that route, fall back and label the source
├── tools.ts              # MCP tool definitions
├── types.ts              # TypeScript type definitions
├── tests/                # Unit tests (no API key needed)
└── utils/
    ├── config.ts         # Environment variables
    ├── validation.ts     # Input validation (Zod schemas)
    ├── formatting.ts     # Output formatting, live results
    └── atlas-formatting.ts # Output formatting and size cap, Atlas results
scripts/
├── alphagenome_bridge.py # Python bridge to the AlphaGenome SDK (live inference)
└── atlas_actions.py      # Atlas lookups and summaries
```

### Testing

```bash
npm test               # Build, then run the unit tests (no API key needed)
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
- **AlphaGenome**: https://deepmind.google/discover/blog/alphagenome/
- **Model Context Protocol**: https://modelcontextprotocol.io/
- **Claude Desktop**: https://claude.ai/download

</div>

---

<div id="korean">

# AlphaGenome MCP 서버

> AlphaGenome을 Claude 에이전트의 도구로 만드는 MCP 서버

[![npm version](https://badge.fury.io/js/%40jolab%2Falphagenome-mcp.svg)](https://www.npmjs.com/package/@jolab/alphagenome-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 개요

연구자가 질문을 하면, 에이전트가 그 질문에 답하는 AlphaGenome 호출을 정하고 실행한 뒤 결과를 읽어 줍니다. 이 서버는 AlphaGenome에 물어볼 수 있는 두 가지 방법을 에이전트에게 제공합니다.

- **AlphaGenome Atlas**: 단일 염기 변이용. Atlas에는 인간 유전체의 모든 단일 염기 치환에 대한 예측이 미리 계산되어 있어, 조회는 몇 초면 끝나고 구간 전체의 순위도 모델을 돌리지 않고 매길 수 있습니다.
- **실시간 추론**: Atlas에 없는 모든 것. indel, 다염기 변이, 변이 조합, 사용자 서열.

서버가 둘 중 하나를 자동으로 고르며, **모든 결과에 출처를 표시합니다** (`source: atlas` 또는 `source: live`). 미리 계산된 점수와 방금 돌린 모델 결과가 서로 혼동되지 않습니다.

## 주요 기능

- ⚡ **Atlas 우선**: 단일 염기 변이는 미리 계산된 Atlas에서 조회하고, 실시간 추론은 필요할 때만 실행
- 🏷️ **출처 항상 표시**: `source: atlas`, `source: live`, `source: live (atlas fallback: <사유>)`
- 🗺️ **모델 없이 구간 스캔**: 최대 50,000 bp 구간의 모든 치환을 AVI(AlphaGenome Variant Impact) 점수로 순위화
- 🧬 **변이 효과 예측**: 11가지 분자 양식(RNA-seq, ChIP-seq, ATAC-seq, 스플라이싱 등)에서 조절 영향 분석
- 🏥 **병원성 평가**: 임상 점수 산출 및 필터링
- 🔬 **조직별 분석**: 뇌, 간, 심장 등 여러 조직에서의 효과 프로파일링
- 📊 **배치 처리**: 대용량 변이 우선순위 지정
- 💬 **자연어 인터페이스**: 코딩 없이 rsID나 염색체 좌표로 쿼리
- 🔧 **24가지 도구**: Atlas 도구 4개와 실시간 추론 도구 20개

## ⚡ 빠른 시작

**3분 안에 시작하기:**

1. **Python 패키지 설치**
   ```bash
   pip install alphagenome numpy
   ```

2. **MCP 클라이언트에 추가** (Claude Code, Claude Desktop, Gemini CLI, Cursor, Windsurf 지원)
   ```bash
   claude mcp add alphagenome --env ALPHAGENOME_API_KEY=YOUR_API_KEY -- npx -y @jolab/alphagenome-mcp@latest
   ```

   다른 MCP 클라이언트는 [설치 방법](#설치-방법) 참고

3. **첫 번째 쿼리 실행**

   MCP 클라이언트를 재시작하고 다음을 시도하세요:
   ```
   "Use alphagenome to analyze chr19:44908684T>C"
   ```
   또는 한국어로:
   ```
   "alphagenome을 사용해서 chr19:44908684T>C를 분석해줘"
   ```

4. **결과 확인**

   이 변이는 단일 염기 변이이므로 Atlas에서 몇 초 안에 답이 오고, 보고서는 `Source: atlas`로 시작합니다. indel이라면 실시간 추론이 실행되어(30-60초) `Source: live`로 표시됩니다.

**더 알아보기:** [Atlas와 실시간 추론](#atlas와-실시간-추론), [사용 예시](#사용-예시)

## 시스템 구조

```
┌─────────────────────────┐
│  연구자                  │
└───────────┬─────────────┘
            │ 자연어 쿼리
            ↓
┌─────────────────────────┐
│  Claude Desktop         │ ← MCP 클라이언트
└───────────┬─────────────┘
            │ JSON-RPC (stdio)
            ↓
┌─────────────────────────┐
│  MCP 서버 (TypeScript)  │ ← 도구 라우팅, 검증
└───────────┬─────────────┘
            │ subprocess
            ↓
┌─────────────────────────┐
│  Python 브리지          │ ← AlphaGenome SDK 인터페이스
└───────────┬─────────────┘
            │ HTTP
            ↓
┌─────────────────────────┐
│  AlphaGenome API        │ ← Google DeepMind 서비스
└─────────────────────────┘
```

## Atlas와 실시간 추론

| | AlphaGenome Atlas | 실시간 추론 |
|---|---|---|
| 답할 수 있는 것 | hg38의 단일 염기 치환 (chr1-22, chrX, chrY) | 전부: indel, 다염기 변이, 변이 조합, 사용자 서열 |
| 방식 | 미리 계산된 점수 조회 | AlphaGenome 모델 실행 |
| 소요 시간 | 변이당 2-5초, 2,000 bp 구간 약 7초 | 변이당 30-60초 |

`predict_variant_effect`, `assess_pathogenicity`, `batch_score_variants` 세 도구가 둘 중 하나를 스스로 고릅니다. 선택 파라미터 `source`로 바꿀 수 있습니다.

| `source` | 동작 |
|---|---|
| `auto` (기본값) | `ref`와 `alt`가 chr1-22, chrX, chrY의 단일 염기이면 Atlas, 아니면 실시간 추론. Atlas에 해당 변이가 없으면 실시간 추론으로 넘어가고 그 사실을 표시: `source: live (atlas fallback: <사유>)` |
| `atlas` | Atlas만 사용. 다른 곳으로 넘어가지 않으며, Atlas가 답할 수 없는 변이는 오류 |
| `live` | 항상 모델 실행 |

실시간 추론으로 넘어가는 조건은 일부러 좁게 잡았습니다. Atlas가 "이 변이를 가지고 있지 않다"고 답한 경우에만 넘어갑니다. 인증, 호출 한도, 네트워크, 시간 초과 오류는 오류 그대로 돌려줍니다. Atlas가 거부한 변이도 마찬가지입니다. 참조 염기가 hg38과 다르면 Atlas가 기대한 염기를 알려 주므로, 잘못 입력된 변이로 모델을 돌리는 대신 그 메시지를 그대로 전달합니다. 배치에서는 변이마다 따로 경로를 정하고, 각 출처에서 몇 개가 답해졌는지와 몇 개가 넘어갔는지를 결과에 표시합니다. Atlas 점수와 실시간 점수는 서로 다른 양이므로, 섞인 배치는 하나의 순위가 아니라 따로 순위를 매긴 두 묶음으로 보고합니다.

### Atlas 도구

모델을 돌리지 않고 미리 계산된 점수를 조회합니다. 모든 Atlas 응답은 요약입니다. 순위가 매겨진 행만 돌려주며 전체 점수 행렬은 돌려주지 않습니다. 변이 하나만 해도 scorer당 수천 개의 숫자이므로(APOE 위치의 RNA-seq는 유전자 61개 x 트랙 371개), 응답은 `top_n`행(기본 25, 최대 100)과 40,000자로 제한됩니다.

| 도구 | 설명 |
|---|---|
| `atlas_list_scorers` | Atlas가 제공하는 scorer 목록(작성 시점 22개)과 각 scorer의 트랙 수, 실험 종류. 세션 동안 캐시 |
| `atlas_lookup_variant` | 단일 염기 변이 1개의 점수. scorer별로 절대값이 큰 트랙을 유전자, 조직/세포, 실험 종류와 함께 표시 |
| `atlas_lookup_variants` | 단일 염기 변이 최대 500개를 한 번에 조회해 절대값 순으로 순위화. Atlas에 없는 변이와 거부된 변이(예: 참조 염기 불일치)는 전체 호출을 실패시키지 않고 사유와 함께 따로 나열 |
| `atlas_scan_region` | 최대 50,000 bp 구간의 모든 단일 염기 치환을 절대값 순으로 순위화. "이 구간에서 어느 위치가 가장 중요한가"에 모델 없이 답함 |

**기본 scorer.** `scorers` 파라미터로 바꿀 수 있고, 이름은 `atlas_list_scorers`에서 확인합니다.

| 용도 | 기본값 | 이유 |
|---|---|---|
| 변이 1개 (`atlas_lookup_variant`, `predict_variant_effect`) | `AVI_SCORE`, `RNA_SEQ`, `CAGE`, `DNASE`, `CHIP_HISTONE`, `CHIP_TF`, `SPLICE_SITES` | 양식별 대표 scorer 하나씩: 종합 영향, 발현, 전사 시작, 접근성, 히스톤 표지, 전사인자 결합, 스플라이싱 |
| 여러 변이와 구간 (`atlas_lookup_variants`, `atlas_scan_region`, `batch_score_variants`) | `AVI_SCORE` | 변이당 숫자 하나여야 순위가 의미 있고, API 호출 한도 안에 들어옴. 2,000 bp 스캔 실측: `AVI_SCORE` 2초, `DNASE` 17초, `CHIP_TF` 86초 |

`batch_score_variants`에서 `scorers`를 주지 않으면 `scoring_metric`이 Atlas scorer를 정합니다. `rna_seq`는 `RNA_SEQ`, `splice`는 `SPLICE_SITES`, `regulatory_impact`와 `combined`는 `AVI_SCORE`입니다.

**AVI 점수에 대하여.** AVI(AlphaGenome Variant Impact) 점수는 Atlas API에서 `AVI_SCORE` scorer로 제공되며, 특성 기여도는 `AVI_SCORE_FEATURE_IMPORTANCE`와 `AVI_SCORE_MODEL_FEATURES`로 제공됩니다. 이 서버는 저장된 점수와, Atlas가 함께 저장한 보정값(`Quantile`로 표시)을 받은 그대로 보고합니다. 이를 병원성/양성 판정으로 바꾸지 않습니다. Atlas 경로의 `assess_pathogenicity`는 `classification: null`을 돌려줍니다.

**알아둘 제한.**
- Atlas API에는 분당 호출 한도가 있고, 구간 스캔은 32 bp마다 호출 1회를 씁니다. 한도에 걸리면 기다렸다가 다시 시도합니다. 그 전에 시간 제한(`ALPHAGENOME_TIMEOUT_MS`)에 먼저 도달하면, 결과를 몰래 잘라내지 않고 `Incomplete` 표시와 함께 실제로 스캔한 구간을 돌려줍니다.
- 유전자나 접합부마다 행이 있는 scorer(`RNA_SEQ`, `SPLICE_JUNCTIONS` 등)는 요청당 데이터가 API 허용량을 넘어 구간 스캔에 쓸 수 없습니다. 먼저 `AVI_SCORE`로 스캔한 뒤 상위 변이를 `atlas_lookup_variant`로 조회하세요.
- 인간 참조 유전체(hg38)만 지원합니다. 위치는 1부터 셉니다.

## 설치 방법

### 요구사항

- Node.js ≥18.0.0
- Python ≥3.10 (`alphagenome` 패키지 요구사항)
- Atlas 도구에는 `alphagenome` ≥0.9.0
- AlphaGenome API 키 (Google DeepMind에서 발급)
- Python 패키지: `alphagenome`, `numpy`

### 환경 변수

| 변수 | 용도 |
|---|---|
| `ALPHAGENOME_API_KEY` | API 키. MCP 클라이언트 설정의 `env` 블록에 넣으세요. `--api-key`는 키가 프로세스 목록과 셸 기록에 남으므로 `env` 쪽을 권장합니다 |
| `ALPHAGENOME_PYTHON` | 사용할 Python 인터프리터. 예: 가상환경(`/path/to/venv/bin/python`), Windows에서는 `C:\path\to\venv\Scripts\python.exe`. 지정하지 않으면 `python3`, 그다음 `python`을 시도 |
| `ALPHAGENOME_TIMEOUT_MS` | 호출 1회에 허용하는 시간(밀리초, 기본 180000). 큰 구간 스캔이나 배치에서는 늘리세요 |

### 설치

**1. Python 패키지 설치:**
```bash
pip install alphagenome numpy
```

**2. MCP 클라이언트 설정:**

<details>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add alphagenome --env ALPHAGENOME_API_KEY=YOUR_API_KEY -- npx -y @jolab/alphagenome-mcp@latest
```

서버 설정이 `~/.claude.json`에 기록됩니다. `--scope project`를 붙이면 현재 프로젝트의 `.mcp.json`에 기록됩니다.
</details>

<details>
<summary><b>Claude Desktop</b></summary>

`claude_desktop_config.json`에 추가:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "alphagenome": {
      "command": "npx",
      "args": ["-y", "@jolab/alphagenome-mcp@latest"],
      "env": { "ALPHAGENOME_API_KEY": "YOUR_API_KEY" }
    }
  }
}
```

**테스트:**
```
"alphagenome으로 chr19:44908684T>C를 분석해줘"
```
</details>

<details>
<summary><b>Cursor</b></summary>

프로젝트 루트의 `.cursor/mcp.json`에 추가:
```json
{
  "mcpServers": {
    "alphagenome": {
      "command": "npx",
      "args": ["-y", "@jolab/alphagenome-mcp@latest"],
      "env": { "ALPHAGENOME_API_KEY": "YOUR_API_KEY" }
    }
  }
}
```
</details>

## 사용 예시

### 병원성 평가
```
"rs429358의 병원성을 평가해줘"
```

**결과:** 병원성 점수 1.0, 발현 영향 0.0023, 스플라이싱 영향 0.0263

### 조직별 분석
```
"rs429358의 뇌와 간에서의 효과를 비교해줘"
```

**결과:** 뇌에서 -0.23% 하향조절, 간에서 +0.07% 상향조절

### 변이 비교
```
"APOE ε4 (rs429358)와 ε2 (rs7412)를 비교해줘"
```

**결과:** ε4가 더 심각한 영향 (발현 변화 -0.0023 vs +0.0012)

### 스플라이싱 영향
```
"chr6:41129252C>T의 스플라이싱 영향을 분석해줘"
```

### 배치 처리
```
"이 10개 변이를 병원성 점수로 정렬해줘"
```

## 성능

- **Atlas**: 변이당 2-5초, 2,000 bp 구간 스캔 약 7초 (`AVI_SCORE` 기준)
- **실시간 추론**: 변이당 30-60초
- **분석 양식**: 11가지 (RNA-seq, CAGE, PRO-cap, 스플라이스 사이트, DNase, ATAC, 히스톤 변형, 전사인자 결합, 접촉 맵)

## 인용

이 소프트웨어를 연구에 사용하신다면 다음과 같이 인용해주세요:

```bibtex
@software{jo2025alphagenome_mcp,
  author = {Jo, Taeho},
  title = {AlphaGenome MCP Server},
  year = {2025},
  url = {https://github.com/taehojo/alphagenome-mcp},
  version = {0.2.0}
}
```

AlphaGenome 모델:
```bibtex
@article{avsec2025alphagenome,
  title = {AlphaGenome: advancing regulatory variant effect prediction with a unified DNA sequence model},
  author = {Avsec, Žiga and Latysheva, Natasha and Cheng, Jun and others},
  journal = {bioRxiv},
  year = {2025}
}
```

## 상세 문서

전체 도구 목록, 상세 사용 예제, API 응답 형식, 개발 가이드는 [영문 문서](#english)를 참고하세요.

## 라이선스

MIT License - Copyright (c) 2025 Taeho Jo

## 링크

- **npm 패키지**: https://www.npmjs.com/package/@jolab/alphagenome-mcp
- **GitHub 저장소**: https://github.com/taehojo/alphagenome-mcp
- **AlphaGenome**: https://deepmind.google/discover/blog/alphagenome/
- **Model Context Protocol**: https://modelcontextprotocol.io/

</div>
