# AlphaGenome MCP Server

<p align="center">
  <a href="#english">English</a> •
  <a href="#korean">한국어</a>
</p>

[![npm version](https://badge.fury.io/js/%40jolab%2Falphagenome-mcp.svg)](https://www.npmjs.com/package/@jolab/alphagenome-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<div id="english">

A Model Context Protocol (MCP) server that provides natural language access to Google DeepMind's AlphaGenome variant effect prediction API.

> **한국어 요약:** Google DeepMind AlphaGenome API를 MCP 클라이언트(Claude Desktop, Claude Code, Gemini CLI, Cursor, Windsurf 등)에서 자연어로 사용할 수 있게 해주는 MCP 서버입니다. 유전체 변이의 조절 효과, 병원성, 조직별 영향을 분석할 수 있습니다. [한국어 전체 문서 보기](#korean)

## Overview

AlphaGenome MCP Server provides a natural language interface to Google DeepMind's AlphaGenome variant effect prediction API. Query genomic variants using plain English instead of writing Python code, designed for exploratory analysis and rapid prototyping.

**Key Features:**
- **Natural Language Interface**: Query variants using plain English instead of writing code
- **Wrapper Architecture**: 20 specialized tools built as wrappers around a single API endpoint
- **Comprehensive Analysis**: Access all AlphaGenome modalities (RNA-seq, ChIP-seq, ATAC-seq, splicing, etc.)
- **Research Tool**: Designed for exploratory genomics research and variant prioritization

## ⚡ Quick Start

**Get started in 3 minutes:**

1. **Install dependencies**
   ```bash
   pip install alphagenome numpy
   ```

2. **Add to your MCP client** (supports Claude Desktop, Claude Code, Gemini CLI, Cursor, Windsurf)
   ```bash
   claude mcp add alphagenome -- npx -y @jolab/alphagenome-mcp@latest --api-key YOUR_API_KEY
   ```

   See [Installation](#installation) for other MCP clients.

3. **Run your first query**

   Restart your MCP client and try:
   ```
   "Use alphagenome to analyze chr19:44908684T>C"
   ```

4. **View results** (takes 30-60 seconds)

   You'll get a detailed report with pathogenicity scores, expression impacts, and splicing effects.

**Want more?** Check out [20 specialized tools](#available-tools) below.

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

**1. Install Python dependencies:**
```bash
pip install alphagenome numpy
```

**2. Configure for your MCP client:**

<details>
<summary><b>Claude Desktop</b></summary>

**Recommended method:**
```bash
claude mcp add alphagenome -- npx -y @jolab/alphagenome-mcp@latest --api-key YOUR_API_KEY
```

**Or manually add to `~/.config/claude/claude_desktop_config.json`:**
```json
{
  "mcpServers": {
    "alphagenome": {
      "command": "npx",
      "args": ["-y", "@jolab/alphagenome-mcp@latest", "--api-key", "YOUR_API_KEY"]
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
<summary><b>Claude Code</b></summary>

Add to `~/.config/claude/claude_code_config.json`:
```json
{
  "mcpServers": {
    "alphagenome": {
      "command": "npx",
      "args": ["-y", "@jolab/alphagenome-mcp@latest", "--api-key", "YOUR_API_KEY"]
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
      "args": ["-y", "@jolab/alphagenome-mcp@latest", "--api-key", "YOUR_API_KEY"]
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
      "args": ["-y", "@jolab/alphagenome-mcp@latest", "--api-key", "YOUR_API_KEY"]
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
      "args": ["-y", "@jolab/alphagenome-mcp@latest", "--api-key", "YOUR_API_KEY"]
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

- **First call**: 30-60 seconds (initialization), subsequent calls: 8-15 seconds per variant
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
- **AlphaGenome**: https://deepmind.google/discover/blog/alphagenome/
- **Model Context Protocol**: https://modelcontextprotocol.io/
- **Claude Desktop**: https://claude.ai/download

</div>

---

<div id="korean">

# AlphaGenome MCP 서버

> Google DeepMind의 AlphaGenome을 자연어로 사용할 수 있게 해주는 MCP 서버

[![npm version](https://badge.fury.io/js/%40jolab%2Falphagenome-mcp.svg)](https://www.npmjs.com/package/@jolab/alphagenome-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 개요

유전체 변이(genomic variant)의 조절 효과를 AI로 예측하는 AlphaGenome API를 MCP 클라이언트(Claude Desktop, Claude Code, Gemini CLI, Cursor, Windsurf 등)에서 자연어로 사용할 수 있습니다. Python 코드를 작성하지 않고 평범한 한국어나 영어로 변이를 분석할 수 있으며, 탐색적 분석과 빠른 프로토타이핑에 최적화되어 있습니다.

## 주요 기능

- 🧬 **변이 효과 예측**: 11가지 분자 양식(RNA-seq, ChIP-seq, ATAC-seq, 스플라이싱 등)에서 조절 영향 분석
- 🏥 **병원성 평가**: 임상 점수 산출 및 필터링
- 🔬 **조직별 분석**: 뇌, 간, 심장 등 여러 조직에서의 효과 프로파일링
- 📊 **배치 처리**: 대용량 변이 우선순위 지정
- 💬 **자연어 인터페이스**: 코딩 없이 rsID나 염색체 좌표로 쿼리
- 🔧 **20가지 전문 도구**: 단일 API를 감싸는 래퍼 아키텍처

## ⚡ 빠른 시작

**3분 안에 시작하기:**

1. **Python 패키지 설치**
   ```bash
   pip install alphagenome numpy
   ```

2. **MCP 클라이언트에 추가** (Claude Desktop, Claude Code, Gemini CLI, Cursor, Windsurf 지원)
   ```bash
   claude mcp add alphagenome -- npx -y @jolab/alphagenome-mcp@latest --api-key YOUR_API_KEY
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

4. **결과 확인** (30-60초 소요)

   병원성 점수, 발현 영향, 스플라이싱 효과가 포함된 상세 보고서가 생성됩니다.

**더 알아보기:** [20가지 전문 도구](#사용-예시) 확인

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

## 설치 방법

### 요구사항

- Node.js ≥18.0.0
- Python ≥3.8
- AlphaGenome API 키 (Google DeepMind에서 발급)
- Python 패키지: `alphagenome`, `numpy`

### 설치

**1. Python 패키지 설치:**
```bash
pip install alphagenome numpy
```

**2. MCP 클라이언트 설정:**

<details>
<summary><b>Claude Desktop</b></summary>

**권장 방법:**
```bash
claude mcp add alphagenome -- npx -y @jolab/alphagenome-mcp@latest --api-key YOUR_API_KEY
```

**수동 설정 (`~/.config/claude/claude_desktop_config.json`):**
```json
{
  "mcpServers": {
    "alphagenome": {
      "command": "npx",
      "args": ["-y", "@jolab/alphagenome-mcp@latest", "--api-key", "YOUR_API_KEY"]
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
<summary><b>Claude Code</b></summary>

`~/.config/claude/claude_code_config.json`에 추가:
```json
{
  "mcpServers": {
    "alphagenome": {
      "command": "npx",
      "args": ["-y", "@jolab/alphagenome-mcp@latest", "--api-key", "YOUR_API_KEY"]
    }
  }
}
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
      "args": ["-y", "@jolab/alphagenome-mcp@latest", "--api-key", "YOUR_API_KEY"]
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

- **첫 호출**: 30-60초 (초기화), 이후 호출: 변이당 8-15초
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
