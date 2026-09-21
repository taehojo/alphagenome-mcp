"""
AlphaGenome Atlas actions for the MCP bridge.

The Atlas holds precomputed AlphaGenome scores for every single-nucleotide
substitution on the human reference genome. Nothing here runs the model.

Every function returns a summary built by summaries.py: ranked rows and a few
statistics. A full score matrix is never returned, and the row count is capped
by `top_n`.

Logs go to stderr. stdout belongs to the JSON response written by the bridge.
"""

import concurrent.futures
import heapq
import sys
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from alphagenome.data import genome

import summaries

# One variant is cheap to look up, so it gets the overall AVI score plus one
# representative scorer per modality: expression, transcription start,
# chromatin accessibility, histone marks, transcription factor binding and
# splicing.
DEFAULT_VARIANT_SCORERS = [
    'AVI_SCORE',
    'RNA_SEQ',
    'CAGE',
    'DNASE',
    'CHIP_HISTONE',
    'CHIP_TF',
    'SPLICE_SITES',
]

# Many variants or a region: one number per variant, so the ranking is
# meaningful and the call stays within the request quota. Measured on a
# 2,000 bp scan: AVI_SCORE 2 s, DNASE 17 s, CHIP_TF 86 s.
DEFAULT_RANKING_SCORERS = ['AVI_SCORE']

MAX_VARIANTS = 500

# A scan is one request per 32 bp under a requests-per-minute quota, so the
# everyday limit is small. The larger limit has to be asked for.
MAX_REGION_BP = 10000
MAX_LARGE_REGION_BP = 50000

# A region is scanned in pieces so that only the running top rows are kept in
# memory and a quota pause never loses finished work.
SCAN_PIECE_BP = 1024
LOOKUP_WORKERS = 8
QUOTA_BACKOFF_SECONDS = (5, 10, 20, 30)


class AtlasNotAvailable(Exception):
    """The Atlas answered that it does not hold this variant."""


class AtlasInvalidRequest(summaries.InvalidRequest):
    """The Atlas rejected the request itself (wrong reference base, out of range, ...)."""


class AtlasQuotaExceeded(Exception):
    """The per-minute request quota stayed exhausted until the deadline."""


def log(message: str) -> None:
    print(f"atlas: {message}", file=sys.stderr)


def grpc_status_name(error: BaseException) -> Optional[str]:
    """Name of the gRPC status behind an exception, if there is one.

    The SDK re-raises NOT_FOUND and INVALID_ARGUMENT alike as ValueError and
    keeps the original call as __cause__, so both places are checked.
    """
    for candidate in (error, getattr(error, '__cause__', None)):
        code = getattr(candidate, 'code', None)
        if callable(code):
            try:
                return code().name
            except Exception:
                continue
    return None


def translate_error(error: BaseException, scorers: Sequence[str]) -> BaseException:
    """Turn an SDK/gRPC failure into the exception the bridge classifies."""
    status = grpc_status_name(error)
    if status == 'NOT_FOUND':
        return AtlasNotAvailable(str(error))
    if status in ('INVALID_ARGUMENT', 'OUT_OF_RANGE'):
        return AtlasInvalidRequest(str(error))
    if status == 'RESOURCE_EXHAUSTED' and 'larger than max' in str(error):
        return AtlasInvalidRequest(
            f"The scorers {list(scorers)} return more data per request than the API allows "
            "for a region scan. Scorers with one row per gene or junction (RNA_SEQ, "
            "SPLICE_JUNCTIONS, ...) are for single variants: use atlas_lookup_variant, or scan "
            "with AVI_SCORE first and look up the top variants."
        )
    if status == 'RESOURCE_EXHAUSTED':
        return AtlasQuotaExceeded(
            'AlphaGenome Atlas request quota (requests per minute) is exhausted. '
            'Wait a minute, or scan a smaller region.'
        )
    return error


def create_client(api_key: str):
    try:
        from alphagenome.atlas import atlas
    except ImportError as import_error:
        raise RuntimeError(
            'This alphagenome installation has no Atlas client. '
            'Upgrade with: pip install --upgrade alphagenome (0.9.0 or newer).'
        ) from import_error
    return atlas.create(api_key, timeout=60)


