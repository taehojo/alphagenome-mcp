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
except ImportError:
    print(json.dumps({
        "success": False,
        "error": "AlphaGenome package not installed. Run: pip install alphagenome"
    }), file=sys.stderr)
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
                'fold_change': rna_fc,
                'confidence': 0.85  # Placeholder - would need actual confidence from model
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

def analyze_region(client, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Analyze a genomic region for regulatory elements.

    Args:
        client: AlphaGenome client instance
        params: Dictionary with chromosome, start, end, analysis_type, resolution

    Returns:
        Dictionary with region analysis results matching TypeScript RegionResult type
    """
    chromosome = params.get('chromosome')
    start = params.get('start')
    end = params.get('end')

    # Create interval
    interval = genome.Interval(chromosome=chromosome, start=start, end=end)

    # Predict for interval
    outputs = client.predict_interval(
        interval=interval,
        requested_outputs=ALL_MODALITIES
    )

    # Extract regulatory elements (simplified - would need more sophisticated analysis)
    elements = {
        'promoters': [],
        'enhancers': [],
        'tf_binding_sites': [],
        'chromatin_states': []
    }

    # Identify high-activity regions as potential promoters
    if hasattr(outputs, 'cage') and outputs.cage:
        cage_values = outputs.cage.values
        high_activity = np.where(cage_values > np.percentile(cage_values, 90))[0]

        for idx in high_activity[:5]:  # Top 5
            elements['promoters'].append({
                'start': int(start + idx),
                'end': int(start + idx + 100),
                'score': float(cage_values[idx]),
                'type': 'predicted_promoter',
                'associated_gene': None
            })

    # Identify enhancers from histone marks
    if hasattr(outputs, 'chip_histone') and outputs.chip_histone:
        histone_values = outputs.chip_histone.values
        enhancer_regions = np.where(histone_values > np.percentile(histone_values, 85))[0]

        for idx in enhancer_regions[:5]:  # Top 5
            elements['enhancers'].append({
                'start': int(start + idx),
                'end': int(start + idx + 500),
                'score': float(histone_values[idx]),
                'type': 'active_enhancer'
            })

    return {
        'region': f"{chromosome}:{start}-{end}",
        'elements': elements
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
            raise ValueError("API key is required")

        # Create AlphaGenome client
        client = dna_client.create(api_key)

        # Route to appropriate handler
        if action == 'predict_variant':
            result = predict_variant_effect(client, params)
        elif action == 'analyze_region':
            result = analyze_region(client, params)
        elif action == 'batch_score':
            result = batch_score_variants(client, params)
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
        # Return error response
        response = {
            'success': False,
            'error': str(e),
            'error_type': type(e).__name__
        }
        print(json.dumps(response))
        sys.exit(1)

if __name__ == '__main__':
    main()
