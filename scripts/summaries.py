"""
Shared summarizer for AlphaGenome variant scores.

The Atlas (precomputed) and live inference (score_variant) both return one
AnnData per scorer: X is rows x tracks, obs describes the rows (a gene or a
junction, for scorers that have them), var describes the tracks, and
layers['quantiles'] holds the calibrated scores. Everything here works on that
shape, so both sources are summarised by the same code.

Scores and quantiles are reported as returned. Nothing in this module derives
a pathogenicity class, a risk label or a percent change from them.

Depends on numpy only, so it can be unit-tested without the AlphaGenome SDK.
"""

import math
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

MAX_TOP_N = 100
DEFAULT_TOP_N = 25

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

# Tissue names accepted in place of an ontology CURIE.
TISSUE_ONTOLOGY_MAP = {
    'brain': 'UBERON:0000955',
    'neuron': 'CL:0000540',
    'blood': 'UBERON:0000178',
    'liver': 'UBERON:0002107',
    'heart': 'UBERON:0000948',
    'lung': 'UBERON:0002048',
    'kidney': 'UBERON:0002113',
}


class InvalidRequest(ValueError):
    """The request itself is wrong; retrying or another source will not help."""


# ----------------------------------------------------------------------------
# JSON-safe values
# ----------------------------------------------------------------------------