def call_with_quota_retry(fn, scorers: Sequence[str], deadline: Optional[float]):
    """Run fn(); on a quota error wait and retry until the deadline."""
    attempt = 0
    while True:
        try:
            return fn()
        except Exception as error:  # pylint: disable=broad-except
            translated = translate_error(error, scorers)
            if not isinstance(translated, AtlasQuotaExceeded):
                if translated is error:
                    raise
                raise translated from error
            wait = QUOTA_BACKOFF_SECONDS[min(attempt, len(QUOTA_BACKOFF_SECONDS) - 1)]
            if deadline is None or time.time() + wait >= deadline:
                raise translated from error
            log(f'quota exhausted, retrying in {wait}s')
            time.sleep(wait)
            attempt += 1


def to_variant(item: Dict[str, Any]) -> genome.Variant:
    chromosome, position, ref, alt = summaries.variant_fields(item)
    return genome.Variant(
        chromosome=chromosome, position=position, reference_bases=ref, alternate_bases=alt
    )


def resolve_scorers(requested, defaults: Sequence[str], metadata: Dict[str, Any]) -> List[str]:
    """Validate scorer names against the Atlas.

    An unknown name must be caught here: the Atlas answers it with NOT_FOUND
    ("variant not found"), which would otherwise look like a missing variant.
    """
    try:
        return summaries.resolve_names(requested, defaults, metadata.keys(), 'Atlas')
    except summaries.InvalidRequest as error:
        raise AtlasInvalidRequest(str(error)) from error


def per_variant_strongest(result: Dict[str, Any], scorers: Sequence[str]) -> Dict[str, Dict[str, Any]]:
    """{variant label: {scorer: strongest cell}} for an interval result.

    An interval result holds thousands of variants, so the strongest track of
    every row is found in one pass instead of one search per variant.
    """
    summary: Dict[str, Dict[str, Any]] = {}
    for scorer in scorers:
        adata = result.get(scorer)
        if adata is None or adata.obs is None or 'variant' not in adata.obs.columns:
            continue
        scores = np.asarray(adata.X, dtype=np.float64)
        if scores.size == 0:
            continue
        quantiles = summaries.quantiles_of(adata)
        magnitude = np.abs(np.nan_to_num(scores, nan=0.0))
        best_column = magnitude.argmax(axis=1)
        best_value = magnitude[np.arange(magnitude.shape[0]), best_column]

        best_row: Dict[str, int] = {}
        for row_index, variant in enumerate(adata.obs['variant']):
            label = str(variant)
            current = best_row.get(label)
            if current is None or best_value[row_index] > best_value[current]:
                best_row[label] = row_index
        for label, row_index in best_row.items():
            summary.setdefault(label, {})[scorer] = summaries.cell(
                adata, scores, quantiles, row_index, int(best_column[row_index])
            )
    return summary


# ----------------------------------------------------------------------------
# Actions
# ----------------------------------------------------------------------------


def list_scorers(client, params: Dict[str, Any]) -> Dict[str, Any]:
    metadata = call_with_quota_retry(client.scorer_metadata, [], None)
    scorers = []
    for name, entry in metadata.items():
        tracks = entry.track_metadata
        described = {
            'name': name,
            'is_signed': bool(entry.is_signed),
            'tracks': int(len(tracks)),
        }
        if 'Assay title' in tracks.columns:
            described['assays'] = sorted({str(a) for a in tracks['Assay title'] if str(a)})[:8]
        if 'biosample_name' in tracks.columns:
            described['biosamples'] = int(tracks['biosample_name'].nunique())
        elif 'name' in tracks.columns and len(tracks) <= 20:
            described['track_names'] = [str(n) for n in tracks['name']]
        scorers.append(described)
    return {
        'source': 'atlas',
        'organism': 'Homo sapiens (hg38)',
        'coverage': 'single-nucleotide substitutions on chr1-22, chrX, chrY',
        'scorer_count': len(scorers),
        'default_scorers': {
            'single_variant': DEFAULT_VARIANT_SCORERS,
            'many_variants_and_regions': DEFAULT_RANKING_SCORERS,
        },
        'scorers': scorers,
    }


