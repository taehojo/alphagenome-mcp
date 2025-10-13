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

// Group A Tools: Core Essential

export const ASSESS_PATHOGENICITY_TOOL: Tool = {
  name: 'assess_pathogenicity',
  description: `Comprehensive pathogenicity assessment of a genetic variant.

Evaluates variant across all regulatory modalities and provides clinical classification.

Returns:
- Pathogenicity score (0-1 scale)
- Clinical classification (pathogenic/likely_pathogenic/uncertain/likely_benign/benign)
- Evidence breakdown (expression, splicing, TF binding impacts)

Perfect for: clinical variant interpretation, pathogenicity prediction, diagnostic sequencing.

Example: "Assess pathogenicity of chr19:44908684T>C"`,
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
        description: 'Genomic position (1-based)',
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
      tissue_type: {
        type: 'string',
        description: 'Optional: disease-relevant tissue (default: brain)',
      },
    },
    required: ['chromosome', 'position', 'ref', 'alt'],
  },
};

export const PREDICT_TISSUE_SPECIFIC_TOOL: Tool = {
  name: 'predict_tissue_specific',
  description: `Predict variant effects across multiple tissues.

Compares regulatory impact in different tissues to identify tissue-specific effects.

Default tissues: brain, liver, heart (customizable)

Returns impact levels and expression changes for each tissue.

Perfect for: understanding tissue-specific disease mechanisms, prioritizing relevant tissues.

Example: "Compare rs429358 effects in brain, liver, and heart"`,
  inputSchema: {
    type: 'object',
    properties: {
      chromosome: {
        type: 'string',
        description: 'Chromosome',
        pattern: '^chr([1-9]|1[0-9]|2[0-2]|X|Y)$',
      },
      position: {
        type: 'number',
        description: 'Genomic position',
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
      tissues: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: 'List of tissues to test (default: brain, liver, heart)',
      },
    },
    required: ['chromosome', 'position', 'ref', 'alt'],
  },
};

export const COMPARE_VARIANTS_TOOL: Tool = {
  name: 'compare_variants',
  description: `Compare two variants side-by-side.

Direct comparison of regulatory impacts between two variants.

Returns:
- Impact levels for both variants
- Expression and splicing changes
- Which variant is more severe

Perfect for: comparing candidate variants, understanding relative severity.

Example: "Compare rs429358 vs rs7412"`,
  inputSchema: {
    type: 'object',
    properties: {
      variant1: {
        type: 'object',
        properties: {
          chromosome: { type: 'string', pattern: '^chr([1-9]|1[0-9]|2[0-2]|X|Y)$' },
          position: { type: 'number', minimum: 1 },
          ref: { type: 'string', pattern: '^[ATGCatgc]+$' },
          alt: { type: 'string', pattern: '^[ATGCatgc]+$' },
        },
        required: ['chromosome', 'position', 'ref', 'alt'],
      },
      variant2: {
        type: 'object',
        properties: {
          chromosome: { type: 'string', pattern: '^chr([1-9]|1[0-9]|2[0-2]|X|Y)$' },
          position: { type: 'number', minimum: 1 },
          ref: { type: 'string', pattern: '^[ATGCatgc]+$' },
          alt: { type: 'string', pattern: '^[ATGCatgc]+$' },
        },
        required: ['chromosome', 'position', 'ref', 'alt'],
      },
    },
    required: ['variant1', 'variant2'],
  },
};

// Group B Tools: Frequently Needed

export const PREDICT_SPLICE_IMPACT_TOOL: Tool = {
  name: 'predict_splice_impact',
  description: `Focus on splicing-specific effects only.

Analyzes splice sites, splice site usage, and splice junctions.

Perfect for: investigating splicing variants, understanding splice alterations.

Example: "Analyze splicing impact of chr6:41129252C>T"`,
  inputSchema: {
    type: 'object',
    properties: {
      chromosome: { type: 'string', pattern: '^chr([1-9]|1[0-9]|2[0-2]|X|Y)$' },
      position: { type: 'number', minimum: 1 },
      ref: { type: 'string', pattern: '^[ATGCatgc]+$' },
      alt: { type: 'string', pattern: '^[ATGCatgc]+$' },
      tissue_type: { type: 'string' },
    },
    required: ['chromosome', 'position', 'ref', 'alt'],
  },
};

