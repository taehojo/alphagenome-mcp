"""
AlphaGenome Atlas actions for the MCP bridge.

The Atlas holds precomputed AlphaGenome scores for every single-nucleotide
substitution on the human reference genome. Nothing here runs the model.

Every function returns a summary: ranked rows and a few statistics. A full
score matrix is never returned (one variant alone is thousands of numbers
per scorer), and the row count is capped by `top_n`.

Logs go to stderr. stdout belongs to the JSON response written by the bridge.
"""

import concurrent.futures
import heapq
import math
import sys
import time
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

from alphagenome.data import genome

# Used when the caller does not name scorers.
#
# One variant is cheap to look up, so it gets one representative scorer per
# modality: the overall AVI score, expression, transcription start, chromatin
# accessibility, histone marks, transcription factor binding and splicing.
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
MAX_REGION_BP = 50000
MAX_TOP_N = 100
DEFAULT_TOP_N = 25

# A region is scanned in pieces so that only the running top rows are kept in
# memory and a quota pause never loses finished work.
SCAN_PIECE_BP = 1024
LOOKUP_WORKERS = 8
QUOTA_BACKOFF_SECONDS = (5, 10, 20, 30)

# Track metadata worth showing, in display order. Absent columns are skipped.
TRACK_COLUMNS = (
    'name',
    'Assay title',
    'biosample_name',
    'ontology_curie',
    'gtex_tissue',
    'transcription_factor',
    'histone_mark',
    'strand',
)
ROW_COLUMNS = ('gene_name', 'gene_id', 'junction_Start', 'junction_End')


class AtlasNotAvailable(Exception):
    """The Atlas answered that it does not hold this variant."""


class AtlasInvalidRequest(ValueError):
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


def is_message_too_large(error: BaseException) -> bool:
    return 'larger than max' in str(error)


def translate_error(error: BaseException, scorers: Sequence[str]) -> BaseException:
    """Turn an SDK/gRPC failure into the exception the bridge classifies."""
    status = grpc_status_name(error)
    if status == 'NOT_FOUND':
        return AtlasNotAvailable(str(error))
    if status in ('INVALID_ARGUMENT', 'OUT_OF_RANGE'):
        return AtlasInvalidRequest(str(error))
    if status == 'RESOURCE_EXHAUSTED' and is_message_too_large(error):
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
                raise translated from error
            wait = QUOTA_BACKOFF_SECONDS[min(attempt, len(QUOTA_BACKOFF_SECONDS) - 1)]
            if deadline is not None and time.time() + wait >= deadline:
                raise translated from error
            log(f'quota exhausted, retrying in {wait}s')
            time.sleep(wait)
            attempt += 1


# ----------------------------------------------------------------------------
# Small helpers
# ----------------------------------------------------------------------------


def clean_number(value: Any) -> Optional[float]:
    """A JSON-safe float with 5 significant digits; NaN and inf become None."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    if number == 0:
        return 0.0
    return float(f'{number:.5g}')


def clean_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return clean_number(value)
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    text = str(value)
    return text if text else None


def variant_label(variant: Any) -> str:
    """chr19:44908684:T>C, from a genome.Variant or its string form."""
    return str(variant)


def to_variant(item: Dict[str, Any]) -> genome.Variant:
    return genome.Variant(
        chromosome=item['chromosome'],
        position=int(item['position']),
        reference_bases=str(item['ref']).upper(),
        alternate_bases=str(item['alt']).upper(),
    )


def resolve_scorers(
    requested: Optional[Iterable[str]], defaults: Sequence[str], metadata: Dict[str, Any]
) -> List[str]:
    """Validate scorer names against the Atlas.

    An unknown name must be caught here: the Atlas answers it with NOT_FOUND
    ("variant not found"), which would otherwise look like a missing variant.
    """
    scorers = list(requested) if requested else list(defaults)
    lookup = {name.upper(): name for name in metadata}
    resolved = []
    unknown = []
    for name in scorers:
        match = lookup.get(str(name).upper())
        if match is None:
            unknown.append(name)
        elif match not in resolved:
            resolved.append(match)
    if unknown:
        raise AtlasInvalidRequest(
            f"Unknown Atlas scorer(s): {unknown}. Available: {sorted(metadata)}"
        )
    return resolved


def clamp_top_n(value: Any) -> int:
    try:
        top_n = int(value)
    except (TypeError, ValueError):
        top_n = DEFAULT_TOP_N
    return max(1, min(MAX_TOP_N, top_n))


def quantiles_of(adata) -> Optional[np.ndarray]:
    if adata.layers is not None and 'quantiles' in adata.layers:
        return np.asarray(adata.layers['quantiles'])
    return None


def describe_track(adata, column_index: int) -> Dict[str, Any]:
    row = adata.var.iloc[column_index]
    described = {}
    for column in TRACK_COLUMNS:
        if column in adata.var.columns:
            value = clean_value(row[column])
            if value is not None and value != '.':
                described[column] = value
    return described


def describe_row(adata, row_index: int) -> Dict[str, Any]:
    """Gene or junction the row belongs to, for scorers that have one row per gene."""
    described = {}
    if adata.obs is None:
        return described
    row = adata.obs.iloc[row_index]
    for column in ROW_COLUMNS:
        if column in adata.obs.columns:
            value = clean_value(row[column])
            if value is not None:
                described[column] = value
    return described


def top_cells(adata, limit: int) -> List[Dict[str, Any]]:
    """The `limit` cells of one scorer's matrix with the largest absolute score."""
    scores = np.asarray(adata.X, dtype=np.float64)
    if scores.size == 0:
        return []
    quantiles = quantiles_of(adata)
    flat = np.abs(np.nan_to_num(scores, nan=0.0)).ravel()
    limit = min(limit, flat.size)
    picked = np.argpartition(-flat, limit - 1)[:limit]
    picked = picked[np.argsort(-flat[picked])]
    rows = []
    for index in picked:
        row_index, column_index = np.unravel_index(index, scores.shape)
        entry = {'score': clean_number(scores[row_index, column_index])}
        if quantiles is not None:
            entry['quantile'] = clean_number(quantiles[row_index, column_index])
        entry.update(describe_row(adata, row_index))
        entry['track'] = describe_track(adata, column_index)
        rows.append(entry)
    return rows


