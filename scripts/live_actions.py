"""
Live inference actions for the MCP bridge.

A variant is scored with the SDK's score_variant and its recommended variant
scorers. Those scorers have the same names as the Atlas scorers and return the
same AnnData shape, so a live result goes through the same summarizer as an
Atlas result and the two can be read side by side.

This is what handles everything the Atlas does not hold: indels,
multi-nucleotide variants, and single-nucleotide variants when the caller asks
for a fresh model call.

Logs go to stderr. stdout belongs to the JSON response written by the bridge.
"""

import concurrent.futures
import sys
import time
from typing import Any, Dict, List, Optional, Sequence

from alphagenome.data import genome
from alphagenome.models import dna_client, variant_scorers

import summaries

# One representative scorer per modality. The model runs once per variant
# whatever the number of scorers, so the same set serves one variant and many.
# There is no live AVI score: AVI is served by the Atlas only.
DEFAULT_SCORERS = ['RNA_SEQ', 'CAGE', 'DNASE', 'CHIP_HISTONE', 'CHIP_TF', 'SPLICE_SITES']

MAX_VARIANTS = 100
WORKERS = 4

# Failures that are about the whole call, not about one variant.
FATAL_STATUSES = ('UNAUTHENTICATED', 'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED')


def log(message: str) -> None:
    print(f"live: {message}", file=sys.stderr)


def grpc_status_name(error: BaseException) -> Optional[str]:
    for candidate in (error, getattr(error, '__cause__', None)):
        code = getattr(candidate, 'code', None)
        if callable(code):
            try:
                return code().name
            except Exception:
                continue
    return None


def create_client(api_key: str):
    return dna_client.create(api_key)


def resolve_scorers(requested) -> List[str]:
    names = list(requested) if requested else []
    atlas_only = [name for name in names if str(name).upper().startswith('AVI_')]
    if atlas_only:
        raise summaries.InvalidRequest(
            f'{atlas_only} are served by the AlphaGenome Atlas only and cannot be computed by live '
            'inference. The Atlas holds single-nucleotide variants; for other variants use the live '
            f'scorers: {sorted(variant_scorers.RECOMMENDED_VARIANT_SCORERS)}'
        )
    return summaries.resolve_names(
        names, DEFAULT_SCORERS, variant_scorers.RECOMMENDED_VARIANT_SCORERS.keys(), 'live'
    )


def to_variant(item: Dict[str, Any]) -> genome.Variant:
    chromosome, position, ref, alt = summaries.variant_fields(item)
    return genome.Variant(
        chromosome=chromosome, position=position, reference_bases=ref, alternate_bases=alt
    )


def score(client, variant: genome.Variant, scorers: Sequence[str]) -> Dict[str, Any]:
    """{scorer name: AnnData} for one variant, from one model call."""
    interval = variant.reference_interval.resize(dna_client.SEQUENCE_LENGTH_1MB)
    chosen = [variant_scorers.RECOMMENDED_VARIANT_SCORERS[name] for name in scorers]
    results = client.score_variant(interval, variant, chosen)
    return dict(zip(scorers, results))


def signed_flags(scorers: Sequence[str]) -> Dict[str, bool]:
    return {
        name: bool(variant_scorers.RECOMMENDED_VARIANT_SCORERS[name].is_signed) for name in scorers
    }


# ----------------------------------------------------------------------------
# Actions
# ----------------------------------------------------------------------------


def score_variant(client, params: Dict[str, Any]) -> Dict[str, Any]:
    variant = to_variant(params)
    top_n = summaries.clamp_top_n(params.get('top_n', summaries.DEFAULT_TOP_N))
    scorers = resolve_scorers(params.get('scorers'))
    curies = summaries.resolve_tissues(params.get('tissues'))
    genes = params.get('genes') or None

    result = score(client, variant, scorers)
    return summaries.summarise_variant(
        'live', str(variant), result, scorers, signed_flags(scorers), top_n, curies, genes
    )


def score_variants(client, params: Dict[str, Any]) -> Dict[str, Any]:
    items = params.get('variants') or []
    if not items:
        raise summaries.InvalidRequest('At least one variant is required')
    if len(items) > MAX_VARIANTS:
        raise summaries.InvalidRequest(
            f'Maximum {MAX_VARIANTS} variants per live call (got {len(items)}); each one runs the model'
        )
    top_n = summaries.clamp_top_n(params.get('top_n', summaries.DEFAULT_TOP_N))
    scorers = resolve_scorers(params.get('scorers'))
    curies = summaries.resolve_tissues(params.get('tissues'))
    genes = params.get('genes') or None
    deadline = params.get('deadline_epoch')

    def fetch(item: Dict[str, Any]):
        if deadline is not None and time.time() >= deadline:
            return 'skipped', 'time limit reached before this variant was scored'
        try:
            variant = to_variant(item)
            result = score(client, variant, scorers)
        except summaries.InvalidRequest as error:
            return 'invalid', str(error)
        except Exception as error:  # pylint: disable=broad-except
            if grpc_status_name(error) in FATAL_STATUSES or isinstance(error, PermissionError):
                raise
            return 'invalid', str(error) or type(error).__name__
        return 'ok', summaries.strongest_by_scorer(result, scorers, curies, genes)

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as executor:
        outcomes = list(executor.map(fetch, items))

    entries: List[Dict[str, Any]] = []
    invalid: List[Dict[str, Any]] = []
    skipped = 0
    for index, (item, (state, payload)) in enumerate(zip(items, outcomes)):
        try:
            label = str(to_variant(item))
        except summaries.InvalidRequest:
            label = repr(item)
        base: Dict[str, Any] = {'index': index, 'variant': label}
        if item.get('variant_id'):
            base['variant_id'] = item['variant_id']
        if state == 'ok':
            base['scores'] = payload
            entries.append(base)
        else:
            base['reason'] = payload
            invalid.append(base)
            if state == 'skipped':
                skipped += 1

    ranked = summaries.rank_entries(entries, scorers)
    response = {
        'source': 'live',
        'scorers': scorers,
        'ranked_by': summaries.ranking_rule(scorers),
        'requested': len(items),
        'found': len(ranked),
        'not_in_atlas': [],
        'invalid': invalid,
        'complete': skipped == 0,
        'response_cap': f'top {top_n} of {len(ranked)} variants; one strongest cell per scorer per variant',
        'ranked': ranked[:top_n],
    }
    if curies:
        response['tissue_filter'] = curies
    if genes:
        response['gene_filter'] = list(genes)
    return response


ACTIONS = {
    'live_score_variant': score_variant,
    'live_score_variants': score_variants,
}