export const PREDICT_EXPRESSION_IMPACT_TOOL: Tool = {
  name: 'predict_expression_impact',
  description: `Focus on gene expression effects only.

Analyzes RNA-seq and CAGE predictions for expression changes.

Perfect for: eQTL analysis, expression-related variants.

Example: "Analyze expression impact of rs744373"`,
  inputSchema: {
    type: 'object',
    properties: {
      chromosome: { type: 'string', pattern: '^chr([1-9]|1[0-9]|2[0-2]|X|Y)$' },
      position: { type: 'number', minimum: 1 },
      ref: { type: 'string', pattern: '^[ATGCatgc]+$' },
      alt: { type: 'string', pattern: '^[ATGCatgc]+$' },
      tissue_type: { type: 'string' },
    },
    required: ['chromosome', 'position', 'ref', 'alt'],
  },
};

export const ANALYZE_GWAS_LOCUS_TOOL: Tool = {
  name: 'analyze_gwas_locus',
  description: `Analyze all variants in a GWAS locus.

Ranks variants by regulatory impact for fine-mapping and causal variant identification.

Perfect for: GWAS follow-up, fine-mapping, identifying causal variants.

Example: "Analyze GWAS locus with 10 variants"`,
  inputSchema: {
    type: 'object',
    properties: {
      variants: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            chromosome: { type: 'string' },
            position: { type: 'number' },
            ref: { type: 'string' },
            alt: { type: 'string' },
          },
          required: ['chromosome', 'position', 'ref', 'alt'],
        },
        minItems: 1,
      },
      chromosome: { type: 'string' },
      start: { type: 'number' },
      end: { type: 'number' },
    },
    required: ['variants'],
  },
};

export const COMPARE_ALLELES_TOOL: Tool = {
  name: 'compare_alleles',
  description: `Compare different alleles at the same position.

Useful for understanding effects of different mutations at a hotspot position.

Example: "Compare T>C vs T>G vs T>A at chr19:44908684"`,
  inputSchema: {
    type: 'object',
    properties: {
      chromosome: { type: 'string', pattern: '^chr([1-9]|1[0-9]|2[0-2]|X|Y)$' },
      position: { type: 'number', minimum: 1 },
      ref: { type: 'string', pattern: '^[ATGCatgc]+$' },
      alts: {
        type: 'array',
        items: { type: 'string', pattern: '^[ATGCatgc]+$' },
        minItems: 2,
      },
    },
    required: ['chromosome', 'position', 'ref', 'alts'],
  },
};

export const BATCH_TISSUE_COMPARISON_TOOL: Tool = {
  name: 'batch_tissue_comparison',
  description: `Analyze multiple variants across multiple tissues.

Efficient batch analysis of variants × tissues combinations.

Perfect for: large-scale tissue-specificity studies.

Example: "Test 10 variants in brain, liver, heart"`,
  inputSchema: {
    type: 'object',
    properties: {
      variants: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            chromosome: { type: 'string' },
            position: { type: 'number' },
            ref: { type: 'string' },
            alt: { type: 'string' },
          },
          required: ['chromosome', 'position', 'ref', 'alt'],
        },
        minItems: 1,
      },
      tissues: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
      },
    },
    required: ['variants', 'tissues'],
  },
};

// Group C Tools: Occasionally Useful

export const PREDICT_TF_BINDING_IMPACT_TOOL: Tool = {
  name: 'predict_tf_binding_impact',
  description: `Focus on transcription factor binding effects only.

Analyzes TF binding site changes using ChIP-seq predictions.

Perfect for: TF binding site variants, regulatory element analysis.

Example: "Analyze TF binding impact of chr1:12345678G>A"`,
  inputSchema: {
    type: 'object',
    properties: {
      chromosome: { type: 'string', pattern: '^chr([1-9]|1[0-9]|2[0-2]|X|Y)$' },
      position: { type: 'number', minimum: 1 },
      ref: { type: 'string', pattern: '^[ATGCatgc]+$' },
      alt: { type: 'string', pattern: '^[ATGCatgc]+$' },
      tissue_type: { type: 'string' },
    },
    required: ['chromosome', 'position', 'ref', 'alt'],
  },
};

export const PREDICT_CHROMATIN_IMPACT_TOOL: Tool = {
  name: 'predict_chromatin_impact',
  description: `Focus on chromatin accessibility effects only.

Analyzes DNase and ATAC-seq predictions for chromatin state changes.

Perfect for: enhancer variants, regulatory region analysis.

Example: "Analyze chromatin impact of chr2:23456789C>T"`,
  inputSchema: {
    type: 'object',
    properties: {
      chromosome: { type: 'string', pattern: '^chr([1-9]|1[0-9]|2[0-2]|X|Y)$' },
      position: { type: 'number', minimum: 1 },
      ref: { type: 'string', pattern: '^[ATGCatgc]+$' },
      alt: { type: 'string', pattern: '^[ATGCatgc]+$' },
      tissue_type: { type: 'string' },
    },
    required: ['chromosome', 'position', 'ref', 'alt'],
  },
};

