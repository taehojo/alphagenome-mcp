"""
Unit tests for the shared summarizer.

They use small stand-ins for the AnnData that the Atlas and score_variant
return, so they need numpy and pandas but neither the AlphaGenome SDK nor an
API key:

    python -m unittest discover -s scripts/tests
"""

import json
import os
import sys
import types
import unittest

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

import summaries  # noqa: E402  pylint: disable=wrong-import-position


def fake_adata(scores, quantiles=None, obs=None, var=None):
    """Same attributes as the AnnData of one scorer."""
    scores = np.asarray(scores, dtype=np.float32)
    layers = {} if quantiles is None else {'quantiles': np.asarray(quantiles, dtype=np.float32)}
    return types.SimpleNamespace(
        X=scores,
        layers=layers,
        obs=pd.DataFrame(obs if obs is not None else {}, index=[str(i) for i in range(scores.shape[0])]),
        var=pd.DataFrame(var if var is not None else {}, index=[str(i) for i in range(scores.shape[1])]),
        n_obs=scores.shape[0],
    )


def dnase():
    """One row (the variant), three tissue tracks."""
    return fake_adata(
        [[0.10, -2.50, 0.75]],
        [[0.60, -0.9999123, 0.95]],
        var={
            'name': ['brain DNase', 'liver DNase', 'heart DNase'],
            'Assay title': ['DNase-seq'] * 3,
            'biosample_name': ['brain', 'liver', 'heart'],
            'ontology_curie': ['UBERON:0000955', 'UBERON:0002107', 'UBERON:0000948'],
            'strand': ['.', '.', '.'],
        },
    )


def rna_seq():
    """Two gene rows, two tissue tracks."""
    return fake_adata(
        [[0.01, 0.02], [-0.90, 0.30]],
        [[0.10, 0.20], [-0.99, 0.80]],
        obs={'gene_name': ['MARK4', 'APOE'], 'gene_id': ['ENSG1', 'ENSG2']},
        var={
            'name': ['brain RNA', 'liver RNA'],
            'biosample_name': ['brain', 'liver'],
            'ontology_curie': ['UBERON:0000955', 'UBERON:0002107'],
        },
    )


def splice_sites():
    """No ontology metadata: a tissue filter must leave it alone."""
    return fake_adata([[0.05, 0.40]], [[0.5, 0.97]], obs={'gene_name': ['APOE']}, var={'name': ['donor', 'acceptor']})


class TopCells(unittest.TestCase):
    def test_ranked_by_absolute_score_with_sign_kept(self):
        cells = summaries.top_cells(dnase(), 2)
        self.assertEqual([c['score'] for c in cells], [-2.5, 0.75])
        self.assertEqual(cells[0]['track']['biosample_name'], 'liver')

    def test_quantile_is_reported_as_returned_with_enough_digits(self):
        cell = summaries.top_cells(dnase(), 1)[0]
        self.assertAlmostEqual(cell['quantile'], -0.9999123, places=6)
        self.assertNotEqual(cell['quantile'], -1.0)

    def test_gene_rows_are_named(self):
        cell = summaries.top_cells(rna_seq(), 1)[0]
        self.assertEqual((cell['gene_name'], cell['score']), ('APOE', -0.9))

    def test_limit_larger_than_the_matrix(self):
        self.assertEqual(len(summaries.top_cells(dnase(), 50)), 3)

    def test_no_quantile_layer_means_no_quantile_field(self):
        adata = fake_adata([[1.0, 2.0]], var={'name': ['a', 'b']})
        self.assertNotIn('quantile', summaries.top_cells(adata, 1)[0])

    def test_nan_is_never_the_strongest_and_never_serialised(self):
        adata = fake_adata([[np.nan, 0.2]], [[np.nan, 0.5]], var={'name': ['a', 'b']})
        cells = summaries.top_cells(adata, 2)
        self.assertEqual(cells[0]['score'], 0.2)
        self.assertIsNone(cells[1]['score'])
        json.dumps(cells, allow_nan=False)

    def test_dot_strand_is_dropped(self):
        self.assertNotIn('strand', summaries.top_cells(dnase(), 1)[0]['track'])


class Filters(unittest.TestCase):
    def test_tissue_filter_keeps_matching_tracks_only(self):
        cells = summaries.top_cells(dnase(), 5, curies=['UBERON:0000955'])
        self.assertEqual([c['track']['biosample_name'] for c in cells], ['brain'])

    def test_tissue_filter_leaves_a_scorer_without_ontology_alone(self):
        self.assertEqual(len(summaries.top_cells(splice_sites(), 5, curies=['UBERON:0000955'])), 2)

    def test_gene_filter(self):
        cells = summaries.top_cells(rna_seq(), 5, genes=['mark4'])
        self.assertEqual({c['gene_name'] for c in cells}, {'MARK4'})

    def test_gene_filter_leaves_a_scorer_without_genes_alone(self):
        self.assertEqual(len(summaries.top_cells(dnase(), 5, genes=['APOE'])), 3)

    def test_a_filter_that_matches_nothing_gives_nothing(self):
        self.assertEqual(summaries.top_cells(dnase(), 5, curies=['CL:0000000']), [])
        stats = summaries.scorer_statistics(dnase(), curies=['CL:0000000'])
        self.assertEqual((stats['tracks'], stats['max_abs_score']), (0, None))

    def test_tissue_names_and_curies(self):
        self.assertEqual(summaries.resolve_tissues(['Brain', 'CL:0000540']), ['UBERON:0000955', 'CL:0000540'])
        self.assertIsNone(summaries.resolve_tissues([]))
        with self.assertRaises(summaries.InvalidRequest):
            summaries.resolve_tissues(['spleenish'])


