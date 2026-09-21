// src/tools.ts

import { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP Tool Definitions for AlphaGenome Server
 *
 * Every description ends with the same statement: these are model predictions
 * for research prioritization, not clinical classifications. No tool returns a
 * pathogenicity class, a risk label or a percent change.
 */

const RESEARCH_NOTE = `Results are AlphaGenome model predictions for research prioritization, not clinical classifications: scores and calibrated quantiles are reported as returned, and no pathogenic/benign call is made.`;

const ATLAS_SCOPE_NOTE = `The Atlas holds precomputed AlphaGenome scores for single-nucleotide substitutions on the human reference genome (hg38, chr1-22, chrX, chrY). Indels, multi-nucleotide variants and custom sequences are not in it; use predict_variant_effect for those.`;

const SIZE_NOTE = `The response is a summary, never a full score matrix: ranked rows only, capped at top_n (default 25, max 100) and at 40,000 characters.`;

const ROUTING_NOTE = `Source: a single-nucleotide variant is answered from the precomputed AlphaGenome Atlas; an indel or multi-nucleotide variant runs live inference (score_variant). Both return the same scorers in the same shape. Chosen automatically, overridable with \`source\`, and always stated in the result.`;

const LIVE_NOTE = `Runs live inference (score_variant with the SDK's recommended variant scorers); works for single-nucleotide variants, indels and multi-nucleotide variants. The result states \`source: live\`.`;

// ----------------------------------------------------------------------------
// Shared input properties
// ----------------------------------------------------------------------------

const CHROMOSOME = {
  type: 'string',
  description: 'Chromosome (chr1-chr22, chrX, chrY)',
  pattern: '^chr([1-9]|1[0-9]|2[0-2]|X|Y)$',
} as const;

const POSITION = {
  type: 'number',
  description: 'Genomic position (1-based, hg38)',
  minimum: 1,
} as const;

const REF = {
  type: 'string',
  description: 'Reference allele (A, C, G, T; more than one base for an indel)',
  pattern: '^[ATGCatgc]+$',
} as const;

const ALT = {
  type: 'string',
  description: 'Alternate allele (A, C, G, T; more than one base for an indel)',
  pattern: '^[ATGCatgc]+$',
} as const;

const VARIANT_PROPERTIES = { chromosome: CHROMOSOME, position: POSITION, ref: REF, alt: ALT };
const VARIANT_REQUIRED = ['chromosome', 'position', 'ref', 'alt'];

const VARIANT_OBJECT = {
  type: 'object',
  properties: {
    ...VARIANT_PROPERTIES,
    variant_id: { type: 'string', description: 'Optional: variant identifier (e.g., rs number)' },
  },
  required: VARIANT_REQUIRED,
} as const;

const LIVE_VARIANTS = {
  type: 'array',
  items: VARIANT_OBJECT,
  description: 'Variants to score (1-100)',
  minItems: 1,
  maxItems: 100,
} as const;

const TISSUE = {
  type: 'string',
  description:
    'Optional: keep only the tracks of one tissue or cell type. A name (brain, neuron, blood, liver, heart, lung, kidney) or an ontology CURIE (e.g., UBERON:0000955, CL:0000540). Default: all tissues.',
} as const;

const SOURCE = {
  type: 'string',
  enum: ['auto', 'atlas', 'live'],
  description:
    'Optional: where the answer comes from (default: auto). ' +
    'auto = the precomputed AlphaGenome Atlas for single-nucleotide substitutions, live inference for everything else ' +
    '(indels, multi-nucleotide variants); falls back to live only when the Atlas does not hold the variant. ' +
    'atlas = Atlas only, errors instead of falling back. live = always run the model. ' +
    'The result always states which source answered.',
} as const;

const SCORERS = {
  type: 'array',
  items: { type: 'string' },
  description:
    'Optional: scorer names to use instead of the defaults. Names come from atlas_list_scorers and are the same for both sources, except the AVI scorers, which the Atlas alone serves.',
} as const;

const TOP_N = {
  type: 'number',
  description: 'Rows to return (default: 25, max: 100)',
  minimum: 1,
  maximum: 100,
} as const;

function singleVariantTool(
  name: string,
  description: string,
  extra: Record<string, unknown> = {}
): Tool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: { ...VARIANT_PROPERTIES, tissue_type: TISSUE, ...extra },
      required: VARIANT_REQUIRED,
    },
  };
}

// ----------------------------------------------------------------------------
// Tools that choose between the Atlas and live inference
// ----------------------------------------------------------------------------