export const COMPARE_PROTECTIVE_RISK_TOOL: Tool = {
  name: 'compare_protective_risk',
  description: `Compare protective vs risk alleles directly.

Side-by-side comparison of alleles with opposite disease associations.

Perfect for: disease mechanism studies, therapeutic target identification.

Example: "Compare APOE protective allele vs risk allele"`,
  inputSchema: {
    type: 'object',
    properties: {
      protective_variant: {
        type: 'object',
        properties: {
          chromosome: { type: 'string', pattern: '^chr([1-9]|1[0-9]|2[0-2]|X|Y)$' },
          position: { type: 'number', minimum: 1 },
          ref: { type: 'string', pattern: '^[ATGCatgc]+$' },
          alt: { type: 'string', pattern: '^[ATGCatgc]+$' },
        },
        required: ['chromosome', 'position', 'ref', 'alt'],
      },
      risk_variant: {
        type: 'object',
        properties: {
          chromosome: { type: 'string', pattern: '^chr([1-9]|1[0-9]|2[0-2]|X|Y)$' },
          position: { type: 'number', minimum: 1 },
          ref: { type: 'string', pattern: '^[ATGCatgc]+$' },
          alt: { type: 'string', pattern: '^[ATGCatgc]+$' },
        },
        required: ['chromosome', 'position', 'ref', 'alt'],
      },
    },
    required: ['protective_variant', 'risk_variant'],
  },
};

export const BATCH_PATHOGENICITY_FILTER_TOOL: Tool = {
  name: 'batch_pathogenicity_filter',
  description: `Filter variants by pathogenicity threshold.

Efficiently identifies pathogenic variants from large lists.

Perfect for: VCF filtering, prioritizing clinical variants.

Example: "Filter 100 variants for pathogenicity > 0.7"`,
  inputSchema: {
    type: 'object',
    properties: {
      variants: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            chromosome: { type: 'string' },
            position: { type: 'number' },
            ref: { type: 'string' },
            alt: { type: 'string' },
          },
          required: ['chromosome', 'position', 'ref', 'alt'],
        },
        minItems: 1,
      },
      threshold: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'Pathogenicity threshold (0-1, default: 0.5)',
      },
    },
    required: ['variants'],
  },
};

export const COMPARE_VARIANTS_SAME_GENE_TOOL: Tool = {
  name: 'compare_variants_same_gene',
  description: `Compare multiple variants within the same gene.

Ranks variants by impact within a single gene context.

Perfect for: gene-level analysis, compound heterozygote analysis.

Example: "Compare 5 BRCA1 variants"`,
  inputSchema: {
    type: 'object',
    properties: {
      variants: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            chromosome: { type: 'string' },
            position: { type: 'number' },
            ref: { type: 'string' },
            alt: { type: 'string' },
          },
          required: ['chromosome', 'position', 'ref', 'alt'],
        },
        minItems: 2,
      },
      gene_name: {
        type: 'string',
        description: 'Optional: gene name for context',
      },
    },
    required: ['variants'],
  },
};

export const PREDICT_ALLELE_SPECIFIC_EFFECTS_TOOL: Tool = {
  name: 'predict_allele_specific_effects',
  description: `Analyze allele-specific regulatory effects.

Detailed analysis of how each allele affects gene regulation differently.

Perfect for: ASE analysis, imprinting studies.

Example: "Analyze allele-specific effects of chr15:67890123A>G"`,
  inputSchema: {
    type: 'object',
    properties: {
      chromosome: { type: 'string', pattern: '^chr([1-9]|1[0-9]|2[0-2]|X|Y)$' },
      position: { type: 'number', minimum: 1 },
      ref: { type: 'string', pattern: '^[ATGCatgc]+$' },
      alt: { type: 'string', pattern: '^[ATGCatgc]+$' },
      tissue_type: { type: 'string' },
    },
    required: ['chromosome', 'position', 'ref', 'alt'],
  },
};

