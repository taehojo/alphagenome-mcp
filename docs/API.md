# AlphaGenome MCP Server: Tool Reference

Generated from `src/tools.ts` by `npm run docs:api`; do not edit by hand.

24 tools. Every result states its source (`atlas` or `live`). Results are AlphaGenome model predictions for research prioritization, not clinical classifications: scores and calibrated quantiles are reported as returned, and no tool makes a pathogenic/benign call, assigns a risk label or states a percent change. Responses are ranked summaries, never a full score matrix, capped at `top_n` rows and 40,000 characters.

Installation, environment variables, routing rules, default scorers and worked examples are in the [README](../README.md).

## Contents

- Tools that choose between the Atlas and live inference: [predict_variant_effect](#predict_variant_effect), [batch_score_variants](#batch_score_variants), [assess_pathogenicity](#assess_pathogenicity), [batch_pathogenicity_filter](#batch_pathogenicity_filter), [generate_variant_report](#generate_variant_report), [explain_variant_impact](#explain_variant_impact)
- Live-inference tools: [predict_tissue_specific](#predict_tissue_specific), [compare_variants](#compare_variants), [predict_splice_impact](#predict_splice_impact), [predict_expression_impact](#predict_expression_impact), [analyze_gwas_locus](#analyze_gwas_locus), [compare_alleles](#compare_alleles), [batch_tissue_comparison](#batch_tissue_comparison), [predict_tf_binding_impact](#predict_tf_binding_impact), [predict_chromatin_impact](#predict_chromatin_impact), [compare_protective_risk](#compare_protective_risk), [compare_variants_same_gene](#compare_variants_same_gene), [predict_allele_specific_effects](#predict_allele_specific_effects), [annotate_regulatory_context](#annotate_regulatory_context), [batch_modality_screen](#batch_modality_screen)
- AlphaGenome Atlas tools: [atlas_list_scorers](#atlas_list_scorers), [atlas_lookup_variant](#atlas_lookup_variant), [atlas_lookup_variants](#atlas_lookup_variants), [atlas_scan_region](#atlas_scan_region)

## Tools that choose between the Atlas and live inference

A single-nucleotide variant is answered from the precomputed AlphaGenome Atlas; an indel or multi-nucleotide variant runs live inference. Override with `source`.

### predict_variant_effect

Predicted regulatory effect of a genetic variant, per modality: the strongest tracks of each scorer (expression, transcription start, chromatin accessibility, histone marks, transcription factor binding, splicing), each with its score, calibrated quantile, gene, tissue or cell type, and assay. From the Atlas the AlphaGenome Variant Impact (AVI) score is included.

**Source behavior.** `source=auto` (default): Atlas for single-nucleotide variants, live inference otherwise; falls back to live only when the Atlas does not hold the variant, and labels it `live (atlas fallback: <reason>)`. `source=atlas`: Atlas only, never falls back. `source=live`: always runs the model.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `chromosome` | string | yes | Chromosome (chr1-chr22, chrX, chrY) |
| `position` | number | yes | Genomic position (1-based, hg38) (min 1) |
| `ref` | string | yes | Reference allele (A, C, G, T; more than one base for an indel) |
| `alt` | string | yes | Alternate allele (A, C, G, T; more than one base for an indel) |
| `tissue_type` | string | no | Optional: keep only the tracks of one tissue or cell type. A name (brain, neuron, blood, liver, heart, lung, kidney) or an ontology CURIE (e.g., UBERON:0000955, CL:0000540). Default: all tissues. |
| `output_types` | array of `rna_seq` \| `cage` \| `splice` \| `histone` \| `tf_binding` \| `dnase` \| `atac` \| `contact_map` | no | Optional: modalities to report (default: one scorer per modality) |
| `source` | `auto` \| `atlas` \| `live` | no | Optional: where the answer comes from (default: auto). auto = the precomputed AlphaGenome Atlas for single-nucleotide substitutions, live inference for everything else (indels, multi-nucleotide variants); falls back to live only when the Atlas does not hold the variant. atlas = Atlas only, errors instead of falling back. live = always run the model. The result always states which source answered. |
| `scorers` | array of string | no | Optional: scorer names to use instead of the defaults. Names come from atlas_list_scorers and are the same for both sources, except the AVI scorers, which the Atlas alone serves. |

Example: "Analyze chr19:44908684 T>C with AlphaGenome"

### batch_score_variants

Score up to 100 variants and rank them by predicted effect.

Each variant is routed on its own: single-nucleotide variants to the Atlas, the rest to live inference. A mixed batch comes back as two separately ranked groups, because the Atlas group is ranked by the AVI score and live inference has no AVI score; the two must not be compared. The result reports how many variants came from each source and how many fell back.

Scoring metric (used when `scorers` is not given): rna_seq = RNA_SEQ, splice = SPLICE_SITES, regulatory_impact and combined = AVI_SCORE from the Atlas and every modality (ranked by the largest absolute quantile) from live inference.

**Source behavior.** `source=auto` (default): Atlas for single-nucleotide variants, live inference otherwise; falls back to live only when the Atlas does not hold the variant, and labels it `live (atlas fallback: <reason>)`. `source=atlas`: Atlas only, never falls back. `source=live`: always runs the model.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `variants` | array of variant objects | yes | Variants to score (1-100) (at least 1, at most 100) Fields: `chromosome`, `position`, `ref`, `alt`, `variant_id` (optional). |
| `scoring_metric` | `rna_seq` \| `splice` \| `regulatory_impact` \| `combined` | yes | What to rank by |
| `top_n` | number | no | Variants to return per group (default: 10, max: 100) (min 1, max 100) |
| `source` | `auto` \| `atlas` \| `live` | no | Optional: where the answer comes from (default: auto). auto = the precomputed AlphaGenome Atlas for single-nucleotide substitutions, live inference for everything else (indels, multi-nucleotide variants); falls back to live only when the Atlas does not hold the variant. atlas = Atlas only, errors instead of falling back. live = always run the model. The result always states which source answered. |
| `scorers` | array of string | no | Optional: scorer names to use instead of the defaults. Names come from atlas_list_scorers and are the same for both sources, except the AVI scorers, which the Atlas alone serves. |

Example: "Score these 50 variants and show me the top 10 by predicted effect"

### assess_pathogenicity

Predicted effect size of a variant across modalities, for prioritization. The tool name is kept for compatibility: it does NOT classify a variant as pathogenic or benign, and `classification` is always null.

Returns the strongest effect per scorer (score, calibrated quantile, where it was seen), the largest absolute quantile, and, for a single-nucleotide variant answered from the Atlas, the AlphaGenome Variant Impact (AVI) score. `avi_score` is null on the live path, because the AVI score is served by the Atlas only.

**Source behavior.** `source=auto` (default): Atlas for single-nucleotide variants, live inference otherwise; falls back to live only when the Atlas does not hold the variant, and labels it `live (atlas fallback: <reason>)`. `source=atlas`: Atlas only, never falls back. `source=live`: always runs the model.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `chromosome` | string | yes | Chromosome (chr1-chr22, chrX, chrY) |
| `position` | number | yes | Genomic position (1-based, hg38) (min 1) |
| `ref` | string | yes | Reference allele (A, C, G, T; more than one base for an indel) |
| `alt` | string | yes | Alternate allele (A, C, G, T; more than one base for an indel) |
| `tissue_type` | string | no | Optional: keep only the tracks of one tissue or cell type. A name (brain, neuron, blood, liver, heart, lung, kidney) or an ontology CURIE (e.g., UBERON:0000955, CL:0000540). Default: all tissues. |
| `source` | `auto` \| `atlas` \| `live` | no | Optional: where the answer comes from (default: auto). auto = the precomputed AlphaGenome Atlas for single-nucleotide substitutions, live inference for everything else (indels, multi-nucleotide variants); falls back to live only when the Atlas does not hold the variant. atlas = Atlas only, errors instead of falling back. live = always run the model. The result always states which source answered. |
| `scorers` | array of string | no | Optional: scorer names to use instead of the defaults. Names come from atlas_list_scorers and are the same for both sources, except the AVI scorers, which the Atlas alone serves. |

Example: "How large is the predicted effect of chr19:44908684 T>C?"

### batch_pathogenicity_filter

Keep the variants whose predicted effect reaches a threshold, ranked. The tool name is kept for compatibility: it filters on predicted effect size, NOT on pathogenicity, and classifies nothing.

`threshold` is the smallest absolute calibrated quantile (0 to 1) a variant must reach to be kept (default 0.99): the AVI score's quantile for variants answered from the Atlas, the largest quantile across modalities for live inference. Variants are routed per variant and reported per source; groups from different sources are not comparable.

**Source behavior.** `source=auto` (default): Atlas for single-nucleotide variants, live inference otherwise; falls back to live only when the Atlas does not hold the variant, and labels it `live (atlas fallback: <reason>)`. `source=atlas`: Atlas only, never falls back. `source=live`: always runs the model.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `variants` | array of variant objects | yes | Variants to score (1-100) (at least 1, at most 100) Fields: `chromosome`, `position`, `ref`, `alt`, `variant_id` (optional). |
| `threshold` | number | no | Smallest absolute quantile to keep, between 0 and 1 (default: 0.99) (min 0, max 1) |
| `source` | `auto` \| `atlas` \| `live` | no | Optional: where the answer comes from (default: auto). auto = the precomputed AlphaGenome Atlas for single-nucleotide substitutions, live inference for everything else (indels, multi-nucleotide variants); falls back to live only when the Atlas does not hold the variant. atlas = Atlas only, errors instead of falling back. live = always run the model. The result always states which source answered. |
| `scorers` | array of string | no | Optional: scorer names to use instead of the defaults. Names come from atlas_list_scorers and are the same for both sources, except the AVI scorers, which the Atlas alone serves. |

Example: "Which of these variants have a predicted effect above the 99.9th percentile?"

### generate_variant_report

A fuller report of one variant's predicted molecular effects: more rows per scorer than predict_variant_effect and, from the Atlas, the AVI score with its feature attributions (AVI_SCORE_FEATURE_IMPORTANCE). It is a research summary, not a clinical report: it contains no pathogenicity classification and no recommendation.

**Source behavior.** `source=auto` (default): Atlas for single-nucleotide variants, live inference otherwise; falls back to live only when the Atlas does not hold the variant, and labels it `live (atlas fallback: <reason>)`. `source=atlas`: Atlas only, never falls back. `source=live`: always runs the model.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `chromosome` | string | yes | Chromosome (chr1-chr22, chrX, chrY) |
| `position` | number | yes | Genomic position (1-based, hg38) (min 1) |
| `ref` | string | yes | Reference allele (A, C, G, T; more than one base for an indel) |
| `alt` | string | yes | Alternate allele (A, C, G, T; more than one base for an indel) |
| `tissue_type` | string | no | Optional: keep only the tracks of one tissue or cell type. A name (brain, neuron, blood, liver, heart, lung, kidney) or an ontology CURIE (e.g., UBERON:0000955, CL:0000540). Default: all tissues. |
| `source` | `auto` \| `atlas` \| `live` | no | Optional: where the answer comes from (default: auto). auto = the precomputed AlphaGenome Atlas for single-nucleotide substitutions, live inference for everything else (indels, multi-nucleotide variants); falls back to live only when the Atlas does not hold the variant. atlas = Atlas only, errors instead of falling back. live = always run the model. The result always states which source answered. |
| `scorers` | array of string | no | Optional: scorer names to use instead of the defaults. Names come from atlas_list_scorers and are the same for both sources, except the AVI scorers, which the Atlas alone serves. |

Example: "Generate a report for chr19:44908684 T>C"

### explain_variant_impact

Plain sentences that restate a variant's predicted effects: the AVI score and its largest contributions (from the Atlas), then the strongest effect of each modality ordered by absolute quantile, with the direction for signed scorers. Descriptive only: the sentences restate returned numbers and make no statement about pathogenicity.

**Source behavior.** `source=auto` (default): Atlas for single-nucleotide variants, live inference otherwise; falls back to live only when the Atlas does not hold the variant, and labels it `live (atlas fallback: <reason>)`. `source=atlas`: Atlas only, never falls back. `source=live`: always runs the model.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `chromosome` | string | yes | Chromosome (chr1-chr22, chrX, chrY) |
| `position` | number | yes | Genomic position (1-based, hg38) (min 1) |
| `ref` | string | yes | Reference allele (A, C, G, T; more than one base for an indel) |
| `alt` | string | yes | Alternate allele (A, C, G, T; more than one base for an indel) |
| `tissue_type` | string | no | Optional: keep only the tracks of one tissue or cell type. A name (brain, neuron, blood, liver, heart, lung, kidney) or an ontology CURIE (e.g., UBERON:0000955, CL:0000540). Default: all tissues. |
| `source` | `auto` \| `atlas` \| `live` | no | Optional: where the answer comes from (default: auto). auto = the precomputed AlphaGenome Atlas for single-nucleotide substitutions, live inference for everything else (indels, multi-nucleotide variants); falls back to live only when the Atlas does not hold the variant. atlas = Atlas only, errors instead of falling back. live = always run the model. The result always states which source answered. |
| `scorers` | array of string | no | Optional: scorer names to use instead of the defaults. Names come from atlas_list_scorers and are the same for both sources, except the AVI scorers, which the Atlas alone serves. |

Example: "Explain the predicted effect of chr17:49210289 C>T in plain language"

## Live-inference tools

These run `score_variant` with the SDK's recommended variant scorers. They accept single-nucleotide variants, indels and multi-nucleotide variants.

### predict_tissue_specific

The strongest predicted effect of a variant in each of several tissues: the same scores, filtered to the tracks of one tissue at a time.

**Source behavior.** Live inference only. The result states `source: live`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `chromosome` | string | yes | Chromosome (chr1-chr22, chrX, chrY) |
| `position` | number | yes | Genomic position (1-based, hg38) (min 1) |
| `ref` | string | yes | Reference allele (A, C, G, T; more than one base for an indel) |
| `alt` | string | yes | Alternate allele (A, C, G, T; more than one base for an indel) |
| `tissues` | array of string | no | Tissue names (brain, neuron, blood, liver, heart, lung, kidney) or ontology CURIEs. Default: brain, liver, heart |

Example: "Compare the predicted effect of chr19:44908684 T>C in brain, liver and heart"

### compare_variants

Two variants side by side: the strongest predicted effect of each modality for both, and which of the two has the larger absolute quantile per scorer. A comparison of predicted effect sizes, not of severity.

**Source behavior.** Live inference only. The result states `source: live`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `variant1` | variant object | yes | Fields: `chromosome`, `position`, `ref`, `alt`, `variant_id` (optional). |
| `variant2` | variant object | yes | Fields: `chromosome`, `position`, `ref`, `alt`, `variant_id` (optional). |

Example: "Compare APOE rs429358 and rs7412"

### predict_splice_impact

Predicted splicing effects of a variant: splice sites, splice site usage and splice junctions, with the gene and junction of each.

**Source behavior.** Live inference only. The result states `source: live`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `chromosome` | string | yes | Chromosome (chr1-chr22, chrX, chrY) |
| `position` | number | yes | Genomic position (1-based, hg38) (min 1) |
| `ref` | string | yes | Reference allele (A, C, G, T; more than one base for an indel) |
| `alt` | string | yes | Alternate allele (A, C, G, T; more than one base for an indel) |
| `tissue_type` | string | no | Optional: keep only the tracks of one tissue or cell type. A name (brain, neuron, blood, liver, heart, lung, kidney) or an ontology CURIE (e.g., UBERON:0000955, CL:0000540). Default: all tissues. |

### predict_expression_impact

Predicted gene expression effects of a variant: RNA-seq (log fold change per gene and tissue) and CAGE.

**Source behavior.** Live inference only. The result states `source: live`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `chromosome` | string | yes | Chromosome (chr1-chr22, chrX, chrY) |
| `position` | number | yes | Genomic position (1-based, hg38) (min 1) |
| `ref` | string | yes | Reference allele (A, C, G, T; more than one base for an indel) |
| `alt` | string | yes | Alternate allele (A, C, G, T; more than one base for an indel) |
| `tissue_type` | string | no | Optional: keep only the tracks of one tissue or cell type. A name (brain, neuron, blood, liver, heart, lung, kidney) or an ontology CURIE (e.g., UBERON:0000955, CL:0000540). Default: all tissues. |

### analyze_gwas_locus

Rank the variants of a locus by predicted effect (largest absolute quantile across modalities), to prioritize candidates for follow-up. For single-nucleotide variants only, atlas_lookup_variants or atlas_scan_region is faster and adds the AVI score.

**Source behavior.** Live inference only. The result states `source: live`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `variants` | array of variant objects | yes | Variants to score (1-100) (at least 1, at most 100) Fields: `chromosome`, `position`, `ref`, `alt`, `variant_id` (optional). |
| `chromosome` | string | no | Optional: locus chromosome, for the label |
| `start` | number | no | Optional: locus start, for the label |
| `end` | number | no | Optional: locus end, for the label |

### compare_alleles

Rank the alternate alleles of one position by predicted effect.

**Source behavior.** Live inference only. The result states `source: live`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `chromosome` | string | yes | Chromosome (chr1-chr22, chrX, chrY) |
| `position` | number | yes | Genomic position (1-based, hg38) (min 1) |
| `ref` | string | yes | Reference allele (A, C, G, T; more than one base for an indel) |
| `alts` | array of string | yes | Alternate alleles (1-20) |

### batch_tissue_comparison

Rank several variants by predicted effect within each of several tissues: one ranking per tissue.

**Source behavior.** Live inference only. The result states `source: live`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `variants` | array of variant objects | yes | Variants to score (1-100) (at least 1, at most 100) Fields: `chromosome`, `position`, `ref`, `alt`, `variant_id` (optional). |
| `tissues` | array of string | yes | Tissue names or ontology CURIEs (1-10) |

### predict_tf_binding_impact

Predicted transcription factor binding effects of a variant (TF ChIP-seq), with the factor and cell type of each.

**Source behavior.** Live inference only. The result states `source: live`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `chromosome` | string | yes | Chromosome (chr1-chr22, chrX, chrY) |
| `position` | number | yes | Genomic position (1-based, hg38) (min 1) |
| `ref` | string | yes | Reference allele (A, C, G, T; more than one base for an indel) |
| `alt` | string | yes | Alternate allele (A, C, G, T; more than one base for an indel) |
| `tissue_type` | string | no | Optional: keep only the tracks of one tissue or cell type. A name (brain, neuron, blood, liver, heart, lung, kidney) or an ontology CURIE (e.g., UBERON:0000955, CL:0000540). Default: all tissues. |

### predict_chromatin_impact

Predicted chromatin accessibility effects of a variant (ATAC-seq and DNase-seq).

**Source behavior.** Live inference only. The result states `source: live`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `chromosome` | string | yes | Chromosome (chr1-chr22, chrX, chrY) |
| `position` | number | yes | Genomic position (1-based, hg38) (min 1) |
| `ref` | string | yes | Reference allele (A, C, G, T; more than one base for an indel) |
| `alt` | string | yes | Alternate allele (A, C, G, T; more than one base for an indel) |
| `tissue_type` | string | no | Optional: keep only the tracks of one tissue or cell type. A name (brain, neuron, blood, liver, heart, lung, kidney) or an ontology CURIE (e.g., UBERON:0000955, CL:0000540). Default: all tissues. |

### compare_protective_risk

Two variants side by side, labelled as the caller names them. The tool compares predicted effect sizes per modality; it does not judge which allele is protective or a risk.

**Source behavior.** Live inference only. The result states `source: live`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `protective_variant` | variant object | yes | Fields: `chromosome`, `position`, `ref`, `alt`, `variant_id` (optional). |
| `risk_variant` | variant object | yes | Fields: `chromosome`, `position`, `ref`, `alt`, `variant_id` (optional). |

### compare_variants_same_gene

Rank several variants by their predicted effect on one gene. With gene_name, the gene-level scorers (RNA_SEQ, SPLICE_SITES) are restricted to that gene.

**Source behavior.** Live inference only. The result states `source: live`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `variants` | array of variant objects | yes | Variants to score (1-100) (at least 1, at most 100) Fields: `chromosome`, `position`, `ref`, `alt`, `variant_id` (optional). |
| `gene_name` | string | no | Optional: gene symbol (e.g., APOE) |

### predict_allele_specific_effects

Predicted expression with the alternate allele against the reference allele: the RNA_SEQ scorer is that log fold change per gene and tissue, and RNA_SEQ_ACTIVE gives the expression level alongside it.

**Source behavior.** Live inference only. The result states `source: live`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `chromosome` | string | yes | Chromosome (chr1-chr22, chrX, chrY) |
| `position` | number | yes | Genomic position (1-based, hg38) (min 1) |
| `ref` | string | yes | Reference allele (A, C, G, T; more than one base for an indel) |
| `alt` | string | yes | Alternate allele (A, C, G, T; more than one base for an indel) |
| `tissue_type` | string | no | Optional: keep only the tracks of one tissue or cell type. A name (brain, neuron, blood, liver, heart, lung, kidney) or an ontology CURIE (e.g., UBERON:0000955, CL:0000540). Default: all tissues. |

### annotate_regulatory_context

The predicted effects of a variant across every regulatory modality at once: accessibility, histone marks, TF binding, CAGE, RNA-seq, splice sites, polyadenylation and contact maps. Shows where the predicted effect concentrates; it does not label the variant.

**Source behavior.** Live inference only. The result states `source: live`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `chromosome` | string | yes | Chromosome (chr1-chr22, chrX, chrY) |
| `position` | number | yes | Genomic position (1-based, hg38) (min 1) |
| `ref` | string | yes | Reference allele (A, C, G, T; more than one base for an indel) |
| `alt` | string | yes | Alternate allele (A, C, G, T; more than one base for an indel) |
| `tissue_type` | string | no | Optional: keep only the tracks of one tissue or cell type. A name (brain, neuron, blood, liver, heart, lung, kidney) or an ontology CURIE (e.g., UBERON:0000955, CL:0000540). Default: all tissues. |

### batch_modality_screen

Rank several variants by predicted effect within one modality: expression (RNA_SEQ, CAGE), splicing (SPLICE_SITES, SPLICE_SITE_USAGE), tf_binding (CHIP_TF) or chromatin (DNASE, ATAC).

**Source behavior.** Live inference only. The result states `source: live`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `variants` | array of variant objects | yes | Variants to score (1-100) (at least 1, at most 100) Fields: `chromosome`, `position`, `ref`, `alt`, `variant_id` (optional). |
| `modality` | `expression` \| `splicing` \| `tf_binding` \| `chromatin` | yes | - |

## AlphaGenome Atlas tools

Precomputed scores for single-nucleotide substitutions on hg38. No model call.

### atlas_list_scorers

List the variant scorers available in the AlphaGenome Atlas, including the AlphaGenome Variant Impact score (AVI_SCORE) and its feature attributions (AVI_SCORE_FEATURE_IMPORTANCE, AVI_SCORE_MODEL_FEATURES).

Returns each scorer's name, number of tracks and the assays behind it. Use these names in the `scorers` parameter of the other tools. Every scorer except the AVI ones is also available from live inference under the same name. Cached for the session after the first call.

**Source behavior.** Atlas only. The result states `source: atlas`.

**Parameters.** None.

### atlas_lookup_variant

Look up the precomputed AlphaGenome scores of one single-nucleotide variant. No model call, so it answers in seconds.

Returns, per scorer, the strongest tracks for the variant ranked by absolute score, each with its calibrated quantile, gene, tissue or cell type, and assay. Default scorers: AVI_SCORE plus one per modality (RNA_SEQ, CAGE, DNASE, CHIP_HISTONE, CHIP_TF, SPLICE_SITES).

If the reference base does not match hg38, the Atlas says which base it expected and that message is returned as a validation error.

**Source behavior.** Atlas only. The result states `source: atlas`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `chromosome` | string | yes | Chromosome (chr1-chr22, chrX, chrY) |
| `position` | number | yes | Genomic position (1-based, hg38) (min 1) |
| `ref` | string | yes | Reference base (one of A, C, G, T). Must match hg38 at this position. |
| `alt` | string | yes | Alternate base (one of A, C, G, T) |
| `scorers` | array of string | no | Optional: scorer names to use instead of the defaults. Names come from atlas_list_scorers and are the same for both sources, except the AVI scorers, which the Atlas alone serves. |
| `top_n` | number | no | Rows to return (default: 25, max: 100) (min 1, max 100) |

Example: "Look up chr19:44908684 T>C in the AlphaGenome Atlas"

### atlas_lookup_variants

Look up precomputed AlphaGenome scores for up to 500 single-nucleotide variants in one call and rank them.

Returns one row per variant (its strongest score and where it was seen), ranked. Default scorer: AVI_SCORE (AlphaGenome Variant Impact), one number per variant. With several scorers the ranking uses the largest absolute quantile. Variants the Atlas does not hold and variants it rejects (for example a reference base that does not match hg38) are listed separately with the reason; they do not fail the call.

**Source behavior.** Atlas only. The result states `source: atlas`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `variants` | array of variant objects | yes | Single-nucleotide variants to look up (1-500) (at least 1, at most 500) Fields: `chromosome`, `position`, `ref`, `alt`, `variant_id` (optional). |
| `scorers` | array of string | no | Optional: scorer names to use instead of the defaults. Names come from atlas_list_scorers and are the same for both sources, except the AVI scorers, which the Atlas alone serves. |
| `top_n` | number | no | Rows to return (default: 25, max: 100) (min 1, max 100) |

Example: "Rank these 200 GWAS SNPs by their Atlas scores"

### atlas_scan_region

Scan a genomic region in the AlphaGenome Atlas: every possible single-nucleotide substitution in the interval, ranked. Answers "which positions in this region matter most?" without running the model.

Region width: at most 10,000 bp. Up to 50,000 bp only with allow_large_region=true. A scan is one API request per 32 bp under a requests-per-minute quota, so a large scan can take minutes. If the quota or the time limit stops a scan early, the partial result is returned, marked "Incomplete", with the range that was really scanned; the ranking then covers that range only.

Default scorer: AVI_SCORE (about 7 seconds for 2,000 bp). Multi-track scorers are much slower (2,000 bp: DNASE 17 s, CHIP_TF 86 s). Scorers with one row per gene or junction (RNA_SEQ, SPLICE_JUNCTIONS, ...) cannot be used for a scan: scan with AVI_SCORE, then use atlas_lookup_variant on the top variants.

**Source behavior.** Atlas only. The result states `source: atlas`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `chromosome` | string | yes | Chromosome (chr1-chr22, chrX, chrY) |
| `start` | number | yes | Start position (1-based, hg38) (min 1) |
| `end` | number | yes | End position (greater than start; at most start + 10,000, or start + 50,000 with allow_large_region) (min 1) |
| `allow_large_region` | boolean | no | Set to true to scan more than 10,000 bp (up to 50,000 bp). Slower, and the result may be incomplete (default: false) |
| `scorers` | array of string | no | Optional: scorer names to use instead of the defaults. Names come from atlas_list_scorers and are the same for both sources, except the AVI scorers, which the Atlas alone serves. |
| `top_n` | number | no | Rows to return (default: 25, max: 100) (min 1, max 100) |

Example: "Scan chr17:49209289-49211289 and show the 10 substitutions with the largest predicted effect"