def scorer_statistics(adata) -> Dict[str, Any]:
    scores = np.abs(np.asarray(adata.X, dtype=np.float64))
    return {
        'rows': int(scores.shape[0]),
        'tracks': int(scores.shape[1]),
        'max_abs_score': clean_number(np.nanmax(scores)) if scores.size else None,
        'median_abs_score': clean_number(np.nanmedian(scores)) if scores.size else None,
    }


def strongest_cell(adata, row_indices: np.ndarray) -> Dict[str, Any]:
    """The single strongest cell among the given rows of one scorer."""
    scores = np.asarray(adata.X, dtype=np.float64)[row_indices]
    flat = np.abs(np.nan_to_num(scores, nan=0.0))
    local_row, column_index = np.unravel_index(int(np.argmax(flat)), flat.shape)
    row_index = int(row_indices[local_row])
    entry = {'score': clean_number(scores[local_row, column_index])}
    quantiles = quantiles_of(adata)
    if quantiles is not None:
        entry['quantile'] = clean_number(quantiles[row_index, column_index])
    entry.update(describe_row(adata, row_index))
    if scores.shape[1] > 1:
        entry['track'] = describe_track(adata, column_index)
    return entry


def per_variant_strongest(result: Dict[str, Any], scorers: Sequence[str]) -> Dict[str, Dict[str, Any]]:
    """{variant label: {scorer: strongest cell}} for a multi-variant result."""
    summary: Dict[str, Dict[str, Any]] = {}
    for scorer in scorers:
        adata = result.get(scorer)
        if adata is None or adata.obs is None or 'variant' not in adata.obs.columns:
            continue
        labels = adata.obs['variant'].map(variant_label).to_numpy()
        order: Dict[str, List[int]] = {}
        for row_index, label in enumerate(labels):
            order.setdefault(label, []).append(row_index)
        for label, rows in order.items():
            summary.setdefault(label, {})[scorer] = strongest_cell(adata, np.asarray(rows))
    return summary