def clean_number(value: Any, digits: int = 5) -> Optional[float]:
    """A JSON-safe float with `digits` significant digits; NaN and inf become None."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    if number == 0:
        return 0.0
    return float(f'{number:.{digits}g}')


def clean_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return clean_number(value)
    text = str(value)
    return text if text else None


def clamp_top_n(value: Any) -> int:
    try:
        top_n = int(value)
    except (TypeError, ValueError):
        top_n = DEFAULT_TOP_N
    return max(1, min(MAX_TOP_N, top_n))


# ----------------------------------------------------------------------------
# Filters
# ----------------------------------------------------------------------------


def resolve_tissues(tissues: Optional[Iterable[str]]) -> Optional[List[str]]:
    """Ontology CURIEs for tissue names ("brain") or CURIEs ("UBERON:0000955")."""
    if not tissues:
        return None
    curies = []
    for tissue in tissues:
        text = str(tissue).strip()
        if not text:
            continue
        mapped = TISSUE_ONTOLOGY_MAP.get(text.lower())
        if mapped:
            curies.append(mapped)
        elif ':' in text:
            curies.append(text)
        else:
            raise InvalidRequest(
                f"Unknown tissue {text!r}. Use one of {sorted(TISSUE_ONTOLOGY_MAP)} "
                "or an ontology CURIE such as UBERON:0000955 or CL:0000540."
            )
    return curies or None


def quantiles_of(adata) -> Optional[np.ndarray]:
    layers = getattr(adata, 'layers', None)
    if layers is not None and 'quantiles' in layers:
        return np.asarray(layers['quantiles'], dtype=np.float64)
    return None


def select(adata, curies: Optional[Sequence[str]] = None, genes: Optional[Sequence[str]] = None):
    """Row and column indices that survive the tissue and gene filters.

    A scorer without ontology metadata (SPLICE_SITES, AVI_SCORE) is not
    filtered by tissue, and a scorer without gene rows is not filtered by
    gene: a filter narrows what it can describe and leaves the rest alone.
    """
    scores = np.asarray(adata.X, dtype=np.float64)
    if scores.ndim == 1:
        scores = scores.reshape(1, -1)
    rows = np.arange(scores.shape[0])
    columns = np.arange(scores.shape[1])

    var = getattr(adata, 'var', None)
    if curies and var is not None and 'ontology_curie' in var.columns:
        wanted = set(curies)
        columns = np.asarray(
            [i for i, curie in enumerate(var['ontology_curie']) if str(curie) in wanted], dtype=int
        )

    obs = getattr(adata, 'obs', None)
    if genes and obs is not None and 'gene_name' in obs.columns:
        wanted = {str(gene).upper() for gene in genes}
        rows = np.asarray(
            [i for i, gene in enumerate(obs['gene_name']) if str(gene).upper() in wanted], dtype=int
        )
    return scores, rows, columns


# ----------------------------------------------------------------------------
# Describing a cell
# ----------------------------------------------------------------------------


def describe_track(adata, column_index: int) -> Dict[str, Any]:
    var = getattr(adata, 'var', None)
    if var is None or len(var.columns) == 0:
        return {}
    row = var.iloc[column_index]
    described = {}
    for column in TRACK_COLUMNS:
        if column in var.columns:
            value = clean_value(row[column])
            if value is not None and value != '.':
                described[column] = value
    return described


def describe_row(adata, row_index: int) -> Dict[str, Any]:
    """The gene or junction a row belongs to, for scorers that have them."""
    obs = getattr(adata, 'obs', None)
    if obs is None or len(obs.columns) == 0:
        return {}
    row = obs.iloc[row_index]
    described = {}
    for column in ROW_COLUMNS:
        if column in obs.columns:
            value = clean_value(row[column])
            if value is not None:
                described[column] = value
    return described


def cell(adata, scores: np.ndarray, quantiles: Optional[np.ndarray], row: int, column: int) -> Dict[str, Any]:
    entry: Dict[str, Any] = {'score': clean_number(scores[row, column])}
    if quantiles is not None:
        # float32 precision: the strongest effects differ only past the fifth digit
        entry['quantile'] = clean_number(quantiles[row, column], digits=7)
    entry.update(describe_row(adata, row))
    track = describe_track(adata, column)
    if track:
        entry['track'] = track
    return entry


# ----------------------------------------------------------------------------
# Summaries
# ----------------------------------------------------------------------------


def top_cells(adata, limit: int, curies=None, genes=None, rows: Optional[np.ndarray] = None) -> List[Dict[str, Any]]:
    """The `limit` cells with the largest absolute score, after filtering."""
    scores, kept_rows, kept_columns = select(adata, curies, genes)
    if rows is not None:
        kept_rows = np.intersect1d(kept_rows, np.asarray(rows, dtype=int))
    if kept_rows.size == 0 or kept_columns.size == 0:
        return []
    quantiles = quantiles_of(adata)
    block = np.abs(np.nan_to_num(scores[np.ix_(kept_rows, kept_columns)], nan=0.0))
    flat = block.ravel()
    limit = max(1, min(int(limit), flat.size))
    picked = np.argpartition(-flat, limit - 1)[:limit]
    picked = picked[np.argsort(-flat[picked], kind='stable')]
    cells = []
    for index in picked:
        local_row, local_column = np.unravel_index(int(index), block.shape)
        cells.append(
            cell(adata, scores, quantiles, int(kept_rows[local_row]), int(kept_columns[local_column]))
        )
    return cells


def strongest_cell(adata, curies=None, genes=None, rows: Optional[np.ndarray] = None) -> Optional[Dict[str, Any]]:
    cells = top_cells(adata, 1, curies, genes, rows)
    return cells[0] if cells else None


def scorer_statistics(adata, curies=None, genes=None) -> Dict[str, Any]:
    scores, rows, columns = select(adata, curies, genes)
    block = np.abs(scores[np.ix_(rows, columns)]) if rows.size and columns.size else np.empty((0, 0))
    has_values = block.size > 0 and not np.all(np.isnan(block))
    return {
        'rows': int(rows.size),
        'tracks': int(columns.size),
        'max_abs_score': clean_number(np.nanmax(block)) if has_values else None,
        'median_abs_score': clean_number(np.nanmedian(block)) if has_values else None,
    }


def summarise_variant(
    source: str,
    variant: str,
    result: Dict[str, Any],
    scorers: Sequence[str],
    signed: Dict[str, bool],
    top_n: int,
    curies: Optional[Sequence[str]] = None,
    genes: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    """The response for one variant: the strongest cells of each scorer.

    Never the matrix: one variant is thousands of numbers per scorer.
    """
    per_scorer = max(1, top_n // max(1, len(scorers)))
    summaries = []
    for scorer in scorers:
        adata = result.get(scorer)
        if adata is None:
            summaries.append({'scorer': scorer, 'available': False})
            continue
        summary = {'scorer': scorer, 'available': True, 'is_signed': bool(signed.get(scorer, False))}
        summary.update(scorer_statistics(adata, curies, genes))
        summary['top'] = top_cells(adata, per_scorer, curies, genes)
        summaries.append(summary)

    response = {
        'source': source,
        'variant': variant,
        'scorers': list(scorers),
        'rows_per_scorer': per_scorer,
        'response_cap': (
            f'top {per_scorer} cells per scorer by absolute score (top_n={top_n}); '
            'the full matrix is not returned'
        ),
        'results': summaries,
    }
    if curies:
        response['tissue_filter'] = list(curies)
    if genes:
        response['gene_filter'] = list(genes)
    return response


def strongest_by_scorer(result: Dict[str, Any], scorers: Sequence[str], curies=None, genes=None) -> Dict[str, Any]:
    """{scorer: strongest cell} for one variant; the row a ranking shows."""
    strongest = {}
    for scorer in scorers:
        adata = result.get(scorer)
        if adata is None:
            continue
        found = strongest_cell(adata, curies, genes)
        if found is not None:
            strongest[scorer] = found
    return strongest


# ----------------------------------------------------------------------------
# Ranking many variants
# ----------------------------------------------------------------------------


def ranking_rule(scorers: Sequence[str]) -> str:
    if len(scorers) == 1:
        return f'absolute {scorers[0]} score'
    return 'largest absolute quantile across ' + ', '.join(scorers)


def rank_value(scores: Dict[str, Any], scorers: Sequence[str]) -> float:
    """The number a variant is ranked by.

    One scorer: its absolute score. Several scorers: the largest absolute
    quantile, because quantiles are calibrated and raw scores of different
    scorers are not on one scale.
    """
    if len(scorers) == 1:
        value = (scores.get(scorers[0]) or {}).get('score')
        return abs(value) if value is not None else -1.0
    best = -1.0
    for scorer in scorers:
        entry = scores.get(scorer) or {}
        value = entry.get('quantile')
        if value is None:
            value = entry.get('score')
        if value is not None:
            best = max(best, abs(value))
    return best


def tie_breaker(scores: Dict[str, Any], scorers: Sequence[str]) -> float:
    """Mean absolute quantile, to order variants whose strongest quantile ties near 1."""
    values = []
    for scorer in scorers:
        entry = scores.get(scorer) or {}
        value = entry.get('quantile', entry.get('score'))
        if value is not None:
            values.append(abs(value))
    return sum(values) / len(values) if values else -1.0


def rank_entries(entries: List[Dict[str, Any]], scorers: Sequence[str]) -> List[Dict[str, Any]]:
    ranked = sorted(
        entries,
        key=lambda entry: (
            rank_value(entry.get('scores', {}), scorers),
            tie_breaker(entry.get('scores', {}), scorers),
        ),
        reverse=True,
    )
    for rank, entry in enumerate(ranked, start=1):
        entry['rank'] = rank
    return ranked


def resolve_names(
    requested: Optional[Iterable[str]], defaults: Sequence[str], available: Iterable[str], what: str
) -> List[str]:
    """Scorer names checked against the ones a source really has."""
    names = list(requested) if requested else list(defaults)
    lookup = {str(name).upper(): name for name in available}
    resolved: List[str] = []
    unknown = []
    for name in names:
        match = lookup.get(str(name).upper())
        if match is None:
            unknown.append(name)
        elif match not in resolved:
            resolved.append(match)
    if unknown:
        raise InvalidRequest(f'Unknown {what} scorer(s): {unknown}. Available: {sorted(lookup.values())}')
    return resolved


def variant_fields(item: Dict[str, Any]) -> Tuple[str, int, str, str]:
    try:
        ref = item.get('ref', item.get('reference_bases'))
        alt = item.get('alt', item.get('alternate_bases'))
        if not ref or not alt:
            raise KeyError('ref/alt')
        return (str(item['chromosome']), int(item['position']), str(ref).upper(), str(alt).upper())
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        raise InvalidRequest(f'A variant needs chromosome, position, ref and alt: {item!r}') from error