export const PREDICT_VARIANT_TOOL = singleVariantTool(
  'predict_variant_effect',
  `Predicted regulatory effect of a genetic variant, per modality: the strongest tracks of each scorer (expression, transcription start, chromatin accessibility, histone marks, transcription factor binding, splicing), each with its score, calibrated quantile, gene, tissue or cell type, and assay. From the Atlas the AlphaGenome Variant Impact (AVI) score is included.

${ROUTING_NOTE}

${SIZE_NOTE}

${RESEARCH_NOTE}

Example: "Analyze chr19:44908684 T>C with AlphaGenome"`,
  {
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
      description: 'Optional: modalities to report (default: one scorer per modality)',
    },
    source: SOURCE,
    scorers: SCORERS,
  }
);

export const BATCH_SCORE_TOOL: Tool = {
  name: 'batch_score_variants',
  description: `Score up to 100 variants and rank them by predicted effect.

Each variant is routed on its own: single-nucleotide variants to the Atlas, the rest to live inference. A mixed batch comes back as two separately ranked groups, because the Atlas group is ranked by the AVI score and live inference has no AVI score; the two must not be compared. The result reports how many variants came from each source and how many fell back.

Scoring metric (used when \`scorers\` is not given): rna_seq = RNA_SEQ, splice = SPLICE_SITES, regulatory_impact and combined = AVI_SCORE from the Atlas and every modality (ranked by the largest absolute quantile) from live inference.

${RESEARCH_NOTE}

Example: "Score these 50 variants and show me the top 10 by predicted effect"`,
  inputSchema: {
    type: 'object',
    properties: {
      variants: LIVE_VARIANTS,
      scoring_metric: {
        type: 'string',
        enum: ['rna_seq', 'splice', 'regulatory_impact', 'combined'],
        description: 'What to rank by',
      },
      top_n: {
        type: 'number',
        description: 'Variants to return per group (default: 10, max: 100)',
        minimum: 1,
        maximum: 100,
      },
      source: SOURCE,
      scorers: SCORERS,
    },
    required: ['variants', 'scoring_metric'],
  },
};

export const ASSESS_PATHOGENICITY_TOOL = singleVariantTool(
  'assess_pathogenicity',
  `Predicted effect size of a variant across modalities, for prioritization. The tool name is kept for compatibility: it does NOT classify a variant as pathogenic or benign, and \`classification\` is always null.

Returns the strongest effect per scorer (score, calibrated quantile, where it was seen), the largest absolute quantile, and, for a single-nucleotide variant answered from the Atlas, the AlphaGenome Variant Impact (AVI) score. \`avi_score\` is null on the live path, because the AVI score is served by the Atlas only.

${ROUTING_NOTE}

${RESEARCH_NOTE}

Example: "How large is the predicted effect of chr19:44908684 T>C?"`,
  { source: SOURCE, scorers: SCORERS }
);

export const BATCH_PATHOGENICITY_FILTER_TOOL: Tool = {
  name: 'batch_pathogenicity_filter',
  description: `Keep the variants whose predicted effect reaches a threshold, ranked. The tool name is kept for compatibility: it filters on predicted effect size, NOT on pathogenicity, and classifies nothing.

\`threshold\` is the smallest absolute calibrated quantile (0 to 1) a variant must reach to be kept (default 0.99): the AVI score's quantile for variants answered from the Atlas, the largest quantile across modalities for live inference. Variants are routed per variant and reported per source; groups from different sources are not comparable.

${RESEARCH_NOTE}

Example: "Which of these variants have a predicted effect above the 99.9th percentile?"`,
  inputSchema: {
    type: 'object',
    properties: {
      variants: LIVE_VARIANTS,
      threshold: {
        type: 'number',
        description: 'Smallest absolute quantile to keep, between 0 and 1 (default: 0.99)',
        minimum: 0,
        maximum: 1,
      },
      source: SOURCE,
      scorers: SCORERS,
    },
    required: ['variants'],
  },
};

export const GENERATE_VARIANT_REPORT_TOOL = singleVariantTool(
  'generate_variant_report',
  `A fuller report of one variant's predicted molecular effects: more rows per scorer than predict_variant_effect and, from the Atlas, the AVI score with its feature attributions (AVI_SCORE_FEATURE_IMPORTANCE). It is a research summary, not a clinical report: it contains no pathogenicity classification and no recommendation.

${ROUTING_NOTE}

${SIZE_NOTE}

${RESEARCH_NOTE}

Example: "Generate a report for chr19:44908684 T>C"`,
  { source: SOURCE, scorers: SCORERS }
);