def lookup_variant(client, params: Dict[str, Any]) -> Dict[str, Any]:
    variant = to_variant(params)
    top_n = summaries.clamp_top_n(params.get('top_n', summaries.DEFAULT_TOP_N))
    curies = summaries.resolve_tissues(params.get('tissues'))
    genes = params.get('genes') or None
    metadata = call_with_quota_retry(client.scorer_metadata, [], None)
    scorers = resolve_scorers(params.get('scorers'), DEFAULT_VARIANT_SCORERS, metadata)

    result = call_with_quota_retry(
        lambda: client.query_variant(variant, requested_scorers=scorers), scorers, None
    )
    signed = {name: bool(metadata[name].is_signed) for name in scorers}
    return summaries.summarise_variant(
        'atlas', str(variant), result, scorers, signed, top_n, curies, genes
    )


def lookup_variants(client, params: Dict[str, Any]) -> Dict[str, Any]:
    items = params.get('variants') or []
    if not items:
        raise AtlasInvalidRequest('At least one variant is required')
    if len(items) > MAX_VARIANTS:
        raise AtlasInvalidRequest(f'Maximum {MAX_VARIANTS} variants per call (got {len(items)})')
    top_n = summaries.clamp_top_n(params.get('top_n', summaries.DEFAULT_TOP_N))
    curies = summaries.resolve_tissues(params.get('tissues'))
    genes = params.get('genes') or None
    deadline = params.get('deadline_epoch')
    metadata = call_with_quota_retry(client.scorer_metadata, [], None)
    scorers = resolve_scorers(params.get('scorers'), DEFAULT_RANKING_SCORERS, metadata)

    def fetch(item: Dict[str, Any]) -> Tuple[str, Any]:
        try:
            variant = to_variant(item)
            result = call_with_quota_retry(
                lambda: client.query_variant(variant, requested_scorers=scorers), scorers, deadline
            )
        except AtlasNotAvailable as error:
            return 'not_in_atlas', str(error)
        except summaries.InvalidRequest as error:
            return 'invalid', str(error)
        return 'ok', summaries.strongest_by_scorer(result, scorers, curies, genes)

    # One request per variant, so a missing or mistyped variant is reported on
    # its own line instead of failing the whole batch (the SDK's batch call
    # raises on the first one).
    with concurrent.futures.ThreadPoolExecutor(max_workers=LOOKUP_WORKERS) as executor:
        outcomes = list(executor.map(fetch, items))

    entries: List[Dict[str, Any]] = []
    not_in_atlas: List[Dict[str, Any]] = []
    invalid: List[Dict[str, Any]] = []
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
            (not_in_atlas if state == 'not_in_atlas' else invalid).append(base)

    ranked = summaries.rank_entries(entries, scorers)
    response = {
        'source': 'atlas',
        'scorers': scorers,
        'ranked_by': summaries.ranking_rule(scorers),
        'requested': len(items),
        'found': len(ranked),
        'not_in_atlas': not_in_atlas,
        'invalid': invalid,
        'complete': True,
        'response_cap': f'top {top_n} of {len(ranked)} variants; one strongest cell per scorer per variant',
        'ranked': ranked[:top_n],
    }
    if curies:
        response['tissue_filter'] = curies
    if genes:
        response['gene_filter'] = list(genes)
    return response