export const ANNOTATE_REGULATORY_CONTEXT_TOOL: Tool = {
  name: 'annotate_regulatory_context',
  description: `Provide comprehensive regulatory annotation for a variant.

Returns detailed regulatory context including all modalities.

Perfect for: variant annotation pipelines, comprehensive reports.

Example: "Annotate regulatory context of chr7:12345678C>A"`,
  inputSchema: {
    type: 'object',
    properties: {
      chromosome: { type: 'string', pattern: '^chr([1-9]|1[0-9]|2[0-2]|X|Y)$' },
      position: { type: 'number', minimum: 1 },
      ref: { type: 'string', pattern: '^[ATGCatgc]+$' },
      alt: { type: 'string', pattern: '^[ATGCatgc]+$' },
      tissue_type: { type: 'string' },
    },
    required: ['chromosome', 'position', 'ref', 'alt'],
  },
};

export const BATCH_MODALITY_SCREEN_TOOL: Tool = {
  name: 'batch_modality_screen',
  description: `Screen variants across specific regulatory modalities.

Efficiently tests multiple variants for specific regulatory effects.

Perfect for: targeted regulatory screens, modality-specific studies.

Example: "Screen 20 variants for splicing effects"`,
  inputSchema: {
    type: 'object',
    properties: {
      variants: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            chromosome: { type: 'string' },
            position: { type: 'number' },
            ref: { type: 'string' },
            alt: { type: 'string' },
          },
          required: ['chromosome', 'position', 'ref', 'alt'],
        },
        minItems: 1,
      },
      modality: {
        type: 'string',
        enum: ['expression', 'splicing', 'tf_binding', 'chromatin'],
        description: 'Regulatory modality to screen',
      },
    },
    required: ['variants', 'modality'],
  },
};

export const GENERATE_VARIANT_REPORT_TOOL: Tool = {
  name: 'generate_variant_report',
  description: `Generate comprehensive clinical report for a variant.

Full analysis with all modalities and clinical interpretation.

Perfect for: clinical reports, diagnostic summaries.

Example: "Generate full report for chr13:32912345G>T"`,
  inputSchema: {
    type: 'object',
    properties: {
      chromosome: { type: 'string', pattern: '^chr([1-9]|1[0-9]|2[0-2]|X|Y)$' },
      position: { type: 'number', minimum: 1 },
      ref: { type: 'string', pattern: '^[ATGCatgc]+$' },
      alt: { type: 'string', pattern: '^[ATGCatgc]+$' },
      tissue_type: { type: 'string' },
    },
    required: ['chromosome', 'position', 'ref', 'alt'],
  },
};

export const EXPLAIN_VARIANT_IMPACT_TOOL: Tool = {
  name: 'explain_variant_impact',
  description: `Provide human-readable explanation of variant impact.

Translates technical predictions into plain language.

Perfect for: patient reports, non-technical summaries.

Example: "Explain the impact of chr9:12345678A>C in simple terms"`,
  inputSchema: {
    type: 'object',
    properties: {
      chromosome: { type: 'string', pattern: '^chr([1-9]|1[0-9]|2[0-2]|X|Y)$' },
      position: { type: 'number', minimum: 1 },
      ref: { type: 'string', pattern: '^[ATGCatgc]+$' },
      alt: { type: 'string', pattern: '^[ATGCatgc]+$' },
      tissue_type: { type: 'string' },
    },
    required: ['chromosome', 'position', 'ref', 'alt'],
  },
};

/**
 * All available tools
 */
export const ALL_TOOLS: Tool[] = [
  PREDICT_VARIANT_TOOL,
  BATCH_SCORE_TOOL,
  ASSESS_PATHOGENICITY_TOOL,
  PREDICT_TISSUE_SPECIFIC_TOOL,
  COMPARE_VARIANTS_TOOL,
  PREDICT_SPLICE_IMPACT_TOOL,
  PREDICT_EXPRESSION_IMPACT_TOOL,
  ANALYZE_GWAS_LOCUS_TOOL,
  COMPARE_ALLELES_TOOL,
  BATCH_TISSUE_COMPARISON_TOOL,
  PREDICT_TF_BINDING_IMPACT_TOOL,
  PREDICT_CHROMATIN_IMPACT_TOOL,
  COMPARE_PROTECTIVE_RISK_TOOL,
  BATCH_PATHOGENICITY_FILTER_TOOL,
  COMPARE_VARIANTS_SAME_GENE_TOOL,
  PREDICT_ALLELE_SPECIFIC_EFFECTS_TOOL,
  ANNOTATE_REGULATORY_CONTEXT_TOOL,
  BATCH_MODALITY_SCREEN_TOOL,
  GENERATE_VARIANT_REPORT_TOOL,
  EXPLAIN_VARIANT_IMPACT_TOOL,
];