export const EXPLAIN_VARIANT_IMPACT_TOOL = singleVariantTool(
  'explain_variant_impact',
  `Plain sentences that restate a variant's predicted effects: the AVI score and its largest contributions (from the Atlas), then the strongest effect of each modality ordered by absolute quantile, with the direction for signed scorers. Descriptive only: the sentences restate returned numbers and make no statement about pathogenicity.

${ROUTING_NOTE}

${RESEARCH_NOTE}

Example: "Explain the predicted effect of chr17:49210289 C>T in plain language"`,
  { source: SOURCE, scorers: SCORERS }
);

// ----------------------------------------------------------------------------
// Live-inference tools
// ----------------------------------------------------------------------------

export const PREDICT_TISSUE_SPECIFIC_TOOL: Tool = {
  name: 'predict_tissue_specific',
  description: `The strongest predicted effect of a variant in each of several tissues: the same scores, filtered to the tracks of one tissue at a time.

${LIVE_NOTE}

${RESEARCH_NOTE}

Example: "Compare the predicted effect of chr19:44908684 T>C in brain, liver and heart"`,
  inputSchema: {
    type: 'object',
    properties: {
      ...VARIANT_PROPERTIES,
      tissues: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Tissue names (brain, neuron, blood, liver, heart, lung, kidney) or ontology CURIEs. Default: brain, liver, heart',
      },
    },
    required: VARIANT_REQUIRED,
  },
};

export const COMPARE_VARIANTS_TOOL: Tool = {
  name: 'compare_variants',
  description: `Two variants side by side: the strongest predicted effect of each modality for both, and which of the two has the larger absolute quantile per scorer. A comparison of predicted effect sizes, not of severity.

${LIVE_NOTE}

${RESEARCH_NOTE}

Example: "Compare APOE rs429358 and rs7412"`,
  inputSchema: {
    type: 'object',
    properties: { variant1: VARIANT_OBJECT, variant2: VARIANT_OBJECT },
    required: ['variant1', 'variant2'],
  },
};

export const PREDICT_SPLICE_IMPACT_TOOL = singleVariantTool(
  'predict_splice_impact',
  `Predicted splicing effects of a variant: splice sites, splice site usage and splice junctions, with the gene and junction of each.

${LIVE_NOTE}

${RESEARCH_NOTE}`
);

export const PREDICT_EXPRESSION_IMPACT_TOOL = singleVariantTool(
  'predict_expression_impact',
  `Predicted gene expression effects of a variant: RNA-seq (log fold change per gene and tissue) and CAGE.

${LIVE_NOTE}

${RESEARCH_NOTE}`
);

export const ANALYZE_GWAS_LOCUS_TOOL: Tool = {
  name: 'analyze_gwas_locus',
  description: `Rank the variants of a locus by predicted effect (largest absolute quantile across modalities), to prioritize candidates for follow-up. For single-nucleotide variants only, atlas_lookup_variants or atlas_scan_region is faster and adds the AVI score.

${LIVE_NOTE}

${RESEARCH_NOTE}`,
  inputSchema: {
    type: 'object',
    properties: {
      variants: LIVE_VARIANTS,
      chromosome: { type: 'string', description: 'Optional: locus chromosome, for the label' },
      start: { type: 'number', description: 'Optional: locus start, for the label' },
      end: { type: 'number', description: 'Optional: locus end, for the label' },
    },
    required: ['variants'],
  },
};

export const COMPARE_ALLELES_TOOL: Tool = {
  name: 'compare_alleles',
  description: `Rank the alternate alleles of one position by predicted effect.

${LIVE_NOTE}

${RESEARCH_NOTE}`,
  inputSchema: {
    type: 'object',
    properties: {
      chromosome: CHROMOSOME,
      position: POSITION,
      ref: REF,
      alts: { type: 'array', items: { type: 'string' }, description: 'Alternate alleles (1-20)' },
    },
    required: ['chromosome', 'position', 'ref', 'alts'],
  },
};

export const BATCH_TISSUE_COMPARISON_TOOL: Tool = {
  name: 'batch_tissue_comparison',
  description: `Rank several variants by predicted effect within each of several tissues: one ranking per tissue.

${LIVE_NOTE}

${RESEARCH_NOTE}`,
  inputSchema: {
    type: 'object',
    properties: {
      variants: LIVE_VARIANTS,
      tissues: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tissue names or ontology CURIEs (1-10)',
      },
    },
    required: ['variants', 'tissues'],
  },
};