def rank_key(entry: Dict[str, Any], scorer: str) -> float:
    score = entry.get('scores', {}).get(scorer, {}).get('score')
    return abs(score) if score is not None else -1.0


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
    top_n = clamp_top_n(params.get('top_n', DEFAULT_TOP_N))
    metadata = call_with_quota_retry(client.scorer_metadata, [], None)
    scorers = resolve_scorers(params.get('scorers'), DEFAULT_VARIANT_SCORERS, metadata)

    result = call_with_quota_retry(
        lambda: client.query_variant(variant, requested_scorers=scorers), scorers, None
    )

    per_scorer = max(1, top_n // max(1, len(scorers)))
    summaries = []
    for scorer in scorers:
        adata = result.get(scorer)
        if adata is None:
            summaries.append({'scorer': scorer, 'available': False})
            continue
        summary = {
            'scorer': scorer,
            'available': True,
            'is_signed': bool(metadata[scorer].is_signed),
        }
        summary.update(scorer_statistics(adata))
        summary['top'] = top_cells(adata, per_scorer)
        summaries.append(summary)

    return {
        'source': 'atlas',
        'variant': variant_label(variant),
        'scorers': scorers,
        'rows_per_scorer': per_scorer,
        'response_cap': f'top {per_scorer} cells per scorer by absolute score (top_n={top_n}); the full matrix is not returned',
        'results': summaries,
    }


def lookup_variants(client, params: Dict[str, Any]) -> Dict[str, Any]:
    items = params.get('variants') or []
    if not items:
        raise AtlasInvalidRequest('At least one variant is required')
    if len(items) > MAX_VARIANTS:
        raise AtlasInvalidRequest(f'Maximum {MAX_VARIANTS} variants per call (got {len(items)})')
    top_n = clamp_top_n(params.get('top_n', DEFAULT_TOP_N))
    deadline = params.get('deadline_epoch')
    metadata = call_with_quota_retry(client.scorer_metadata, [], None)
    scorers = resolve_scorers(params.get('scorers'), DEFAULT_RANKING_SCORERS, metadata)
    rank_scorer = scorers[0]

    def fetch(item: Dict[str, Any]) -> Tuple[str, Any]:
        variant = to_variant(item)
        try:
            result = call_with_quota_retry(
                lambda: client.query_variant(variant, requested_scorers=scorers), scorers, deadline
            )
        except AtlasNotAvailable as error:
            return 'not_in_atlas', str(error)
        except AtlasInvalidRequest as error:
            return 'invalid', str(error)
        strongest = {}
        for scorer in scorers:
            adata = result.get(scorer)
            if adata is not None and adata.n_obs:
                strongest[scorer] = strongest_cell(adata, np.arange(adata.n_obs))
        return 'ok', strongest

    # One request per variant, so a missing or mistyped variant is reported on
    # its own line instead of failing the whole batch (the SDK's batch call
    # raises on the first one).
    entries: List[Dict[str, Any]] = []
    not_in_atlas: List[Dict[str, Any]] = []
    invalid: List[Dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=LOOKUP_WORKERS) as executor:
        outcomes = list(executor.map(fetch, items))

    for index, (item, (state, payload)) in enumerate(zip(items, outcomes)):
        base = {'index': index, 'variant': variant_label(to_variant(item))}
        if item.get('variant_id'):
            base['variant_id'] = item['variant_id']
        if state == 'ok':
            base['scores'] = payload
            entries.append(base)
        elif state == 'not_in_atlas':
            base['reason'] = payload
            not_in_atlas.append(base)
        else:
            base['reason'] = payload
            invalid.append(base)

    entries.sort(key=lambda entry: rank_key(entry, rank_scorer), reverse=True)
    for rank, entry in enumerate(entries, start=1):
        entry['rank'] = rank

    return {
        'source': 'atlas',
        'scorers': scorers,
        'ranked_by': f'absolute {rank_scorer} score',
        'requested': len(items),
        'found': len(entries),
        'not_in_atlas': not_in_atlas,
        'invalid': invalid,
        'response_cap': f'top {top_n} of {len(entries)} variants; one strongest cell per scorer per variant',
        'ranked': entries[:top_n],
    }


def scan_region(client, params: Dict[str, Any]) -> Dict[str, Any]:
    chromosome = params['chromosome']
    start = int(params['start'])
    end = int(params['end'])
    if end <= start:
        raise AtlasInvalidRequest('End position must be greater than start position')
    if end - start > MAX_REGION_BP:
        raise AtlasInvalidRequest(
            f'Region must be at most {MAX_REGION_BP:,} bp (got {end - start:,}). Scan it in pieces.'
        )
    top_n = clamp_top_n(params.get('top_n', DEFAULT_TOP_N))
    deadline = params.get('deadline_epoch')
    metadata = call_with_quota_retry(client.scorer_metadata, [], None)
    scorers = resolve_scorers(params.get('scorers'), DEFAULT_RANKING_SCORERS, metadata)
    rank_scorer = scorers[0]

    # Positions are 1-based and inclusive for the caller; the SDK interval is
    # 0-based and half-open.
    region_start, region_end = start - 1, end

    heap: List[Tuple[float, int, Dict[str, Any]]] = []
    counter = 0
    variant_count = 0
    abs_scores: List[np.ndarray] = []
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
        ranked_adata = result.get(rank_scorer)
        if ranked_adata is not None:
            abs_scores.append(np.abs(np.asarray(ranked_adata.X, dtype=np.float64)).max(axis=1))
        for label, scores in strongest.items():
            entry = {'variant': label, 'scores': scores}
            key = rank_key(entry, rank_scorer)
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
    if abs_scores:
        merged = np.concatenate(abs_scores)
        distribution = {
            'median': clean_number(np.nanmedian(merged)),
            'p90': clean_number(np.nanpercentile(merged, 90)),
            'p99': clean_number(np.nanpercentile(merged, 99)),
            'max': clean_number(np.nanmax(merged)),
        }

    complete = stopped is None and scanned_end >= region_end
    response = {
        'source': 'atlas',
        'region': f'{chromosome}:{start}-{end}',
        'width_bp': end - start + 1,
        'scorers': scorers,
        'ranked_by': f'absolute {rank_scorer} score',
        'variants_scanned': variant_count,
        'complete': complete,
        'abs_score_distribution': distribution,
        'response_cap': f'top {top_n} of {variant_count} substitutions; one strongest cell per scorer per variant',
        'ranked': ranked,
    }
    if not complete:
        response['scanned_region'] = f'{chromosome}:{start}-{scanned_end}'
        response['stopped_because'] = stopped or 'unknown'
    return response


ACTIONS = {
    'atlas_list_scorers': list_scorers,
    'atlas_lookup_variant': lookup_variant,
    'atlas_lookup_variants': lookup_variants,
    'atlas_scan_region': scan_region,
}
