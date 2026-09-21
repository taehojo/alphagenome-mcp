#!/usr/bin/env python3
"""
AlphaGenome API Bridge Script

This script acts as a bridge between the TypeScript MCP server and the Python-based
AlphaGenome API. It receives JSON requests via stdin, calls the AlphaGenome API,
and returns JSON responses via stdout.

Usage:
    echo '{"action": "predict_variant", "api_key": "...", "params": {...}}' | python alphagenome_bridge.py
"""

import sys
import json
import os
import numpy as np
from typing import Dict, Any, List, Optional

try:
    from alphagenome.data import genome
    from alphagenome.models import dna_client
except ImportError as import_error:
    # stdout carries the JSON response and nothing else, so the Node side can
    # always parse it. Human-readable detail goes to stderr.
    print(f"alphagenome import failed: {import_error}", file=sys.stderr)
    print(json.dumps({
        "success": False,
        "error": (
            "AlphaGenome package not installed for this interpreter "
            f"({sys.executable}). Requires Python 3.10 or newer: pip install alphagenome. "
            "Set ALPHAGENOME_PYTHON to choose a different interpreter."
        ),
        "error_type": "ApiError"
    }))
    sys.exit(1)

# All 11 AlphaGenome modalities (matching reference implementation)
ALL_MODALITIES = [
    dna_client.OutputType.RNA_SEQ,
    dna_client.OutputType.CAGE,
    dna_client.OutputType.PROCAP,
    dna_client.OutputType.SPLICE_SITES,
    dna_client.OutputType.SPLICE_SITE_USAGE,
    dna_client.OutputType.SPLICE_JUNCTIONS,
    dna_client.OutputType.ATAC,
    dna_client.OutputType.DNASE,
    dna_client.OutputType.CHIP_HISTONE,
    dna_client.OutputType.CHIP_TF,
    dna_client.OutputType.CONTACT_MAPS
]

# Tissue type to ontology term mapping
TISSUE_ONTOLOGY_MAP = {
    "brain": "UBERON:0000955",
    "neuron": "CL:0000540",
    "blood": "UBERON:0000178",
    "liver": "UBERON:0002107",
    "heart": "UBERON:0000948",
    "lung": "UBERON:0002048",
    "kidney": "UBERON:0002113"
}

def grpc_status_name(error: BaseException) -> Optional[str]:
    """Name of the gRPC status behind an exception, if there is one.

    The SDK re-raises some gRPC errors as built-in exceptions and keeps the
    original call as __cause__, so both places are checked.
    """
    for candidate in (error, getattr(error, '__cause__', None)):
        code = getattr(candidate, 'code', None)
        if callable(code):
            try:
                return code().name
            except Exception:
                continue
    return None


def classify_error(error: BaseException) -> str:
    """Map an exception to the error_type understood by the Node client."""
    status = grpc_status_name(error)
    if isinstance(error, PermissionError) or status in ('UNAUTHENTICATED', 'PERMISSION_DENIED'):
        return 'ApiKeyError'
    if status == 'RESOURCE_EXHAUSTED':
        return 'RateLimitError'
    if isinstance(error, TimeoutError) or status == 'DEADLINE_EXCEEDED':
        return 'TimeoutError'
    if status in ('UNAVAILABLE', 'CANCELLED', 'ABORTED'):
        return 'NetworkError'
    if isinstance(error, (ValueError, IndexError, KeyError, TypeError)):
        return 'ValidationError'
    return 'ApiError'


def safe_max_effect(values_alt, values_ref, modality_name: str) -> float:
    """
    Calculate maximum absolute difference between ALT and REF predictions.
    Matches the reference implementation's safe_max_effect function.
    """
    try:
        if values_alt is None or values_ref is None:
            return 0.0

        # Convert to numpy arrays
        alt_array = np.array(values_alt) if hasattr(values_alt, '__iter__') else np.array([values_alt])
        ref_array = np.array(values_ref) if hasattr(values_ref, '__iter__') else np.array([values_ref])

        # Check for empty arrays
        if alt_array.size == 0 or ref_array.size == 0:
            return 0.0

        # Calculate difference
        diff = np.abs(alt_array - ref_array)

        if diff.size == 0:
            return 0.0

        # Return maximum effect
        return float(np.max(diff))

    except Exception as e:
        print(f"Warning: Error calculating effect for {modality_name}: {e}", file=sys.stderr)
        return 0.0