export const PREDICT_TF_BINDING_IMPACT_TOOL = singleVariantTool(
  'predict_tf_binding_impact',
  `Predicted transcription factor binding effects of a variant (TF ChIP-seq), with the factor and cell type of each.

${LIVE_NOTE}

${RESEARCH_NOTE}`
);

export const PREDICT_CHROMATIN_IMPACT_TOOL = singleVariantTool(
  'predict_chromatin_impact',
  `Predicted chromatin accessibility effects of a variant (ATAC-seq and DNase-seq).

${LIVE_NOTE}

${RESEARCH_NOTE}`
);

export const COMPARE_PROTECTIVE_RISK_TOOL: Tool = {
  name: 'compare_protective_risk',
  description: `Two variants side by side, labelled as the caller names them. The tool compares predicted effect sizes per modality; it does not judge which allele is protective or a risk.

${LIVE_NOTE}

${RESEARCH_NOTE}`,
  inputSchema: {
    type: 'object',
    properties: { protective_variant: VARIANT_OBJECT, risk_variant: VARIANT_OBJECT },
    required: ['protective_variant', 'risk_variant'],
  },
};

export const COMPARE_VARIANTS_SAME_GENE_TOOL: Tool = {
  name: 'compare_variants_same_gene',
  description: `Rank several variants by their predicted effect on one gene. With gene_name, the gene-level scorers (RNA_SEQ, SPLICE_SITES) are restricted to that gene.

${LIVE_NOTE}

${RESEARCH_NOTE}`,
  inputSchema: {
    type: 'object',
    properties: {
      variants: LIVE_VARIANTS,
      gene_name: { type: 'string', description: 'Optional: gene symbol (e.g., APOE)' },
    },
    required: ['variants'],
  },
};

export const PREDICT_ALLELE_SPECIFIC_EFFECTS_TOOL = singleVariantTool(
  'predict_allele_specific_effects',
  `Predicted expression with the alternate allele against the reference allele: the RNA_SEQ scorer is that log fold change per gene and tissue, and RNA_SEQ_ACTIVE gives the expression level alongside it.

${LIVE_NOTE}

${RESEARCH_NOTE}`
);

export const ANNOTATE_REGULATORY_CONTEXT_TOOL = singleVariantTool(
  'annotate_regulatory_context',
  `The predicted effects of a variant across every regulatory modality at once: accessibility, histone marks, TF binding, CAGE, RNA-seq, splice sites, polyadenylation and contact maps. Shows where the predicted effect concentrates; it does not label the variant.

${LIVE_NOTE}

${RESEARCH_NOTE}`
);

export const BATCH_MODALITY_SCREEN_TOOL: Tool = {
  name: 'batch_modality_screen',
  description: `Rank several variants by predicted effect within one modality: expression (RNA_SEQ, CAGE), splicing (SPLICE_SITES, SPLICE_SITE_USAGE), tf_binding (CHIP_TF) or chromatin (DNASE, ATAC).

${LIVE_NOTE}

${RESEARCH_NOTE}`,
  inputSchema: {
    type: 'object',
    properties: {
      variants: LIVE_VARIANTS,
      modality: { type: 'string', enum: ['expression', 'splicing', 'tf_binding', 'chromatin'] },
    },
    required: ['variants', 'modality'],
  },
};

// ----------------------------------------------------------------------------
// AlphaGenome Atlas tools: precomputed scores, no model call
// ----------------------------------------------------------------------------

const ATLAS_VARIANT_PROPERTIES = {
  chromosome: CHROMOSOME,
  position: POSITION,
  ref: {
    type: 'string',
    description: 'Reference base (one of A, C, G, T). Must match hg38 at this position.',
    pattern: '^[ATGCatgc]$',
  },
  alt: {
    type: 'string',
    description: 'Alternate base (one of A, C, G, T)',
    pattern: '^[ATGCatgc]$',
  },
} as const;

export const ATLAS_LIST_SCORERS_TOOL: Tool = {
  name: 'atlas_list_scorers',
  description: `List the variant scorers available in the AlphaGenome Atlas, including the AlphaGenome Variant Impact score (AVI_SCORE) and its feature attributions (AVI_SCORE_FEATURE_IMPORTANCE, AVI_SCORE_MODEL_FEATURES).

Returns each scorer's name, number of tracks and the assays behind it. Use these names in the \`scorers\` parameter of the other tools. Every scorer except the AVI ones is also available from live inference under the same name. Cached for the session after the first call.

${ATLAS_SCOPE_NOTE}`,
  inputSchema: { type: 'object', properties: {} },
};