def scan_region(client, params: Dict[str, Any]) -> Dict[str, Any]:
    chromosome = params['chromosome']
    start = int(params['start'])
    end = int(params['end'])
    allow_large = bool(params.get('allow_large_region', False))
    if end <= start:
        raise AtlasInvalidRequest('End position must be greater than start position')
    width = end - start
    if width > MAX_LARGE_REGION_BP:
        raise AtlasInvalidRequest(
            f'Region must be at most {MAX_LARGE_REGION_BP:,} bp (got {width:,}). Scan it in pieces.'
        )
    if width > MAX_REGION_BP and not allow_large:
        raise AtlasInvalidRequest(
            f'Region is {width:,} bp; the limit is {MAX_REGION_BP:,} bp. A scan is one API request '
            f'per 32 bp under a requests-per-minute quota, so a larger scan can take minutes and '
            f'may come back incomplete. Pass allow_large_region=true to scan up to '
            f'{MAX_LARGE_REGION_BP:,} bp, or scan the region in pieces.'
        )
    top_n = summaries.clamp_top_n(params.get('top_n', summaries.DEFAULT_TOP_N))
    deadline = params.get('deadline_epoch')
    metadata = call_with_quota_retry(client.scorer_metadata, [], None)
    scorers = resolve_scorers(params.get('scorers'), DEFAULT_RANKING_SCORERS, metadata)

    # Positions are 1-based and inclusive for the caller; the SDK interval is
    # 0-based and half-open.
    region_start, region_end = start - 1, end

    heap: List[Tuple[float, int, Dict[str, Any]]] = []
    counter = 0
    variant_count = 0
    rank_values: List[float] = []
    scanned_end = region_start
    stopped: Optional[str] = None

    for piece_start in range(region_start, region_end, SCAN_PIECE_BP):
        piece_end = min(piece_start + SCAN_PIECE_BP, region_end)
        if deadline is not None and time.time() >= deadline:
            stopped = 'time limit reached'
            break
        piece = genome.Interval(chromosome, piece_start, piece_end)
        try:
            result = call_with_quota_retry(
                lambda: client.query_interval(
                    piece, requested_scorers=scorers, progress_bar=False, max_workers=LOOKUP_WORKERS
                ),
                scorers,
                deadline,
            )
        except AtlasQuotaExceeded as error:
            stopped = str(error)
            break
        except AtlasNotAvailable:
            # Nothing stored for this piece (unresolved reference bases).
            scanned_end = piece_end
            continue

        strongest = per_variant_strongest(result, scorers)
        variant_count += len(strongest)
        for label, scores in strongest.items():
            entry = {'variant': label, 'scores': scores}
            key = summaries.rank_value(scores, scorers)
            rank_values.append(key)
            counter += 1
            if len(heap) < top_n:
                heapq.heappush(heap, (key, counter, entry))
            elif key > heap[0][0]:
                heapq.heapreplace(heap, (key, counter, entry))
        scanned_end = piece_end
        log(f'scanned {chromosome}:{region_start + 1}-{scanned_end} ({variant_count} variants)')

    ranked = [entry for _, _, entry in sorted(heap, key=lambda item: item[0], reverse=True)]
    for rank, entry in enumerate(ranked, start=1):
        entry['rank'] = rank
        position = entry['variant'].split(':')[1] if ':' in entry['variant'] else None
        if position and position.isdigit():
            entry['position'] = int(position)

    distribution = None
    if rank_values:
        merged = np.asarray(rank_values, dtype=np.float64)
        distribution = {
            'median': summaries.clean_number(np.nanmedian(merged)),
            'p90': summaries.clean_number(np.nanpercentile(merged, 90)),
            'p99': summaries.clean_number(np.nanpercentile(merged, 99)),
            'max': summaries.clean_number(np.nanmax(merged)),
        }

    complete = stopped is None and scanned_end >= region_end
    response = {
        'source': 'atlas',
        'region': f'{chromosome}:{start}-{end}',
        'width_bp': end - start + 1,
        'scorers': scorers,
        'ranked_by': summaries.ranking_rule(scorers),
        'variants_scanned': variant_count,
        'complete': complete,
        'scanned_region': f'{chromosome}:{start}-{scanned_end}' if scanned_end > region_start else 'none',
        'ranking_value_distribution': distribution,
        'response_cap': f'top {top_n} of {variant_count} substitutions; one strongest cell per scorer per variant',
        'ranked': ranked,
    }
    if not complete:
        response['stopped_because'] = stopped or 'unknown'
    return response


ACTIONS = {
    'atlas_list_scorers': list_scorers,
    'atlas_lookup_variant': lookup_variant,
    'atlas_lookup_variants': lookup_variants,
    'atlas_scan_region': scan_region,
}