def calculate_fold_change(values_alt, values_ref) -> float:
    """Calculate log2 fold change between ALT and REF."""
    try:
        if values_alt is None or values_ref is None:
            return 0.0

        alt_array = np.array(values_alt)
        ref_array = np.array(values_ref)

        if alt_array.size == 0 or ref_array.size == 0:
            return 0.0

        alt_mean = np.mean(alt_array)
        ref_mean = np.mean(ref_array)

        # Prevent division by zero
        if ref_mean == 0:
            return 0.0

        # Calculate log2 fold change
        fold_change = np.log2((alt_mean + 0.001) / (ref_mean + 0.001))
        return float(fold_change)

    except Exception:
        return 0.0

def predict_variant_effect(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Predict the regulatory impact of a genetic variant.

    Args:
        client: AlphaGenome client instance
        params: Dictionary with chromosome, position, reference_bases, alternate_bases, etc.

    Returns:
        Dictionary with variant predictions matching TypeScript VariantResult type
    """
    # Extract parameters
    chromosome = params.get('chromosome')
    position = params.get('position')
    ref_bases = params.get('reference_bases', params.get('ref'))
    alt_bases = params.get('alternate_bases', params.get('alt'))
    tissue_type = params.get('tissue_type', 'brain')
    output_types = params.get('output_types', ALL_MODALITIES)

    # Map tissue type to ontology term
    ontology_term = TISSUE_ONTOLOGY_MAP.get(tissue_type.lower(), "UBERON:0000955")

    # Create variant object
    variant = genome.Variant(
        chromosome=chromosome,
        position=position,
        reference_bases=ref_bases,
        alternate_bases=alt_bases
    )

    # Create interval (resize to standard 1MB size like reference implementation)
    interval = variant.reference_interval.resize(dna_client.SEQUENCE_LENGTH_1MB)

    # Call AlphaGenome API
    outputs = client.predict_variant(
        interval=interval,
        variant=variant,
        ontology_terms=[ontology_term],
        requested_outputs=output_types if isinstance(output_types, list) else ALL_MODALITIES
    )

    # Process predictions for each modality
    predictions = {}

    # RNA-seq effect
    if hasattr(outputs, 'alternate') and hasattr(outputs, 'reference'):
        if outputs.alternate.rna_seq and outputs.reference.rna_seq:
            rna_effect = safe_max_effect(
                outputs.alternate.rna_seq.values,
                outputs.reference.rna_seq.values,
                'RNA_SEQ'
            )
            rna_fc = calculate_fold_change(
                outputs.alternate.rna_seq.values,
                outputs.reference.rna_seq.values
            )

            ref_mean = float(np.mean(outputs.reference.rna_seq.values))
            alt_mean = float(np.mean(outputs.alternate.rna_seq.values))

            predictions['rna_seq'] = {
                'reference_score': ref_mean,
                'alternate_score': alt_mean,
                'fold_change': rna_fc
            }

        # Splice site analysis
        if outputs.alternate.splice_sites and outputs.reference.splice_sites:
            splice_effect = safe_max_effect(
                outputs.alternate.splice_sites.values,
                outputs.reference.splice_sites.values,
                'SPLICE_SITES'
            )

            ref_mean = float(np.mean(outputs.reference.splice_sites.values))
            alt_mean = float(np.mean(outputs.alternate.splice_sites.values))

            predictions['splice'] = {
                'reference_score': ref_mean,
                'alternate_score': alt_mean,
                'delta': splice_effect,
                'consequence': 'splice_site_disruption' if splice_effect > 0.2 else 'minimal_impact'
            }

        # Transcription factor binding
        tf_binding = []
        if outputs.alternate.chip_tf and outputs.reference.chip_tf:
            tf_effect = safe_max_effect(
                outputs.alternate.chip_tf.values,
                outputs.reference.chip_tf.values,
                'CHIP_TF'
            )

            if tf_effect > 0.1:  # Significant TF binding change
                ref_mean = float(np.mean(outputs.reference.chip_tf.values))
                alt_mean = float(np.mean(outputs.alternate.chip_tf.values))

                tf_binding.append({
                    'factor': 'TF_Binding',  # Would need metadata for specific TF names
                    'ref_score': ref_mean,
                    'alt_score': alt_mean,
                    'change': tf_effect
                })

        if tf_binding:
            predictions['tf_binding'] = tf_binding

    # Determine impact level
    max_effect = max([
        predictions.get('rna_seq', {}).get('fold_change', 0),
        predictions.get('splice', {}).get('delta', 0),
        max([tf.get('change', 0) for tf in predictions.get('tf_binding', [])], default=0)
    ], default=0)

    if abs(max_effect) > 0.5:
        impact_level = 'high'
        clinical_sig = 'likely_pathogenic'
    elif abs(max_effect) > 0.2:
        impact_level = 'moderate'
        clinical_sig = 'uncertain_significance'
    else:
        impact_level = 'low'
        clinical_sig = 'likely_benign'

    # Build interpretation
    interpretation = {
        'impact_level': impact_level,
        'clinical_significance': clinical_sig,
        'recommendations': [
            'Further functional validation recommended' if impact_level == 'high' else 'Standard clinical follow-up',
            f'Tissue type: {tissue_type}',
            f'Ontology term: {ontology_term}'
        ]
    }

    # Return structured result matching TypeScript VariantResult interface
    return {
        'variant': f"{chromosome}:{position}{ref_bases}>{alt_bases}",
        'gene_context': None,  # Would need gene annotation data
        'predictions': predictions,
        'interpretation': interpretation
    }

def assess_pathogenicity(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Comprehensive pathogenicity assessment of a variant.
    Uses all modalities to provide clinical interpretation.
    """
    result = predict_variant_effect(client, params)

    # Calculate pathogenicity score based on multiple factors
    predictions = result['predictions']

    # Score components
    expression_impact = abs(predictions.get('rna_seq', {}).get('fold_change', 0))
    splice_impact = abs(predictions.get('splice', {}).get('delta', 0))
    tf_impact = max([tf.get('change', 0) for tf in predictions.get('tf_binding', [])], default=0)

    # Combined pathogenicity score (0-1 scale)
    pathogenicity_score = min(1.0, (expression_impact * 0.4 + splice_impact * 0.4 + tf_impact * 0.2))

    # Clinical classification
    if pathogenicity_score > 0.7:
        classification = 'pathogenic'
    elif pathogenicity_score > 0.4:
        classification = 'likely_pathogenic'
    elif pathogenicity_score > 0.2:
        classification = 'uncertain_significance'
    elif pathogenicity_score > 0.1:
        classification = 'likely_benign'
    else:
        classification = 'benign'

    return {
        'variant': result['variant'],
        'pathogenicity_score': float(pathogenicity_score),
        'classification': classification,
        'evidence': {
            'expression_impact': float(expression_impact),
            'splice_impact': float(splice_impact),
            'tf_binding_impact': float(tf_impact)
        },
        'predictions': predictions
    }

def predict_tissue_specific(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Predict variant effects across multiple tissues.
    """
    tissues = params.get('tissues', ['brain', 'liver', 'heart'])

    results = {}
    for tissue in tissues:
        tissue_params = params.copy()
        tissue_params['tissue_type'] = tissue
        try:
            result = predict_variant_effect(client, tissue_params)
            results[tissue] = {
                'expression_impact': result['predictions'].get('rna_seq', {}).get('fold_change', 0),
                'splice_impact': result['predictions'].get('splice', {}).get('delta', 0),
                'impact_level': result['interpretation']['impact_level']
            }
        except Exception as e:
            print(f"Warning: Failed to predict for tissue {tissue}: {e}", file=sys.stderr)
            results[tissue] = {'error': str(e)}

    return {
        'variant': f"{params.get('chromosome')}:{params.get('position')}{params.get('ref')}>{params.get('alt')}",
        'tissue_results': results
    }

def compare_variants(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compare two variants side-by-side.
    """
    variant1 = params.get('variant1')
    variant2 = params.get('variant2')

    result1 = predict_variant_effect(client, variant1)
    result2 = predict_variant_effect(client, variant2)

    return {
        'variant1': {
            'id': result1['variant'],
            'impact': result1['interpretation']['impact_level'],
            'expression_fc': result1['predictions'].get('rna_seq', {}).get('fold_change', 0),
            'splice_delta': result1['predictions'].get('splice', {}).get('delta', 0)
        },
        'variant2': {
            'id': result2['variant'],
            'impact': result2['interpretation']['impact_level'],
            'expression_fc': result2['predictions'].get('rna_seq', {}).get('fold_change', 0),
            'splice_delta': result2['predictions'].get('splice', {}).get('delta', 0)
        },
        'comparison': {
            'more_severe': result1['variant'] if abs(result1['predictions'].get('rna_seq', {}).get('fold_change', 0)) > abs(result2['predictions'].get('rna_seq', {}).get('fold_change', 0)) else result2['variant']
        }
    }

def predict_splice_impact(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Focus on splicing-specific effects only.
    """
    # Override output_types to splice-specific modalities
    params['output_types'] = [
        dna_client.OutputType.SPLICE_SITES,
        dna_client.OutputType.SPLICE_SITE_USAGE,
        dna_client.OutputType.SPLICE_JUNCTIONS
    ]

    result = predict_variant_effect(client, params)

    return {
        'variant': result['variant'],
        'splice_predictions': result['predictions'].get('splice', {}),
        'impact_level': result['interpretation']['impact_level'],
        'clinical_significance': result['interpretation']['clinical_significance']
    }

def predict_expression_impact(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Focus on gene expression effects only.
    """
    params['output_types'] = [
        dna_client.OutputType.RNA_SEQ,
        dna_client.OutputType.CAGE
    ]

    result = predict_variant_effect(client, params)

    return {
        'variant': result['variant'],
        'expression_predictions': result['predictions'].get('rna_seq', {}),
        'fold_change': result['predictions'].get('rna_seq', {}).get('fold_change', 0),
        'impact_level': result['interpretation']['impact_level']
    }

def analyze_gwas_locus(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Analyze all variants in a GWAS locus.
    """
    variants_data = params.get('variants', [])

    results = []
    for v in variants_data:
        try:
            result = predict_variant_effect(client, v)
            results.append({
                'variant': result['variant'],
                'impact_score': abs(result['predictions'].get('rna_seq', {}).get('fold_change', 0)),
                'impact_level': result['interpretation']['impact_level']
            })
        except Exception as e:
            print(f"Warning: Failed to analyze variant: {e}", file=sys.stderr)
            continue

    # Sort by impact score
    results.sort(key=lambda x: x['impact_score'], reverse=True)

    return {
        'locus': f"{params.get('chromosome', 'unknown')}:{params.get('start', 0)}-{params.get('end', 0)}",
        'total_variants': len(results),
        'ranked_variants': results
    }

def compare_alleles(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compare different alleles at the same position.
    """
    chromosome = params.get('chromosome')
    position = params.get('position')
    ref = params.get('ref')
    alts = params.get('alts', [])

    results = {}
    for alt in alts:
        try:
            var_params = {
                'chromosome': chromosome,
                'position': position,
                'ref': ref,
                'alt': alt
            }
            result = predict_variant_effect(client, var_params)
            results[f"{ref}>{alt}"] = {
                'impact_level': result['interpretation']['impact_level'],
                'expression_fc': result['predictions'].get('rna_seq', {}).get('fold_change', 0),
                'clinical_sig': result['interpretation']['clinical_significance']
            }
        except Exception as e:
            print(f"Warning: Failed for allele {alt}: {e}", file=sys.stderr)
            results[f"{ref}>{alt}"] = {'error': str(e)}

    return {
        'position': f"{chromosome}:{position}",
        'reference': ref,
        'allele_comparisons': results
    }

def batch_tissue_comparison(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Analyze multiple variants across multiple tissues.
    """
    variants_data = params.get('variants', [])
    tissues = params.get('tissues', ['brain', 'liver', 'heart'])

    results = []
    for v in variants_data:
        var_id = f"{v.get('chromosome')}:{v.get('position')}{v.get('ref')}>{v.get('alt')}"
        tissue_results = {}

        for tissue in tissues:
            v['tissue_type'] = tissue
            try:
                result = predict_variant_effect(client, v)
                tissue_results[tissue] = {
                    'impact': result['interpretation']['impact_level'],
                    'expression_fc': result['predictions'].get('rna_seq', {}).get('fold_change', 0)
                }
            except Exception as e:
                tissue_results[tissue] = {'error': str(e)}

        results.append({
            'variant': var_id,
            'tissues': tissue_results
        })

    return {
        'total_variants': len(results),
        'tissues_tested': tissues,
        'results': results
    }

def predict_tf_binding_impact(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """Focus on TF binding effects only."""
    params['output_types'] = [dna_client.OutputType.CHIP_TF]
    result = predict_variant_effect(client, params)
    return {
        'variant': result['variant'],
        'tf_binding': result['predictions'].get('tf_binding', []),
        'impact_level': result['interpretation']['impact_level']
    }

def predict_chromatin_impact(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """Focus on chromatin accessibility changes."""
    params['output_types'] = [dna_client.OutputType.ATAC, dna_client.OutputType.DNASE]
    result = predict_variant_effect(client, params)
    return {
        'variant': result['variant'],
        'predictions': result['predictions'],
        'impact_level': result['interpretation']['impact_level']
    }

def compare_protective_risk(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """Compare protective vs risk alleles."""
    protective = params.get('protective_variant')
    risk = params.get('risk_variant')

    result_protective = predict_variant_effect(client, protective)
    result_risk = predict_variant_effect(client, risk)

    return {
        'protective': {
            'variant': result_protective['variant'],
            'impact': result_protective['interpretation']['impact_level'],
            'expression_fc': result_protective['predictions'].get('rna_seq', {}).get('fold_change', 0)
        },
        'risk': {
            'variant': result_risk['variant'],
            'impact': result_risk['interpretation']['impact_level'],
            'expression_fc': result_risk['predictions'].get('rna_seq', {}).get('fold_change', 0)
        }
    }

def batch_pathogenicity_filter(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """Filter variants by pathogenicity threshold."""
    variants_data = params.get('variants', [])
    threshold = params.get('threshold', 0.5)

    pathogenic_variants = []
    for v in variants_data:
        try:
            result = assess_pathogenicity(client, v)
            if result['pathogenicity_score'] >= threshold:
                pathogenic_variants.append({
                    'variant': result['variant'],
                    'score': result['pathogenicity_score'],
                    'classification': result['classification']
                })
        except Exception as e:
            print(f"Warning: Failed for variant: {e}", file=sys.stderr)
            continue

    pathogenic_variants.sort(key=lambda x: x['score'], reverse=True)
    return {
        'total_analyzed': len(variants_data),
        'pathogenic_count': len(pathogenic_variants),
        'pathogenic_variants': pathogenic_variants
    }

def compare_variants_same_gene(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """Compare multiple variants in the same gene."""
    variants_data = params.get('variants', [])
    gene = params.get('gene', 'unknown')

    results = []
    for v in variants_data:
        try:
            result = predict_variant_effect(client, v)
            results.append({
                'variant': result['variant'],
                'impact': result['interpretation']['impact_level'],
                'expression_fc': result['predictions'].get('rna_seq', {}).get('fold_change', 0),
                'clinical_sig': result['interpretation']['clinical_significance']
            })
        except Exception as e:
            print(f"Warning: Failed: {e}", file=sys.stderr)
            continue

    results.sort(key=lambda x: abs(x['expression_fc']), reverse=True)
    return {
        'gene': gene,
        'total_variants': len(results),
        'ranked_variants': results
    }

def predict_allele_specific_effects(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """Analyze allele-specific expression effects."""
    result = predict_variant_effect(client, params)

    rna_data = result['predictions'].get('rna_seq', {})
    ref_score = rna_data.get('reference_score', 0)
    alt_score = rna_data.get('alternate_score', 0)

    # Calculate allele-specific ratio
    if ref_score + alt_score > 0:
        ase_ratio = alt_score / (ref_score + alt_score)
    else:
        ase_ratio = 0.5

    return {
        'variant': result['variant'],
        'ref_expression': ref_score,
        'alt_expression': alt_score,
        'ase_ratio': float(ase_ratio),
        'interpretation': 'alt_biased' if ase_ratio > 0.6 else ('ref_biased' if ase_ratio < 0.4 else 'balanced')
    }

def annotate_regulatory_context(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """Add regulatory annotations to variant."""
    result = predict_variant_effect(client, params)

    # Determine regulatory context from predictions
    predictions = result['predictions']
    context = []

    if predictions.get('rna_seq', {}).get('fold_change', 0) != 0:
        context.append('expression_QTL')
    if predictions.get('splice', {}).get('delta', 0) > 0.1:
        context.append('splice_site')
    if predictions.get('tf_binding'):
        context.append('TF_binding_site')

    return {
        'variant': result['variant'],
        'regulatory_context': context,
        'predictions': predictions,
        'impact_level': result['interpretation']['impact_level']
    }

def batch_modality_screen(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """Screen variants across specific modalities."""
    variants_data = params.get('variants', [])
    modality = params.get('modality', 'expression')

    # Map modality names to OutputType enums
    modality_map = {
        'expression': [dna_client.OutputType.RNA_SEQ, dna_client.OutputType.CAGE],
        'splicing': [dna_client.OutputType.SPLICE_SITES],
        'tf_binding': [dna_client.OutputType.CHIP_TF],
        'chromatin': [dna_client.OutputType.DNASE, dna_client.OutputType.ATAC]
    }
    modalities = modality_map.get(modality, [dna_client.OutputType.RNA_SEQ, dna_client.OutputType.SPLICE_SITES])

    results = []
    for v in variants_data:
        # Create a copy with output_types
        variant_params = v.copy()
        variant_params['output_types'] = modalities
        try:
            result = predict_variant_effect(client, variant_params)
            results.append({
                'variant': result['variant'],
                'predictions': result['predictions'],
                'impact': result['interpretation']['impact_level']
            })
        except Exception as e:
            print(f"Warning: Failed: {e}", file=sys.stderr)
            continue

    return {
        'modalities_tested': [modality],  # Return string representation
        'total_variants': len(results),
        'results': results
    }

def generate_variant_report(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """Generate clinical report for variant."""
    result = assess_pathogenicity(client, params)

    # Build clinical report
    report = {
        'variant': result['variant'],
        'classification': result['classification'].upper(),
        'pathogenicity_score': result['pathogenicity_score'],
        'evidence_summary': {
            'expression_impact': f"{result['evidence']['expression_impact']:.4f}",
            'splicing_impact': f"{result['evidence']['splice_impact']:.4f}",
            'tf_binding_impact': f"{result['evidence']['tf_binding_impact']:.2f}"
        },
        'recommendation': 'Further clinical evaluation recommended' if result['pathogenicity_score'] > 0.5 else 'Routine monitoring',
        'generated_date': 'API call timestamp'
    }

    return report

def explain_variant_impact(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """Provide human-readable explanation of variant impact."""
    result = predict_variant_effect(client, params)

    # Generate explanation
    predictions = result['predictions']
    impact = result['interpretation']['impact_level']

    explanation = []

    if impact == 'high':
        explanation.append("This variant has HIGH regulatory impact.")
    elif impact == 'moderate':
        explanation.append("This variant has MODERATE regulatory impact.")
    else:
        explanation.append("This variant has LOW regulatory impact.")

    rna_fc = predictions.get('rna_seq', {}).get('fold_change', 0)
    if abs(rna_fc) > 0.01:
        direction = "increases" if rna_fc > 0 else "decreases"
        explanation.append(f"It {direction} gene expression by {abs(rna_fc):.3f} fold.")

    splice_delta = predictions.get('splice', {}).get('delta', 0)
    if splice_delta > 0.1:
        explanation.append(f"It significantly affects splicing (delta: {splice_delta:.3f}).")

    return {
        'variant': result['variant'],
        'summary': ' '.join(explanation),
        'impact_level': impact,
        'clinical_significance': result['interpretation']['clinical_significance']
    }

def batch_score_variants(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Score multiple variants and rank by impact.

    Args:
        client: AlphaGenome client instance
        params: Dictionary with variants list, metric, top_n

    Returns:
        Dictionary with batch scoring results matching TypeScript BatchResult type
    """
    variants_data = params.get('variants', [])
    metric = params.get('metric', 'regulatory_impact')
    top_n = params.get('top_n', 10)

    # Create variant objects
    variant_objects = []
    for v in variants_data:
        variant_objects.append(genome.Variant(
            chromosome=v.get('chromosome'),
            position=v.get('position'),
            reference_bases=v.get('ref'),
            alternate_bases=v.get('alt')
        ))

    # Score each variant
    scored_variants = []
    for i, variant in enumerate(variant_objects):
        try:
            # Use predict_variant_effect logic
            result = predict_variant_effect(client, {
                'chromosome': variant.chromosome,
                'position': variant.position,
                'reference_bases': variant.reference_bases,
                'alternate_bases': variant.alternate_bases
            })

            # Extract impact score
            rna_fc = abs(result['predictions'].get('rna_seq', {}).get('fold_change', 0))
            splice_delta = abs(result['predictions'].get('splice', {}).get('delta', 0))
            impact_score = max(rna_fc, splice_delta)

            scored_variants.append({
                'rank': 0,  # Will be assigned after sorting
                'variant': result['variant'],
                'variant_id': variants_data[i].get('id', f"var_{i}"),
                'score': impact_score,
                'impact_level': result['interpretation']['impact_level'],
                'key_effect': 'RNA expression change' if rna_fc > splice_delta else 'Splicing disruption'
            })
        except Exception as e:
            print(f"Warning: Failed to score variant {i}: {e}", file=sys.stderr)
            continue

    # Sort by score and assign ranks
    scored_variants.sort(key=lambda x: x['score'], reverse=True)
    for rank, variant in enumerate(scored_variants[:top_n], 1):
        variant['rank'] = rank

    # Calculate distribution
    distribution = {'high': 0, 'moderate': 0, 'low': 0}
    for v in scored_variants:
        distribution[v['impact_level']] = distribution.get(v['impact_level'], 0) + 1

    return {
        'total_analyzed': len(scored_variants),
        'variants': scored_variants[:top_n],
        'distribution': distribution
    }

def main():
    """Main entry point for the bridge script."""
    try:
        # Read input from stdin
        input_data = sys.stdin.read()
        request = json.loads(input_data)

        # Extract action, API key, and parameters
        action = request.get('action')
        api_key = request.get('api_key')
        params = request.get('params', {})

        if not api_key:
            raise PermissionError("API key is required")

        # Create AlphaGenome client
        client = dna_client.create(api_key)

        # Route to appropriate handler
        if action == 'predict_variant':
            result = predict_variant_effect(client, params)
        elif action == 'batch_score':
            result = batch_score_variants(client, params)
        elif action == 'assess_pathogenicity':
            result = assess_pathogenicity(client, params)
        elif action == 'predict_tissue_specific':
            result = predict_tissue_specific(client, params)
        elif action == 'compare_variants':
            result = compare_variants(client, params)
        elif action == 'predict_splice_impact':
            result = predict_splice_impact(client, params)
        elif action == 'predict_expression_impact':
            result = predict_expression_impact(client, params)
        elif action == 'analyze_gwas_locus':
            result = analyze_gwas_locus(client, params)
        elif action == 'compare_alleles':
            result = compare_alleles(client, params)
        elif action == 'batch_tissue_comparison':
            result = batch_tissue_comparison(client, params)
        elif action == 'predict_tf_binding_impact':
            result = predict_tf_binding_impact(client, params)
        elif action == 'predict_chromatin_impact':
            result = predict_chromatin_impact(client, params)
        elif action == 'compare_protective_risk':
            result = compare_protective_risk(client, params)
        elif action == 'batch_pathogenicity_filter':
            result = batch_pathogenicity_filter(client, params)
        elif action == 'compare_variants_same_gene':
            result = compare_variants_same_gene(client, params)
        elif action == 'predict_allele_specific_effects':
            result = predict_allele_specific_effects(client, params)
        elif action == 'annotate_regulatory_context':
            result = annotate_regulatory_context(client, params)
        elif action == 'batch_modality_screen':
            result = batch_modality_screen(client, params)
        elif action == 'generate_variant_report':
            result = generate_variant_report(client, params)
        elif action == 'explain_variant_impact':
            result = explain_variant_impact(client, params)
        else:
            raise ValueError(f"Unknown action: {action}")

        # Return success response
        response = {
            'success': True,
            'data': result
        }
        print(json.dumps(response))
        sys.exit(0)

    except Exception as e:
        print(f"bridge error: {type(e).__name__}: {e}", file=sys.stderr)
        response = {
            'success': False,
            'error': str(e) or type(e).__name__,
            'error_type': classify_error(e)
        }
        print(json.dumps(response))
        sys.exit(1)

if __name__ == '__main__':
    main()