export const ATLAS_LOOKUP_VARIANT_TOOL: Tool = {
  name: 'atlas_lookup_variant',
  description: `Look up the precomputed AlphaGenome scores of one single-nucleotide variant. No model call, so it answers in seconds.

Returns, per scorer, the strongest tracks for the variant ranked by absolute score, each with its calibrated quantile, gene, tissue or cell type, and assay. Default scorers: AVI_SCORE plus one per modality (RNA_SEQ, CAGE, DNASE, CHIP_HISTONE, CHIP_TF, SPLICE_SITES).

If the reference base does not match hg38, the Atlas says which base it expected and that message is returned as a validation error.

${ATLAS_SCOPE_NOTE}

${SIZE_NOTE}

${RESEARCH_NOTE}

Example: "Look up chr19:44908684 T>C in the AlphaGenome Atlas"`,
  inputSchema: {
    type: 'object',
    properties: { ...ATLAS_VARIANT_PROPERTIES, scorers: SCORERS, top_n: TOP_N },
    required: VARIANT_REQUIRED,
  },
};

export const ATLAS_LOOKUP_VARIANTS_TOOL: Tool = {
  name: 'atlas_lookup_variants',
  description: `Look up precomputed AlphaGenome scores for up to 500 single-nucleotide variants in one call and rank them.

Returns one row per variant (its strongest score and where it was seen), ranked. Default scorer: AVI_SCORE (AlphaGenome Variant Impact), one number per variant. With several scorers the ranking uses the largest absolute quantile. Variants the Atlas does not hold and variants it rejects (for example a reference base that does not match hg38) are listed separately with the reason; they do not fail the call.

${ATLAS_SCOPE_NOTE}

${SIZE_NOTE}

${RESEARCH_NOTE}

Example: "Rank these 200 GWAS SNPs by their Atlas scores"`,
  inputSchema: {
    type: 'object',
    properties: {
      variants: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ...ATLAS_VARIANT_PROPERTIES,
            variant_id: {
              type: 'string',
              description: 'Optional: variant identifier (e.g., rs number)',
            },
          },
          required: VARIANT_REQUIRED,
        },
        description: 'Single-nucleotide variants to look up (1-500)',
        minItems: 1,
        maxItems: 500,
      },
      scorers: SCORERS,
      top_n: TOP_N,
    },
    required: ['variants'],
  },
};

export const ATLAS_SCAN_REGION_TOOL: Tool = {
  name: 'atlas_scan_region',
  description: `Scan a genomic region in the AlphaGenome Atlas: every possible single-nucleotide substitution in the interval, ranked. Answers "which positions in this region matter most?" without running the model.

Region width: at most 10,000 bp. Up to 50,000 bp only with allow_large_region=true. A scan is one API request per 32 bp under a requests-per-minute quota, so a large scan can take minutes. If the quota or the time limit stops a scan early, the partial result is returned, marked "Incomplete", with the range that was really scanned; the ranking then covers that range only.

Default scorer: AVI_SCORE (about 7 seconds for 2,000 bp). Multi-track scorers are much slower (2,000 bp: DNASE 17 s, CHIP_TF 86 s). Scorers with one row per gene or junction (RNA_SEQ, SPLICE_JUNCTIONS, ...) cannot be used for a scan: scan with AVI_SCORE, then use atlas_lookup_variant on the top variants.

${ATLAS_SCOPE_NOTE}

${SIZE_NOTE}

${RESEARCH_NOTE}

Example: "Scan chr17:49209289-49211289 and show the 10 substitutions with the largest predicted effect"`,
  inputSchema: {
    type: 'object',
    properties: {
      chromosome: CHROMOSOME,
      start: { type: 'number', description: 'Start position (1-based, hg38)', minimum: 1 },
      end: {
        type: 'number',
        description:
          'End position (greater than start; at most start + 10,000, or start + 50,000 with allow_large_region)',
        minimum: 1,
      },
      allow_large_region: {
        type: 'boolean',
        description:
          'Set to true to scan more than 10,000 bp (up to 50,000 bp). Slower, and the result may be incomplete (default: false)',
      },
      scorers: SCORERS,
      top_n: TOP_N,
    },
    required: ['chromosome', 'start', 'end'],
  },
};

// Export all tools
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
  ATLAS_LIST_SCORERS_TOOL,
  ATLAS_LOOKUP_VARIANT_TOOL,
  ATLAS_LOOKUP_VARIANTS_TOOL,
  ATLAS_SCAN_REGION_TOOL,
];
