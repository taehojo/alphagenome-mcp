// src/tools.ts

import { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP Tool Definitions for AlphaGenome Server
 */

export const PREDICT_VARIANT_TOOL: Tool = {
  name: 'predict_variant_effect',
  description: `Predict the regulatory impact of a genetic variant using AlphaGenome AI.

Powered by Google DeepMind's AlphaGenome model for accurate regulatory predictions.

Analyzes how a single nucleotide change affects:
- Gene expression (RNA-seq predictions)
- Splicing patterns
- Transcription factor binding
- Chromatin accessibility
- Histone modifications

Perfect for: variant interpretation, GWAS follow-up, clinical genomics research.

Example: "Analyze chr17:41234567A>T with AlphaGenome"`,
  inputSchema: {
    type: 'object',
    properties: {
      chromosome: {
        type: 'string',
        description: 'Chromosome (chr1-chr22, chrX, chrY)',
        pattern: '^chr([1-9]|1[0-9]|2[0-2]|X|Y)$',
      },
      position: {
        type: 'number',
        description: 'Genomic position (1-based, positive integer)',
        minimum: 1,
      },
      ref: {
        type: 'string',
        description: 'Reference allele (A, T, G, or C)',
        pattern: '^[ATGCatgc]+$',
      },
      alt: {
        type: 'string',
        description: 'Alternate allele (A, T, G, or C)',
        pattern: '^[ATGCatgc]+$',
      },
      output_types: {
        type: 'array',
        items: {
          type: 'string',
          enum: [
            'rna_seq',
            'cage',
            'splice',
            'histone',
            'tf_binding',
            'dnase',
            'atac',
            'contact_map',
          ],
        },
        description: 'Optional: specific analyses to run (default: all)',
      },
      tissue_type: {
        type: 'string',
        description: 'Optional: tissue context (UBERON term, e.g., "UBERON:0001157" for brain)',
      },
    },
    required: ['chromosome', 'position', 'ref', 'alt'],
  },
};

export const ANALYZE_REGION_TOOL: Tool = {
  name: 'analyze_region',
  description: `Analyze regulatory elements in a genomic region using AlphaGenome AI.

Powered by Google DeepMind's AlphaGenome model for regulatory element discovery.

Identifies:
- Promoters and their strength
- Enhancers and target genes
- Silencers
- Transcription factor binding sites
- Chromatin states

Perfect for: finding regulatory hotspots, understanding gene regulation, targeting for CRISPR.

Size limits: 1kb minimum, 1Mb maximum (optimal: 10-100kb)

Example: "Find regulatory elements in chr11:5225464-5227071"`,
  inputSchema: {
    type: 'object',
    properties: {
      chromosome: {
        type: 'string',
        description: 'Chromosome (chr1-chr22, chrX, chrY)',
        pattern: '^chr([1-9]|1[0-9]|2[0-2]|X|Y)$',
      },
      start: {
        type: 'number',
        description: 'Start position (1-based)',
        minimum: 1,
      },
      end: {
        type: 'number',
        description: 'End position (must be > start + 1000)',
        minimum: 1,
      },
      analysis_types: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['promoter', 'enhancer', 'silencer', 'tf_binding', 'chromatin_state'],
        },
        description: 'Optional: specific element types to find (default: all)',
      },
      resolution: {
        type: 'string',
        enum: ['base', 'window'],
        description: 'Resolution: "base" (1bp) or "window" (128bp). Default: base',
      },
    },
    required: ['chromosome', 'start', 'end'],
  },
};

export const BATCH_SCORE_TOOL: Tool = {
  name: 'batch_score_variants',
  description: `Score and prioritize multiple genetic variants using AlphaGenome AI.

Powered by Google DeepMind's AlphaGenome model for high-throughput variant scoring.

Analyzes up to 100 variants simultaneously and ranks them by regulatory impact.

Scoring metrics:
- rna_seq: Gene expression changes
- splice: Splicing alterations
- regulatory_impact: Combined regulatory score
- combined: All metrics weighted

Perfect for: GWAS post-analysis, VCF filtering, variant prioritization.

Example: "Score these 50 variants and show me the top 10 by regulatory impact"`,
  inputSchema: {
    type: 'object',
    properties: {
      variants: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            chromosome: {
              type: 'string',
              description: 'Chromosome',
              pattern: '^chr([1-9]|1[0-9]|2[0-2]|X|Y)$',
            },
            position: {
              type: 'number',
              description: 'Position',
              minimum: 1,
            },
            ref: {
              type: 'string',
              description: 'Reference allele',
              pattern: '^[ATGCatgc]+$',
            },
            alt: {
              type: 'string',
              description: 'Alternate allele',
              pattern: '^[ATGCatgc]+$',
            },
            variant_id: {
              type: 'string',
              description: 'Optional: variant identifier (e.g., rs number)',
            },
          },
          required: ['chromosome', 'position', 'ref', 'alt'],
        },
        description: 'List of variants to analyze (1-100)',
        minItems: 1,
        maxItems: 100,
      },
      scoring_metric: {
        type: 'string',
        enum: ['rna_seq', 'splice', 'regulatory_impact', 'combined'],
        description: 'Metric to use for scoring and ranking',
      },
      top_n: {
        type: 'number',
        description: 'Number of top variants to return (default: 10, max: 100)',
        minimum: 1,
        maximum: 100,
      },
      include_interpretation: {
        type: 'boolean',
        description: 'Include detailed clinical interpretation (default: false)',
      },
    },
    required: ['variants', 'scoring_metric'],
  },
};

/**
 * All available tools
 */
export const ALL_TOOLS: Tool[] = [PREDICT_VARIANT_TOOL, ANALYZE_REGION_TOOL, BATCH_SCORE_TOOL];