class VariantSummary(unittest.TestCase):
    def summary(self, source):
        result = {'DNASE': dnase(), 'RNA_SEQ': rna_seq()}
        return summaries.summarise_variant(
            source, 'chr19:44908684:T>C', result, ['DNASE', 'RNA_SEQ', 'CAGE'], {'DNASE': True}, top_n=6
        )

    def test_same_shape_for_both_sources(self):
        atlas, live = self.summary('atlas'), self.summary('live')
        self.assertEqual(atlas['source'], 'atlas')
        self.assertEqual(live['source'], 'live')
        atlas.pop('source'), live.pop('source')
        self.assertEqual(atlas, live)

    def test_rows_are_split_across_scorers_and_capped(self):
        summary = self.summary('live')
        self.assertEqual(summary['rows_per_scorer'], 2)
        self.assertEqual([len(r.get('top', [])) for r in summary['results']], [2, 2, 0])

    def test_a_scorer_with_no_result_is_marked_not_available(self):
        self.assertEqual(self.summary('live')['results'][2], {'scorer': 'CAGE', 'available': False})

    def test_statistics(self):
        stats = self.summary('live')['results'][0]
        self.assertEqual((stats['rows'], stats['tracks'], stats['max_abs_score']), (1, 3, 2.5))

    def test_no_classification_or_percent_anywhere(self):
        text = json.dumps(self.summary('live')).lower()
        for word in ('pathogenic', 'benign', 'risk', 'impact_level', 'percent', 'confidence'):
            self.assertNotIn(word, text)

    def test_the_response_is_json_safe(self):
        json.dumps(self.summary('atlas'), allow_nan=False)


class Ranking(unittest.TestCase):
    def test_one_scorer_ranks_by_absolute_score(self):
        entries = [
            {'variant': 'a', 'scores': {'AVI_SCORE': {'score': 0.5, 'quantile': 0.9}}},
            {'variant': 'b', 'scores': {'AVI_SCORE': {'score': -2.0, 'quantile': -0.99}}},
        ]
        ranked = summaries.rank_entries(entries, ['AVI_SCORE'])
        self.assertEqual([(e['variant'], e['rank']) for e in ranked], [('b', 1), ('a', 2)])
        self.assertEqual(summaries.ranking_rule(['AVI_SCORE']), 'absolute AVI_SCORE score')

    def test_several_scorers_rank_by_quantile_not_by_raw_score(self):
        # Raw scores of different scorers are not on one scale: 300 here is an
        # unremarkable value for its scorer, 0.04 is an extreme one for its own.
        entries = [
            {'variant': 'big_raw', 'scores': {'CHIP_TF': {'score': 300.0, 'quantile': 0.40}}},
            {'variant': 'big_quantile', 'scores': {'SPLICE_SITES': {'score': 0.04, 'quantile': 0.999}}},
        ]
        ranked = summaries.rank_entries(entries, ['CHIP_TF', 'SPLICE_SITES'])
        self.assertEqual(ranked[0]['variant'], 'big_quantile')
        self.assertIn('largest absolute quantile', summaries.ranking_rule(['CHIP_TF', 'SPLICE_SITES']))

    def test_ties_near_one_are_broken_by_the_mean_quantile(self):
        entries = [
            {'variant': 'narrow', 'scores': {'A': {'score': 1, 'quantile': 0.9999}, 'B': {'score': 1, 'quantile': 0.1}}},
            {'variant': 'broad', 'scores': {'A': {'score': 1, 'quantile': 0.9999}, 'B': {'score': 1, 'quantile': 0.9}}},
        ]
        self.assertEqual(summaries.rank_entries(entries, ['A', 'B'])[0]['variant'], 'broad')

    def test_a_variant_without_scores_sorts_last(self):
        entries = [{'variant': 'empty', 'scores': {}}, {'variant': 'x', 'scores': {'A': {'score': 0.1}}}]
        self.assertEqual(summaries.rank_entries(entries, ['A'])[-1]['variant'], 'empty')


class Requests(unittest.TestCase):
    def test_scorer_names_are_case_insensitive_and_deduplicated(self):
        names = summaries.resolve_names(['dnase', 'DNASE', 'Rna_Seq'], [], ['DNASE', 'RNA_SEQ'], 'live')
        self.assertEqual(names, ['DNASE', 'RNA_SEQ'])

    def test_defaults_apply_when_nothing_is_requested(self):
        self.assertEqual(summaries.resolve_names(None, ['DNASE'], ['DNASE', 'RNA_SEQ'], 'live'), ['DNASE'])

    def test_an_unknown_scorer_is_an_invalid_request(self):
        with self.assertRaisesRegex(summaries.InvalidRequest, 'NOT_A_SCORER'):
            summaries.resolve_names(['NOT_A_SCORER'], [], ['DNASE'], 'Atlas')

    def test_top_n_is_clamped(self):
        self.assertEqual(summaries.clamp_top_n(10**6), summaries.MAX_TOP_N)
        self.assertEqual(summaries.clamp_top_n(0), 1)
        self.assertEqual(summaries.clamp_top_n('x'), summaries.DEFAULT_TOP_N)

    def test_variant_fields(self):
        self.assertEqual(
            summaries.variant_fields({'chromosome': 'chr1', 'position': '5', 'ref': 'a', 'alt': 'ag'}),
            ('chr1', 5, 'A', 'AG'),
        )
        with self.assertRaises(summaries.InvalidRequest):
            summaries.variant_fields({'chromosome': 'chr1'})


if __name__ == '__main__':
    unittest.main()
