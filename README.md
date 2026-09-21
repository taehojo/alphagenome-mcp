# AlphaGenome MCP Server

<p align="center">
  <a href="#english">English</a> •
  <a href="#korean">한국어</a>
</p>

[![npm version](https://badge.fury.io/js/%40jolab%2Falphagenome-mcp.svg)](https://www.npmjs.com/package/@jolab/alphagenome-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<div id="english">

AlphaGenome as a tool for Claude agents. A Model Context Protocol (MCP) server that lets an agent turn a researcher's question into an AlphaGenome analysis.

> **한국어 요약:** AlphaGenome을 Claude 에이전트의 도구로 만드는 MCP 서버입니다. 에이전트가 연구자의 질문을 분석으로 바꿉니다. 단일 염기 변이는 미리 계산된 AlphaGenome Atlas에서 즉시 조회하고, indel을 비롯해 Atlas가 미리 계산해 둘 수 없는 변이는 실시간 추론으로 처리합니다. 어느 쪽에서 답했는지 항상 결과에 표시합니다. [한국어 전체 문서 보기](#korean)

<p align="center">
  <img src="docs/images/how-it-works.png" width="900" alt="How the AlphaGenome MCP Server works. 1: you ask in plain language. 2: the server routes the request: the precomputed AlphaGenome Atlas for a single-nucleotide variant, live inference for an indel or anything the Atlas cannot precompute, and a validation error when the reference base does not match. 3: you get an answer labeled with its source.">
</p>

## Demo

Three minutes in Claude Code, with the published package and the real API. The video has no sound.

https://github.com/user-attachments/assets/85e8eca5-af22-4f1a-9707-daf4c488d1cd

| Time | Prompt | What happens |
|---|---|---|
| 0:15 | `Use alphagenome to analyze chr19:44908684 T>C (APOE rs429358)` | A single-nucleotide variant: answered from the Atlas, with the AVI score |
| 1:10 | `Now analyze the 2 bp deletion chr17:49210289 CCC>C` | The Atlas cannot hold an indel: live inference, and the result says so. A live result has no AVI score |
| 2:10 | `Scan chr19:44907684-44909684 with alphagenome and show the 10 substitutions with the largest predicted impact` | 6,003 substitutions ranked from the Atlas without running the model |

The explanations in the video are written by Claude from the tool results. The tools themselves return scores and calibrated quantiles, and never a pathogenicity call.

## Overview

A researcher asks a question; the agent decides which AlphaGenome calls answer it, runs them, and reads the results back. This server gives the agent the two ways AlphaGenome can be asked:

- **The AlphaGenome Atlas** for single-nucleotide variants. The Atlas holds precomputed predictions for every possible single-nucleotide substitution in the human genome, so a lookup answers in seconds and a whole region can be ranked without running the model.
- **Live inference** for indels and other variants the Atlas cannot precompute.

The server chooses between the two automatically, and **every result states its source** (`source: atlas` or `source: live`), so a precomputed score is never mistaken for a fresh model call or the other way round.

**Key Features:**
- **Atlas first**: single-nucleotide variants are answered from the precomputed Atlas; live inference runs only when it is needed
- **Always says where the answer came from**: `source: atlas`, `source: live`, or `source: live (atlas fallback: <reason>)`
- **One shape for both sources**: live inference uses the SDK's `score_variant` with its recommended variant scorers, which have the same names as the Atlas scorers, so an Atlas result and a live result can be read side by side
- **AVI score and its attributions**: the AlphaGenome Variant Impact score (`AVI_SCORE`) and its feature attributions are first-class outputs for single-nucleotide variants
- **Region scans without the model**: rank every substitution in a region by the AVI score
- **24 tools**: 4 Atlas tools and 20 variant tools

> **These are model predictions for research prioritization, not clinical classifications.** Every tool reports AlphaGenome's scores and calibrated quantiles as returned. No tool classifies a variant as pathogenic or benign, assigns a risk label, or states a percent change, on either path. Not for diagnosis or treatment decisions.

## ⚡ Quick Start

**Get started in 3 minutes:**

0. **Get an API key** at https://alphagenome.google/api (free for non-commercial use). You need Node.js 18+ and Python 3.10+.

1. **Install dependencies**
   ```bash
   pip install alphagenome numpy
   ```
   If this fails, or you are on Windows, use a virtual environment: see [Python environment](#python-environment).

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

   This is a single-nucleotide variant, so it is answered from the Atlas in a few seconds and the report starts with `Source: atlas`. An indel would run live inference instead (typically 3-10 seconds) and say `Source: live`.

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
| What it answers | Single-nucleotide substitutions on hg38 (chr1-22, chrX, chrY) | Any single variant: single-nucleotide, indel, multi-nucleotide |
| How | Looks up precomputed scores | Runs the AlphaGenome model |
| Typical time | 2-5 seconds per variant, about 7 seconds for a 2,000 bp region | 3-10 seconds per variant |

Six tools choose between the two on their own: `predict_variant_effect`, `batch_score_variants`, `assess_pathogenicity`, `batch_pathogenicity_filter`, `generate_variant_report` and `explain_variant_impact`. They take an optional `source` parameter:

| `source` | Behaviour |
|---|---|
| `auto` (default) | Atlas when `ref` and `alt` are single bases on chr1-22, chrX or chrY; live inference otherwise. If the Atlas does not hold the variant, falls back to live inference and says so: `source: live (atlas fallback: <reason>)` |
| `atlas` | Atlas only. Never falls back; a variant the Atlas cannot answer is an error |
| `live` | Always runs the model |

The fallback is deliberately narrow. It happens only when the Atlas reports that it does not hold the variant. Authentication, rate limit, network and timeout errors are returned as errors, and so is a variant the Atlas rejects: if the reference base does not match hg38, the Atlas says which base it expected, and the server passes that message on instead of running the model on a mistyped variant. In a batch, each variant is routed on its own and the result reports how many came from each source and how many fell back. A mixed batch is reported as two separately ranked groups: the Atlas group is ranked by the AVI score by default, live inference has no AVI score, so one merged ranking would compare different quantities.

### Two primitives, one shape

Every tool is a view over two primitives: *score one variant* and *score many variants and rank them*. Each is answered by the Atlas or by live inference, and both return the same thing: for each scorer, a matrix of rows (the variant, or one row per gene or junction) by tracks (tissues, cell types, assays), with a calibrated quantile for every score.

```
Atlas            client.query_variant(variant, requested_scorers=[...])
Live inference   client.score_variant(interval, variant, RECOMMENDED_VARIANT_SCORERS[...])
                 -> {scorer: AnnData}  ->  one shared summarizer  ->  ranked rows + source
```

The scorer names are the same on both sides (`RNA_SEQ`, `CAGE`, `DNASE`, `CHIP_HISTONE`, `CHIP_TF`, `SPLICE_SITES`, ...). The AVI scorers are the exception: the Atlas alone serves them. For chr17:49210289 C>T the two sources agree on the strongest track of five of the six default scorers, with scores that are close but not identical (DNASE in HeLa-S3: 2.778 from the Atlas, 2.846 live; CAGE in HeLa-S3: 1.866 and 2.121).

A matrix is never returned. One variant is thousands of numbers per scorer, so every result is the strongest cells, ranked, with the gene, tissue and assay of each.

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
Every possible single-nucleotide substitution in a region, ranked by absolute score. Answers "which positions in this region matter most?" without running the model. At most 10,000 bp; up to 50,000 bp only with `allow_large_region: true`.
```
"Scan chr17:49209289-49211289 and show the 10 substitutions with the largest predicted effect"
```

**Default scorers.** Override with the `scorers` parameter; names come from `atlas_list_scorers`.

| Used for | Default | Why |
|---|---|---|
| One variant (`atlas_lookup_variant`, `predict_variant_effect`) | `AVI_SCORE`, `RNA_SEQ`, `CAGE`, `DNASE`, `CHIP_HISTONE`, `CHIP_TF`, `SPLICE_SITES` | One representative scorer per modality: overall impact, expression, transcription start, accessibility, histone marks, TF binding, splicing |
| Many variants and regions (`atlas_lookup_variants`, `atlas_scan_region`, `batch_score_variants`) | `AVI_SCORE` | One number per variant makes the ranking meaningful and keeps the call inside the API's request quota. Measured on a 2,000 bp scan: `AVI_SCORE` 2 s, `DNASE` 17 s, `CHIP_TF` 86 s |

For `batch_score_variants`, the `scoring_metric` picks the Atlas scorer when `scorers` is not given: `rna_seq` uses `RNA_SEQ`, `splice` uses `SPLICE_SITES`, `regulatory_impact` and `combined` use `AVI_SCORE`.

**The AVI score.** The AlphaGenome Variant Impact (AVI) score combines AlphaGenome's predictions with AlphaMissense and other features into one number per variant. The Atlas serves it through the API as three scorers, and this server treats them as first-class outputs:

| Scorer | What it is |
|---|---|
| `AVI_SCORE` | The score itself, one value per variant, with its calibrated quantile. The default for ranking many variants and for region scans |
| `AVI_SCORE_FEATURE_IMPORTANCE` | The contribution of each of the 18 features to the score (`MAX_ABS_DNASE`, `MERGED_SPLICING`, `ALPHAMISSENSE`, `PHASTCONS_470_WAY`, ...). Shown by `generate_variant_report` and `explain_variant_impact` |
| `AVI_SCORE_MODEL_FEATURES` | The values of those 18 features |

The AVI score exists for single-nucleotide variants only, because only the Atlas serves it. A live result has no AVI score, and says so rather than approximating one. Scores and quantiles are reported exactly as returned; they are not turned into a pathogenic or benign call.

**Limits to know about.**
- The Atlas API has a requests-per-minute quota, and a region scan uses one request per 32 bp. That is why a scan is limited to 10,000 bp unless `allow_large_region` is set. Long scans wait and retry when the quota is hit. If the time limit (`ALPHAGENOME_TIMEOUT_MS`) is reached first, the partial result is returned, marked `Incomplete`, with the range that was really scanned; it is never silently truncated.
- Scorers with one row per gene or junction (`RNA_SEQ`, `SPLICE_JUNCTIONS`, ...) return more data per request than the API allows for a region scan. Scan with `AVI_SCORE` first, then look up the top variants with `atlas_lookup_variant`.
- Human reference genome (hg38) only. Positions are 1-based.

### Tools that choose between the Atlas and live inference

All six take `source` (`auto`, `atlas`, `live`) and `scorers`.

#### predict_variant_effect
The strongest tracks of each modality for one variant, with score, quantile, gene, tissue and assay. From the Atlas the AVI score is included. Optional `output_types` and `tissue_type`.
```
"Use alphagenome to analyze chr19:44908684T>C"
```

#### batch_score_variants
Up to 100 variants, each routed on its own, ranked by predicted effect. Reports how many came from each source and how many fell back.
```
"Use alphagenome to score these 50 variants and show the top 10"
```

#### assess_pathogenicity
Predicted effect size across modalities, and the AVI score from the Atlas. **The name is kept for compatibility: it does not classify.** `classification` is always `null`.
```
"Use alphagenome to assess rs429358"
```

#### batch_pathogenicity_filter
Keeps the variants whose largest absolute quantile reaches `threshold` (default 0.99), ranked, per source. **A filter on predicted effect size, not on pathogenicity.**
```
"Use alphagenome to keep the variants above the 99.9th percentile"
```

#### generate_variant_report
A fuller report of one variant: more rows per scorer and, from the Atlas, the AVI score with its feature attributions. **A research summary, not a clinical report: no classification, no recommendation.**
```
"Use alphagenome to generate a report for rs429358"
```

#### explain_variant_impact
Plain sentences that restate the numbers: the AVI score and its largest contributions, then the strongest effect of each modality ordered by quantile, with the direction for signed scorers. **Descriptive only.**
```
"Use alphagenome to explain the predicted effect of rs429358"
```

### Live-inference tools

These run `score_variant` and work for single-nucleotide variants, indels and multi-nucleotide variants. Every result states `source: live`. Tools that take one variant accept an optional `tissue_type` (a name such as `brain`, or an ontology CURIE such as `UBERON:0000955`).

| Tool | What it returns |
|---|---|
| `predict_splice_impact` | Splice sites, splice site usage and splice junctions, with the gene and junction of each |
| `predict_expression_impact` | RNA-seq (log fold change per gene and tissue) and CAGE |
| `predict_tf_binding_impact` | TF ChIP-seq, with the factor and cell type of each track |
| `predict_chromatin_impact` | ATAC-seq and DNase-seq |
| `predict_allele_specific_effects` | Alternate against reference allele: `RNA_SEQ` is that log fold change; `RNA_SEQ_ACTIVE` gives the expression level |
| `annotate_regulatory_context` | Every regulatory modality at once, to see where the predicted effect concentrates |
| `predict_tissue_specific` | The strongest effect of each scorer within each of several tissues |
| `compare_variants` | Two variants side by side, and which has the larger quantile per scorer |
| `compare_protective_risk` | The same comparison with the caller's labels; the tool does not judge which allele is protective |
| `compare_alleles` | The alternate alleles of one position, ranked |
| `analyze_gwas_locus` | The variants of a locus, ranked |
| `compare_variants_same_gene` | Variants ranked by their effect on one gene (`gene_name`) |
| `batch_modality_screen` | Variants ranked within one modality: `expression`, `splicing`, `tf_binding` or `chromatin` |
| `batch_tissue_comparison` | One ranking per tissue |

Rankings over several scorers use the largest absolute quantile, because quantiles are calibrated and the raw scores of different scorers are not on one scale. A ranking over one scorer uses its absolute score.

## Installation

### Requirements

- Node.js ≥18.0.0
- Python ≥3.10 (required by the `alphagenome` package)
- `alphagenome` ≥0.9.0 for the Atlas tools
- AlphaGenome API key: https://alphagenome.google/api (free for non-commercial use)
- Python packages: `alphagenome`, `numpy`

### Environment variables

| Variable | Purpose |
|---|---|
| `ALPHAGENOME_API_KEY` | Your API key. Put it in the `env` block of the MCP client configuration. This is preferred over `--api-key`, which leaves the key in the process list and in shell history |
| `ALPHAGENOME_PYTHON` | Python interpreter to use, for example a virtualenv (`/path/to/venv/bin/python`) or, on Windows, `C:\path\to\venv\Scripts\python.exe`. Without it the server tries `python3`, then `python` |
| `ALPHAGENOME_TIMEOUT_MS` | Time allowed for one call, in milliseconds (default 180000). Raise it for large region scans and batches |

### Python environment

The server runs the AlphaGenome Python SDK in a subprocess, so it needs a Python 3.10+ interpreter that has `alphagenome` installed. A virtual environment is the reliable way to get one: it avoids the "externally managed environment" error of system Pythons on macOS and Linux, and on Windows, where `python3` usually does not exist and `python` is often not on the PATH, it gives you a path to point at.

```bash
# macOS / Linux
python3 -m venv ~/.alphagenome-venv
~/.alphagenome-venv/bin/pip install alphagenome numpy
```
```powershell
# Windows (PowerShell)
py -3 -m venv $HOME\.alphagenome-venv
& $HOME\.alphagenome-venv\Scripts\pip install alphagenome numpy
```

Then tell the server which interpreter to use with `ALPHAGENOME_PYTHON`:

```bash
claude mcp add alphagenome \
  --env ALPHAGENOME_API_KEY=YOUR_API_KEY \
  --env ALPHAGENOME_PYTHON=/Users/you/.alphagenome-venv/bin/python \
  -- npx -y @jolab/alphagenome-mcp@latest
```

In a JSON configuration it goes in the same `env` block as the key (use the full path; on Windows, double the backslashes):

```json
"env": {
  "ALPHAGENOME_API_KEY": "YOUR_API_KEY",
  "ALPHAGENOME_PYTHON": "C:\\Users\\you\\.alphagenome-venv\\Scripts\\python.exe"
}
```

If `alphagenome` is installed for the `python3` (or `python`) on your PATH, you can skip `ALPHAGENOME_PYTHON`.

### Setup

**1. Install Python dependencies** (or use the virtual environment above):
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

1. Check that the client can start the server. In Claude Code:
   ```bash
   claude mcp list
   ```
   `alphagenome: ... ✔ Connected` means the server starts. It does not yet prove that Python and the key work; the first query does.
2. Restart your MCP client and ask:
   ```
   "Use alphagenome to analyze chr19:44908684T>C"
   ```
   Expected: a report that starts with `Source: atlas` within a few seconds. An indel (for example `chr17:49210289 CCC>C`) says `Source: live` and typically takes 3-10 seconds.

### Troubleshooting

The server reports problems as tool errors and keeps running. The message tells you which case you are in:

| Message | Cause and fix |
|---|---|
| `No Python interpreter found (tried: python3, python)` | No Python on the PATH of the MCP client. Set `ALPHAGENOME_PYTHON` to the full path of an interpreter (see [Python environment](#python-environment)). Common on Windows |
| `AlphaGenome package not installed for this interpreter (...)` | The interpreter in the message has no `alphagenome`. Install it for that interpreter, or point `ALPHAGENOME_PYTHON` at the one that has it. `pip install` fails on Python older than 3.10 |
| `AlphaGenome API key is missing` | Put `ALPHAGENOME_API_KEY` in the `env` block of the client configuration. Get a key at https://alphagenome.google/api |
| `API key error: ...` | The key was rejected. Check for a truncated or expired key |
| `reference base does not match the expected reference base: X` | The `ref` allele is not what hg38 has at that position. Check the genome build (hg38, not hg19), that the position is 1-based, and the strand. The message names the base the reference has |
| `request quota ... is exhausted` / `Rate limit exceeded` | The API's per-minute quota. Wait a minute; scan a smaller region |
| `timed out after 180000 ms` | A large scan or batch. Raise `ALPHAGENOME_TIMEOUT_MS`, or ask for less |
| `This alphagenome installation has no Atlas client` | `pip install --upgrade alphagenome` (0.9.0 or newer) |

**Tip:** say "use alphagenome" in a query when the client does not pick the server on its own.

## Usage Examples

All examples are actual results from the API (September 2026) for the two APOE variants that define the ε4 and ε2 alleles.

### One variant, from the Atlas

```
User: "Use alphagenome to assess rs429358" (chr19:44908684 T>C)
```
```json
{
  "source": "atlas",
  "variant": "chr19:44908684:T>C",
  "avi_score": { "score": 0.4999, "quantile": 0.9869896 },
  "strongest_effects": [
    { "scorer": "RNA_SEQ", "score": -0.038891, "quantile": -0.9996803, "where": "APOE, psoas muscle, polyA plus RNA-seq" },
    { "scorer": "CAGE", "score": 0.077866, "quantile": 0.9774153, "where": "pons, hCAGE" },
    { "scorer": "DNASE", "score": 0.12269, "quantile": 0.9463574, "where": "brain, DNase-seq" },
    { "scorer": "CHIP_HISTONE", "score": 0.13507, "quantile": 0.9953638, "where": "H3K27me3, common myeloid progenitor, CD34-positive, Histone ChIP-seq" },
    { "scorer": "CHIP_TF", "score": -0.16594, "quantile": -0.9972084, "where": "MYC, K562, TF ChIP-seq" },
    { "scorer": "SPLICE_SITES", "score": 0.022699, "quantile": 0.9561927, "where": "APOE" }
  ],
  "largest_abs_quantile": 0.9996803,
  "classification": null
}
```

### The same variant, explained

```
User: "Use alphagenome to explain the predicted effect of rs429358"
```
```
AlphaGenome Variant Impact (AVI) score: 0.4999 (quantile 0.9869896).
Largest contributions to the AVI score: CACTUS_241_WAY (0.2944), PHASTCONS_470_WAY (0.14471), ALPHAMISSENSE (0.029138).
RNA_SEQ: largest predicted effect in APOE, psoas muscle, polyA plus RNA-seq, score -0.038891, quantile -0.9996803 (negative: predicted lower with the alternate allele than the reference).
CHIP_TF: largest predicted effect in MYC, K562, TF ChIP-seq, score -0.16594, quantile -0.9972084 (negative: ...).
...
```

### An indel, by live inference

```
User: "Use alphagenome to analyze the deletion chr17:49210289 CCC>C"
```
```
**Variant**: chr17:49210289:CCC>C
**Source**: live
**Note**: Live inference because: deletion (CCC>C); the Atlas covers single-nucleotide substitutions only.

## RNA_SEQ
61 row(s) x 371 track(s); largest absolute score 0.8843, median 9.28e-4.

| Score | Quantile | Where |
|---|---|---|
| -0.8843 | -0.9999997 | ABI3, cardiac atrium fibroblast, total RNA-seq |
```

### The same SNV from both sources

chr17:49210289 C>T with `source: atlas` and with `source: live`, strongest track per scorer:

| Scorer | Atlas: score (quantile), where | Live: score (quantile), where |
|---|---|---|
| RNA_SEQ | 0.8612 (0.9999993), ABI3, LHCN-M2 | 0.9677 (0.9999996), ABI3, HFFc6 |
| CAGE | 1.866 (0.9999712), HeLa-S3 | 2.121 (0.9999838), HeLa-S3 |
| DNASE | 2.778 (0.9998919), HeLa-S3 | 2.846 (0.9999024), HeLa-S3 |
| CHIP_HISTONE | 1.846 (0.9999757), H3K27ac, HeLa-S3 | 1.967 (0.9999808), H3K27ac, HeLa-S3 |
| CHIP_TF | 1.675 (0.9999024), POLR2A, HeLa-S3 | 1.785 (0.9999371), POLR2A, HeLa-S3 |
| SPLICE_SITES | 0.06445 (0.9875146), GNGT2 | 0.04785 (0.9813679), GNGT2 |

The numbers are close, not identical: the Atlas was computed ahead of time and the live call runs the model now.

### Two variants side by side

```
User: "Use alphagenome to compare APOE rs429358 and rs7412"
```
```json
{
  "source": "live",
  "variants": [
    { "label": "variant1", "variant": "chr19:44908684:T>C",
      "effects": [ { "scorer": "RNA_SEQ", "score": -0.037954, "quantile": -0.9996693, "where": "APOE, psoas muscle, polyA plus RNA-seq" }, "..." ] },
    { "label": "variant2", "variant": "chr19:44908822:C>T",
      "effects": [ { "scorer": "RNA_SEQ", "score": 0.035793, "quantile": 0.9997013, "where": "APOE, endothelial cell of umbilical vein, polyA plus RNA-seq" }, "..." ] }
  ],
  "larger_abs_quantile_by_scorer": { "RNA_SEQ": "variant2", "...": "..." }
}
```

### Tissue-specific

```
User: "Use alphagenome to compare rs429358 in brain and liver"
```
In brain the strongest RNA-seq effect is on APOE (score -0.0084, quantile -0.9943216); DNase-seq in brain is 0.1224 (quantile 0.9463574) and in liver -0.004807 (quantile -0.1842174).

### Filtering a mixed batch

```
User: "Use alphagenome to keep the variants above the 99th percentile: rs429358, rs7412, and the deletion chr17:49210289 CCC>C"
```
The two SNVs are answered from the Atlas and ranked by the AVI score (rs7412: 0.8636, quantile 0.995461, kept; rs429358: quantile 0.9869896, not kept). The deletion is answered by live inference (largest quantile 0.9999997, kept). The result reports the two groups separately: `"source": "mixed"`, `"answered_from": { "atlas": 2, "live": 1, "atlas_fallback": 0 }`.

## Performance

- **Atlas**: 2-5 seconds per variant, about 7 seconds for a 2,000 bp region scan (with `AVI_SCORE`)
- **Live inference**: typically 3-10 seconds per variant (measured through the server, September 2026; depends on API load)
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
├── variant-tools.ts      # The 20 variant tools, over two primitives and a narrow backend interface
├── tools.ts              # MCP tool definitions
├── types.ts              # TypeScript type definitions
├── tests/                # Unit tests (no API key needed)
└── utils/
    ├── config.ts         # Environment variables
    ├── validation.ts     # Input validation (Zod schemas)
    └── formatting.ts     # One set of formatters for both sources, and the size cap
scripts/
├── alphagenome_bridge.py # Bridge: one JSON request in, one JSON response out
├── atlas_actions.py      # Atlas lookups and region scans
├── live_actions.py       # Live inference with score_variant
├── summaries.py          # The summarizer shared by both sources (numpy only)
└── tests/                # Python unit tests for the summarizer
```

### Testing

```bash
npm test               # Build, then run the TypeScript unit tests (no API key needed)
npm run test:python    # Python unit tests for the shared summarizer (numpy and pandas only)
npm run docs:api       # Regenerate docs/API.md from the tool definitions in src/tools.ts
npm run lint           # ESLint check
npm run typecheck      # TypeScript type checking
npm run build          # Compile to build/
```

## Roadmap

Not in this release, and not promised by any tool above:

- **Combinations of variants**: scoring several variants together on one haplotype, rather than one at a time.
- **Custom sequences**: predictions for a sequence the caller supplies, rather than a variant on the reference genome.

Both need live inference and neither can be precomputed, so they fit the same design: the Atlas where it can answer, the model where it cannot, and the source on every result.

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

<p align="center">
  <img src="docs/images/how-it-works.png" width="900" alt="AlphaGenome MCP 서버의 동작 방식. 1: 자연어로 질문합니다. 2: 서버가 경로를 정합니다. 단일 염기 변이는 미리 계산된 AlphaGenome Atlas, indel처럼 Atlas가 미리 계산할 수 없는 것은 실시간 추론, 참조 염기가 맞지 않으면 검증 오류. 3: 출처가 표시된 답을 받습니다.">
</p>

## 데모

Claude Code에서 3분. npm에 게시된 패키지와 실제 API를 사용했습니다. 영상에 소리는 없습니다.

https://github.com/user-attachments/assets/85e8eca5-af22-4f1a-9707-daf4c488d1cd

| 시각 | 질문 | 일어나는 일 |
|---|---|---|
| 0:15 | `Use alphagenome to analyze chr19:44908684 T>C (APOE rs429358)` | 단일 염기 변이: Atlas에서 답하고 AVI 점수가 함께 나옵니다 |
| 1:10 | `Now analyze the 2 bp deletion chr17:49210289 CCC>C` | indel은 Atlas에 없으므로 실시간 추론으로 처리되고, 결과에 그렇게 표시됩니다. 실시간 결과에는 AVI 점수가 없습니다 |
| 2:10 | `Scan chr19:44907684-44909684 with alphagenome and show the 10 substitutions with the largest predicted impact` | 모델을 돌리지 않고 Atlas에서 6,003개 치환의 순위를 매깁니다 |

영상 속 설명은 Claude가 도구 결과를 읽고 쓴 것입니다. 도구 자체는 점수와 보정 quantile만 돌려주며 병원성 판정은 하지 않습니다.

## 개요

연구자가 질문을 하면, 에이전트가 그 질문에 답하는 AlphaGenome 호출을 정하고 실행한 뒤 결과를 읽어 줍니다. 이 서버는 AlphaGenome에 물어볼 수 있는 두 가지 방법을 에이전트에게 제공합니다.

- **AlphaGenome Atlas**: 단일 염기 변이용. Atlas에는 인간 유전체의 모든 단일 염기 치환에 대한 예측이 미리 계산되어 있어, 조회는 몇 초면 끝나고 구간 전체의 순위도 모델을 돌리지 않고 매길 수 있습니다.
- **실시간 추론**: indel을 비롯해 Atlas가 미리 계산해 둘 수 없는 변이용.

서버가 둘 중 하나를 자동으로 고르며, **모든 결과에 출처를 표시합니다** (`source: atlas` 또는 `source: live`). 미리 계산된 점수와 방금 돌린 모델 결과가 서로 혼동되지 않습니다.

## 주요 기능

- ⚡ **Atlas 우선**: 단일 염기 변이는 미리 계산된 Atlas에서 조회하고, 실시간 추론은 필요할 때만 실행
- 🏷️ **출처 항상 표시**: `source: atlas`, `source: live`, `source: live (atlas fallback: <사유>)`
- 🔁 **두 경로, 하나의 형태**: 실시간 추론은 SDK의 `score_variant`와 권장 variant scorer를 사용합니다. scorer 이름이 Atlas와 같아서 Atlas 결과와 실시간 결과를 나란히 읽을 수 있습니다
- 🎯 **AVI 점수와 기여도**: 단일 염기 변이에 대해 AVI(AlphaGenome Variant Impact) 점수(`AVI_SCORE`)와 특성 기여도를 주요 출력으로 제공
- 🗺️ **모델 없이 구간 스캔**: 구간의 모든 치환을 AVI 점수로 순위화
- 🧬 **변이 효과 예측**: 발현, 전사 시작, 염색질 접근성, 히스톤 표지, 전사인자 결합, 스플라이싱에서 예측 효과가 가장 큰 트랙을 점수, quantile, 유전자, 조직과 함께 제시
- 🔬 **조직별 분석**: 뇌, 간, 심장 등 조직별 트랙으로 걸러서 비교
- 📊 **배치 순위화**: 여러 변이를 예측 효과 크기로 순위화
- 💬 **자연어 인터페이스**: 코딩 없이 염색체 좌표로 질의
- 🔧 **24가지 도구**: Atlas 도구 4개와 변이 도구 20개

> **이 결과는 연구 우선순위 결정을 위한 모델 예측이며, 임상적 분류가 아닙니다.** 모든 도구는 AlphaGenome이 돌려준 점수와 보정 quantile을 그대로 보고합니다. 어느 경로에서도 변이를 병원성/양성으로 분류하지 않고, 위험 등급을 붙이지 않으며, 퍼센트 변화를 말하지 않습니다. 진단이나 치료 결정에 사용할 수 없습니다.

## ⚡ 빠른 시작

**3분 안에 시작하기:**

0. **API 키 발급**: https://alphagenome.google/api (비상업적 용도 무료). Node.js 18 이상과 Python 3.10 이상이 필요합니다.

1. **Python 패키지 설치**
   ```bash
   pip install alphagenome numpy
   ```
   실패하거나 Windows를 쓰신다면 가상환경을 쓰세요: [Python 환경](#python-환경) 참고

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

   이 변이는 단일 염기 변이이므로 Atlas에서 몇 초 안에 답이 오고, 보고서는 `Source: atlas`로 시작합니다. indel이라면 실시간 추론이 실행되어(보통 3-10초) `Source: live`로 표시됩니다.

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
| 답할 수 있는 것 | hg38의 단일 염기 치환 (chr1-22, chrX, chrY) | 모든 종류의 단일 변이: 단일 염기, indel, 다염기 |
| 방식 | 미리 계산된 점수 조회 | AlphaGenome 모델 실행 |
| 소요 시간 | 변이당 2-5초, 2,000 bp 구간 약 7초 | 변이당 3-10초 |

`predict_variant_effect`, `batch_score_variants`, `assess_pathogenicity`, `batch_pathogenicity_filter`, `generate_variant_report`, `explain_variant_impact` 여섯 도구가 둘 중 하나를 스스로 고릅니다. 선택 파라미터 `source`로 바꿀 수 있습니다. 나머지 변이 도구 14개는 실시간 추론(`score_variant`)을 사용하며 결과에 `source: live`로 표시됩니다.

| `source` | 동작 |
|---|---|
| `auto` (기본값) | `ref`와 `alt`가 chr1-22, chrX, chrY의 단일 염기이면 Atlas, 아니면 실시간 추론. Atlas에 해당 변이가 없으면 실시간 추론으로 넘어가고 그 사실을 표시: `source: live (atlas fallback: <사유>)` |
| `atlas` | Atlas만 사용. 다른 곳으로 넘어가지 않으며, Atlas가 답할 수 없는 변이는 오류 |
| `live` | 항상 모델 실행 |

실시간 추론으로 넘어가는 조건은 일부러 좁게 잡았습니다. Atlas가 "이 변이를 가지고 있지 않다"고 답한 경우에만 넘어갑니다. 인증, 호출 한도, 네트워크, 시간 초과 오류는 오류 그대로 돌려줍니다. Atlas가 거부한 변이도 마찬가지입니다. 참조 염기가 hg38과 다르면 Atlas가 기대한 염기를 알려 주므로, 잘못 입력된 변이로 모델을 돌리는 대신 그 메시지를 그대로 전달합니다. 배치에서는 변이마다 따로 경로를 정하고, 각 출처에서 몇 개가 답해졌는지와 몇 개가 넘어갔는지를 결과에 표시합니다. 섞인 배치는 하나의 순위가 아니라 따로 순위를 매긴 두 묶음으로 보고합니다. Atlas 묶음은 기본적으로 AVI 점수로 순위를 매기는데 실시간 추론에는 AVI 점수가 없어서, 하나로 합치면 서로 다른 양을 비교하게 되기 때문입니다.

### Atlas 도구

모델을 돌리지 않고 미리 계산된 점수를 조회합니다. 모든 Atlas 응답은 요약입니다. 순위가 매겨진 행만 돌려주며 전체 점수 행렬은 돌려주지 않습니다. 변이 하나만 해도 scorer당 수천 개의 숫자이므로(APOE 위치의 RNA-seq는 유전자 61개 x 트랙 371개), 응답은 `top_n`행(기본 25, 최대 100)과 40,000자로 제한됩니다.

| 도구 | 설명 |
|---|---|
| `atlas_list_scorers` | Atlas가 제공하는 scorer 목록(작성 시점 22개)과 각 scorer의 트랙 수, 실험 종류. 세션 동안 캐시 |
| `atlas_lookup_variant` | 단일 염기 변이 1개의 점수. scorer별로 절대값이 큰 트랙을 유전자, 조직/세포, 실험 종류와 함께 표시 |
| `atlas_lookup_variants` | 단일 염기 변이 최대 500개를 한 번에 조회해 절대값 순으로 순위화. Atlas에 없는 변이와 거부된 변이(예: 참조 염기 불일치)는 전체 호출을 실패시키지 않고 사유와 함께 따로 나열 |
| `atlas_scan_region` | 구간의 모든 단일 염기 치환을 절대값 순으로 순위화. "이 구간에서 어느 위치가 가장 중요한가"에 모델 없이 답함. 최대 10,000 bp이며, `allow_large_region: true`를 줄 때만 50,000 bp까지 |

**기본 scorer.** `scorers` 파라미터로 바꿀 수 있고, 이름은 `atlas_list_scorers`에서 확인합니다.

| 용도 | 기본값 | 이유 |
|---|---|---|
| 변이 1개 (`atlas_lookup_variant`, `predict_variant_effect`) | `AVI_SCORE`, `RNA_SEQ`, `CAGE`, `DNASE`, `CHIP_HISTONE`, `CHIP_TF`, `SPLICE_SITES` | 양식별 대표 scorer 하나씩: 종합 영향, 발현, 전사 시작, 접근성, 히스톤 표지, 전사인자 결합, 스플라이싱 |
| 여러 변이와 구간 (`atlas_lookup_variants`, `atlas_scan_region`, `batch_score_variants`) | `AVI_SCORE` | 변이당 숫자 하나여야 순위가 의미 있고, API 호출 한도 안에 들어옴. 2,000 bp 스캔 실측: `AVI_SCORE` 2초, `DNASE` 17초, `CHIP_TF` 86초 |

`batch_score_variants`에서 `scorers`를 주지 않으면 `scoring_metric`이 Atlas scorer를 정합니다. `rna_seq`는 `RNA_SEQ`, `splice`는 `SPLICE_SITES`, `regulatory_impact`와 `combined`는 `AVI_SCORE`입니다.

**AVI 점수.** AVI(AlphaGenome Variant Impact) 점수는 AlphaGenome의 예측에 AlphaMissense 등 다른 특성을 합쳐 변이당 하나의 숫자로 만든 것입니다. Atlas가 API로 세 개의 scorer로 제공하며, 이 서버는 이를 주요 출력으로 다룹니다.

| Scorer | 내용 |
|---|---|
| `AVI_SCORE` | 점수 자체. 변이당 값 하나와 보정 quantile. 여러 변이 순위화와 구간 스캔의 기본값 |
| `AVI_SCORE_FEATURE_IMPORTANCE` | 18개 특성(`MAX_ABS_DNASE`, `MERGED_SPLICING`, `ALPHAMISSENSE`, `PHASTCONS_470_WAY` 등) 각각이 점수에 기여한 정도. `generate_variant_report`와 `explain_variant_impact`가 보여줌 |
| `AVI_SCORE_MODEL_FEATURES` | 그 18개 특성의 값 |

AVI 점수는 Atlas만 제공하므로 단일 염기 변이에만 있습니다. 실시간 추론 결과에는 AVI 점수가 없으며, 비슷한 값을 만들어 내지 않고 없다고 표시합니다. 점수와 quantile은 받은 그대로 보고하며 병원성/양성 판정으로 바꾸지 않습니다.

**알아둘 제한.**
- Atlas API에는 분당 호출 한도가 있고, 구간 스캔은 32 bp마다 호출 1회를 씁니다. 그래서 `allow_large_region`을 주지 않으면 스캔은 10,000 bp로 제한됩니다. 한도에 걸리면 기다렸다가 다시 시도합니다. 그 전에 시간 제한(`ALPHAGENOME_TIMEOUT_MS`)에 먼저 도달하면, 결과를 몰래 잘라내지 않고 `Incomplete` 표시와 함께 실제로 스캔한 범위를 돌려줍니다.
- 유전자나 접합부마다 행이 있는 scorer(`RNA_SEQ`, `SPLICE_JUNCTIONS` 등)는 요청당 데이터가 API 허용량을 넘어 구간 스캔에 쓸 수 없습니다. 먼저 `AVI_SCORE`로 스캔한 뒤 상위 변이를 `atlas_lookup_variant`로 조회하세요.
- 인간 참조 유전체(hg38)만 지원합니다. 위치는 1부터 셉니다.

## 설치 방법

### 요구사항

- Node.js ≥18.0.0
- Python ≥3.10 (`alphagenome` 패키지 요구사항)
- Atlas 도구에는 `alphagenome` ≥0.9.0
- AlphaGenome API 키: https://alphagenome.google/api (비상업적 용도 무료)
- Python 패키지: `alphagenome`, `numpy`

### 환경 변수

| 변수 | 용도 |
|---|---|
| `ALPHAGENOME_API_KEY` | API 키. MCP 클라이언트 설정의 `env` 블록에 넣으세요. `--api-key`는 키가 프로세스 목록과 셸 기록에 남으므로 `env` 쪽을 권장합니다 |
| `ALPHAGENOME_PYTHON` | 사용할 Python 인터프리터. 예: 가상환경(`/path/to/venv/bin/python`), Windows에서는 `C:\path\to\venv\Scripts\python.exe`. 지정하지 않으면 `python3`, 그다음 `python`을 시도 |
| `ALPHAGENOME_TIMEOUT_MS` | 호출 1회에 허용하는 시간(밀리초, 기본 180000). 큰 구간 스캔이나 배치에서는 늘리세요 |

### Python 환경

서버는 AlphaGenome Python SDK를 하위 프로세스로 실행하므로, `alphagenome`이 설치된 Python 3.10 이상 인터프리터가 필요합니다. 가상환경을 쓰는 것이 가장 확실합니다. macOS와 Linux의 시스템 Python에서 나는 "externally managed environment" 오류를 피할 수 있고, `python3`가 보통 없고 `python`도 PATH에 없는 경우가 많은 Windows에서는 지정할 경로가 생깁니다.

```bash
# macOS / Linux
python3 -m venv ~/.alphagenome-venv
~/.alphagenome-venv/bin/pip install alphagenome numpy
```
```powershell
# Windows (PowerShell)
py -3 -m venv $HOME\.alphagenome-venv
& $HOME\.alphagenome-venv\Scripts\pip install alphagenome numpy
```

그다음 `ALPHAGENOME_PYTHON`으로 어느 인터프리터를 쓸지 알려 줍니다.

```bash
claude mcp add alphagenome \
  --env ALPHAGENOME_API_KEY=YOUR_API_KEY \
  --env ALPHAGENOME_PYTHON=/Users/you/.alphagenome-venv/bin/python \
  -- npx -y @jolab/alphagenome-mcp@latest
```

JSON 설정에서는 키와 같은 `env` 블록에 넣습니다(전체 경로를 쓰고, Windows에서는 역슬래시를 두 번 씁니다).

```json
"env": {
  "ALPHAGENOME_API_KEY": "YOUR_API_KEY",
  "ALPHAGENOME_PYTHON": "C:\\Users\\you\\.alphagenome-venv\\Scripts\\python.exe"
}
```

PATH에 있는 `python3`(또는 `python`)에 `alphagenome`이 설치되어 있다면 `ALPHAGENOME_PYTHON`은 생략해도 됩니다.

### 설치

**1. Python 패키지 설치** (또는 위의 가상환경 사용):
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

Gemini CLI(`~/.gemini/settings.json`)와 Windsurf(설정 JSON)도 위와 같은 `mcpServers` 블록을 씁니다.

### 설치 확인

1. 클라이언트가 서버를 띄울 수 있는지 확인합니다. Claude Code에서는:
   ```bash
   claude mcp list
   ```
   `alphagenome: ... ✔ Connected`가 보이면 서버가 시작된 것입니다. Python과 키가 제대로인지는 첫 질의에서 확인됩니다.
2. MCP 클라이언트를 재시작하고 물어봅니다.
   ```
   "alphagenome으로 chr19:44908684T>C를 분석해줘"
   ```
   몇 초 안에 `Source: atlas`로 시작하는 보고서가 나오면 정상입니다. indel(예: `chr17:49210289 CCC>C`)은 `Source: live`로 표시되고 보통 3-10초 걸립니다.

### 문제 해결

서버는 문제를 도구 오류로 알려 주고 계속 실행됩니다. 메시지를 보면 어느 경우인지 알 수 있습니다.

| 메시지 | 원인과 해결 |
|---|---|
| `No Python interpreter found (tried: python3, python)` | MCP 클라이언트의 PATH에 Python이 없음. `ALPHAGENOME_PYTHON`에 인터프리터 전체 경로를 지정([Python 환경](#python-환경) 참고). Windows에서 흔함 |
| `AlphaGenome package not installed for this interpreter (...)` | 메시지에 나온 인터프리터에 `alphagenome`이 없음. 그 인터프리터에 설치하거나, 설치된 쪽을 `ALPHAGENOME_PYTHON`으로 지정. Python 3.10 미만에서는 `pip install`이 실패함 |
| `AlphaGenome API key is missing` | 클라이언트 설정의 `env` 블록에 `ALPHAGENOME_API_KEY`를 넣음. 키 발급: https://alphagenome.google/api |
| `API key error: ...` | 키가 거부됨. 잘리거나 만료된 키인지 확인 |
| `reference base does not match the expected reference base: X` | `ref` 염기가 그 위치의 hg38과 다름. 유전체 빌드(hg19가 아닌 hg38), 위치가 1부터 세는지, 가닥 방향을 확인. 메시지에 참조 유전체의 염기가 나옴 |
| `request quota ... is exhausted` / `Rate limit exceeded` | API의 분당 호출 한도. 1분 기다리거나 더 작은 구간을 스캔 |
| `timed out after 180000 ms` | 큰 스캔이나 배치. `ALPHAGENOME_TIMEOUT_MS`를 늘리거나 요청을 줄임 |
| `This alphagenome installation has no Atlas client` | `pip install --upgrade alphagenome` (0.9.0 이상) |

## 변이 도구

**Atlas와 실시간 추론 중에서 고르는 도구 (6개).** 모두 `source`와 `scorers`를 받습니다.

| 도구 | 설명 |
|---|---|
| `predict_variant_effect` | 변이 1개에 대해 양식별로 예측 효과가 가장 큰 트랙을 점수, quantile, 유전자, 조직, 실험과 함께 제시. Atlas 경로에서는 AVI 점수 포함 |
| `batch_score_variants` | 최대 100개 변이를 변이별로 경로를 정해 예측 효과 순으로 순위화 |
| `assess_pathogenicity` | 양식별 예측 효과 크기와, Atlas 경로의 AVI 점수. **이름은 호환성을 위해 유지했을 뿐, 분류하지 않습니다.** `classification`은 항상 `null` |
| `batch_pathogenicity_filter` | 절대 quantile의 최댓값이 `threshold`(기본 0.99) 이상인 변이만 남겨 순위화. **병원성이 아니라 예측 효과 크기에 대한 필터** |
| `generate_variant_report` | scorer당 더 많은 행과, Atlas 경로에서는 AVI 점수와 특성 기여도. **임상 보고서가 아닌 연구용 요약. 분류도 권고도 없음** |
| `explain_variant_impact` | 받은 숫자를 문장으로 풀어 씀: AVI 점수와 가장 큰 기여 특성, 이어서 양식별 가장 큰 효과를 quantile 순으로. **서술만 함** |

**실시간 추론 도구 (14개).** `score_variant`를 실행하며 단일 염기 변이, indel, 다염기 변이에 모두 동작합니다. 결과에 `source: live`로 표시됩니다.

`predict_splice_impact`, `predict_expression_impact`, `predict_tf_binding_impact`, `predict_chromatin_impact`, `predict_allele_specific_effects`, `annotate_regulatory_context`, `predict_tissue_specific`, `compare_variants`, `compare_protective_risk`, `compare_alleles`, `analyze_gwas_locus`, `compare_variants_same_gene`, `batch_modality_screen`, `batch_tissue_comparison`

scorer가 여러 개인 순위는 절대 quantile의 최댓값으로 매깁니다. quantile은 보정된 값이지만, 서로 다른 scorer의 원점수는 같은 척도가 아니기 때문입니다. scorer가 하나이면 그 절대 점수로 매깁니다.

## 사용 예시

모든 예시는 실제 API 결과(2026년 9월)입니다.

### 변이 1개, Atlas에서
```
"rs429358을 평가해줘" (chr19:44908684 T>C)
```
**결과:** `source: atlas`, AVI 점수 0.4999 (quantile 0.9869896). 가장 큰 효과는 RNA_SEQ에서 APOE, psoas muscle, 점수 -0.038891 (quantile -0.9996803). `classification: null`

### 같은 변이를 문장으로
```
"rs429358의 예측 효과를 설명해줘"
```
**결과:** "AlphaGenome Variant Impact (AVI) score: 0.4999 (quantile 0.9869896)." "Largest contributions to the AVI score: CACTUS_241_WAY (0.2944), PHASTCONS_470_WAY (0.14471), ALPHAMISSENSE (0.029138)." 이어서 양식별 문장

### indel, 실시간 추론으로
```
"결실 chr17:49210289 CCC>C를 분석해줘"
```
**결과:** `source: live`, "Live inference because: deletion (CCC>C)". RNA_SEQ에서 ABI3, cardiac atrium fibroblast, 점수 -0.8843 (quantile -0.9999997)

### 같은 SNV를 두 경로로
chr17:49210289 C>T, scorer별 가장 강한 트랙:

| Scorer | Atlas: 점수 (quantile), 위치 | 실시간: 점수 (quantile), 위치 |
|---|---|---|
| RNA_SEQ | 0.8612 (0.9999993), ABI3, LHCN-M2 | 0.9677 (0.9999996), ABI3, HFFc6 |
| CAGE | 1.866 (0.9999712), HeLa-S3 | 2.121 (0.9999838), HeLa-S3 |
| DNASE | 2.778 (0.9998919), HeLa-S3 | 2.846 (0.9999024), HeLa-S3 |
| CHIP_HISTONE | 1.846 (0.9999757), H3K27ac, HeLa-S3 | 1.967 (0.9999808), H3K27ac, HeLa-S3 |
| CHIP_TF | 1.675 (0.9999024), POLR2A, HeLa-S3 | 1.785 (0.9999371), POLR2A, HeLa-S3 |
| SPLICE_SITES | 0.06445 (0.9875146), GNGT2 | 0.04785 (0.9813679), GNGT2 |

값은 가깝지만 같지는 않습니다. Atlas는 미리 계산된 값이고, 실시간 호출은 지금 모델을 실행합니다.

### 섞인 배치 필터링
```
"rs429358, rs7412, 결실 chr17:49210289 CCC>C 중에서 99 퍼센타일 이상만 남겨줘"
```
**결과:** `source: mixed`, atlas 2 / live 1. SNV 둘은 Atlas에서 AVI 점수로 순위(rs7412 quantile 0.995461 통과, rs429358 quantile 0.9869896 탈락), 결실은 실시간 추론(최대 quantile 0.9999997 통과). 두 묶음은 따로 보고됩니다.

## 성능

- **Atlas**: 변이당 2-5초, 2,000 bp 구간 스캔 약 7초 (`AVI_SCORE` 기준)
- **실시간 추론**: 변이당 보통 3-10초 (서버를 통한 실측, 2026년 9월. API 부하에 따라 달라짐)
- **분석 양식**: 11가지 (RNA-seq, CAGE, PRO-cap, 스플라이스 사이트, DNase, ATAC, 히스톤 변형, 전사인자 결합, 접촉 맵)

## 로드맵

이번 릴리스에는 없으며, 위의 어떤 도구도 제공하지 않는 기능입니다.

- **변이 조합**: 여러 변이를 하나씩이 아니라 하나의 haplotype 위에서 함께 점수화
- **사용자 서열**: 참조 유전체 위의 변이가 아니라, 사용자가 제공한 서열에 대한 예측

둘 다 실시간 추론이 필요하고 미리 계산해 둘 수 없습니다. 그래서 같은 설계에 들어맞습니다. Atlas가 답할 수 있으면 Atlas, 아니면 모델, 그리고 모든 결과에 출처 표시.

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

전체 도구 목록, 상세 사용 예제, 개발 가이드는 [영문 문서](#english)를, 도구별 파라미터는 [도구 레퍼런스](docs/API.md)를 참고하세요.

## 라이선스

MIT License - Copyright (c) 2025 Taeho Jo

## 링크

- **npm 패키지**: https://www.npmjs.com/package/@jolab/alphagenome-mcp
- **GitHub 저장소**: https://github.com/taehojo/alphagenome-mcp
- **AlphaGenome**: https://deepmind.google/discover/blog/alphagenome/
- **Model Context Protocol**: https://modelcontextprotocol.io/

</div>
