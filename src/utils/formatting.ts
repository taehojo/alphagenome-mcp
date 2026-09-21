// src/utils/formatting.ts

import {
  RankedVariant,
  RankedVariants,
  RegionScan,
  ScoreCell,
  ScorerList,
  SkippedVariant,
  VariantScores,
} from '../types.js';

/**
 * Text output for variant scores.
 *
 * One set of formatters for both sources: an Atlas result and a live result
 * have the same shape, and they are shown the same way, with the source on
 * its own line. Scores and quantiles are printed as returned. Nothing here
 * turns them into a class, a risk label or a percent change.
 */

/** Hard ceiling on the text of one tool response. */
export const MAX_RESPONSE_CHARS = 40000;

/** Said in every result, because these numbers are easy to over-read. */
export const RESEARCH_NOTE =
  'AlphaGenome model predictions for research prioritization. Not a clinical classification; not for diagnosis or treatment decisions.';

export function capResponse(text: string, limit: number = MAX_RESPONSE_CHARS): string {
  if (text.length <= limit) {
    return text;
  }
  const notice = `\n\n[Response truncated at ${limit.toLocaleString('en-US')} characters. Ask for a smaller top_n or fewer scorers.]\n`;
  return text.slice(0, Math.max(0, limit - notice.length)) + notice;
}

/**
 * The line that says where an answer came from. Every formatted result has
 * one, so a reader never has to guess whether a number is a precomputed Atlas
 * score or a fresh model call.
 */
export function formatSourceLine(source: string, note?: string): string {
  let line = `**Source**: ${source}\n`;
  if (note) {
    line += `**Note**: ${note}\n`;
  }
  return line;
}

export function num(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  return abs >= 1000 || abs < 0.001 ? value.toExponential(2) : value.toPrecision(4);
}

/** Quantiles crowd against 1, so they keep more digits than scores. */
export function quantile(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return String(Number(value.toPrecision(7)));
}

function cell(text: string | number | undefined | null): string {
  if (text === undefined || text === null || text === '') return '-';
  return String(text).replace(/\|/g, '/');
}

/** "APOE, psoas muscle, polyA plus RNA-seq" from whatever the cell carries. */
export function describeCell(entry: ScoreCell): string {
  const parts: string[] = [];
  if (entry.gene_name) parts.push(String(entry.gene_name));
  if (entry.junction_Start !== undefined && entry.junction_End !== undefined) {
    parts.push(`junction ${entry.junction_Start}-${entry.junction_End}`);
  }
  const track = entry.track ?? {};
  for (const key of ['transcription_factor', 'histone_mark', 'biosample_name', 'gtex_tissue']) {
    const value = track[key];
    if (value !== undefined && value !== '') parts.push(String(value));
  }
  const assay = track['Assay title'];
  if (assay) parts.push(String(assay));
  if (parts.length === 0 && track['name']) parts.push(String(track['name']));
  return parts.join(', ');
}

const FOOTER = `\n---\n\n*${RESEARCH_NOTE}*\n`;

function filterLines(result: { tissue_filter?: string[]; gene_filter?: string[] }): string {
  let output = '';
  if (result.tissue_filter?.length) output += `**Tissues**: ${result.tissue_filter.join(', ')}\n`;
  if (result.gene_filter?.length) output += `**Genes**: ${result.gene_filter.join(', ')}\n`;
  return output;
}

export function formatScorerList(result: ScorerList): string {
  let output = `# AlphaGenome Atlas: Scorers\n\n`;
  output += formatSourceLine('atlas');
  output += `**Organism**: ${result.organism}\n`;
  output += `**Coverage**: ${result.coverage}\n`;
  output += `**Default scorers, one variant**: ${result.default_scorers.single_variant.join(', ')}\n`;
  output += `**Default scorers, many variants and regions**: ${result.default_scorers.many_variants_and_regions.join(', ')}\n\n`;
  output += `| Scorer | Signed | Tracks | What it covers |\n|---|---|---|---|\n`;
  for (const scorer of result.scorers) {
    let covers = '-';
    if (scorer.assays && scorer.assays.length > 0) {
      covers = scorer.assays.join(', ');
      if (scorer.biosamples) covers += ` (${scorer.biosamples} biosamples)`;
    } else if (scorer.track_names && scorer.track_names.length > 0) {
      covers = scorer.track_names.join(', ');
    }
    output += `| ${scorer.name} | ${scorer.is_signed ? 'yes' : 'no'} | ${scorer.tracks} | ${cell(covers)} |\n`;
  }
  output += `\n"Signed" is the flag the Atlas itself reports for each scorer. The AVI scorers are served by the Atlas only; every other scorer is also available from live inference under the same name.\n`;
  return capResponse(output + FOOTER);
}

/** One variant, from either source. */
export function formatVariantScores(result: VariantScores, title = 'Variant Scores'): string {
  let output = `# AlphaGenome: ${title}\n\n`;
  output += `**Variant**: ${result.variant}\n`;
  output += formatSourceLine(result.source, result.source_note);
  output += `**Scorers**: ${result.scorers.join(', ')}\n`;
  output += filterLines(result);
  output += `**Shown**: ${result.response_cap}\n\n`;

  for (const summary of result.results) {
    output += `## ${summary.scorer}\n\n`;
    if (!summary.available) {
      output += `No scores returned for this variant.\n\n`;
      continue;
    }
    if (!summary.top || summary.top.length === 0) {
      output += `No tracks left after the tissue and gene filters.\n\n`;
      continue;
    }
    output += `${summary.rows} row(s) x ${summary.tracks} track(s); largest absolute score ${num(
      summary.max_abs_score
    )}, median ${num(summary.median_abs_score)}.\n\n`;
    output += `| Score | Quantile | Where |\n|---|---|---|\n`;
    for (const entry of summary.top) {
      output += `| ${num(entry.score)} | ${quantile(entry.quantile)} | ${cell(describeCell(entry))} |\n`;
    }
    output += `\n`;
  }
  return capResponse(output + FOOTER);
}

export function rankedTable(ranked: RankedVariant[], scorers: string[]): string {
  const withId = ranked.some((entry) => entry.variant_id);
  const single = scorers.length === 1;
  let output = `| Rank | Variant |${withId ? ' ID |' : ''}`;
  output += single
    ? ` ${scorers[0]} | Quantile | Where |`
    : scorers.map((name) => ` ${name} (score / quantile) |`).join('');
  output += `\n|---|---|${withId ? '---|' : ''}${(single ? [1, 2, 3] : scorers).map(() => '---|').join('')}\n`;
  for (const entry of ranked) {
    output += `| ${entry.rank} | ${entry.variant} |${withId ? ` ${cell(entry.variant_id)} |` : ''}`;
    if (single) {
      const main = entry.scores[scorers[0]];
      output += ` ${num(main?.score)} | ${quantile(main?.quantile)} | ${cell(main ? describeCell(main) : '')} |`;
    } else {
      for (const name of scorers) {
        const found = entry.scores[name];
        output += found ? ` ${num(found.score)} / ${quantile(found.quantile)} |` : ` - |`;
      }
    }
    output += `\n`;
  }
  return output;
}

function skippedList(title: string, skipped: SkippedVariant[]): string {
  if (skipped.length === 0) return '';
  let output = `\n### ${title} (${skipped.length})\n\n`;
  for (const entry of skipped.slice(0, 50)) {
    const id = entry.variant_id ? ` (${entry.variant_id})` : '';
    output += `- ${entry.variant}${id}: ${entry.reason}\n`;
  }
  if (skipped.length > 50) output += `- ... and ${skipped.length - 50} more\n`;
  return output;
}

/** The body of one ranked group; used alone and inside a mixed batch. */
export function formatRankedGroup(result: RankedVariants): string {
  let output = formatSourceLine(result.source);
  output += `**Requested**: ${result.requested} | **Scored**: ${result.found}`;
  if (result.not_in_atlas.length > 0)
    output += ` | **Not in the Atlas**: ${result.not_in_atlas.length}`;
  if (result.invalid.length > 0) output += ` | **Not scored**: ${result.invalid.length}`;
  output += `\n**Scorers**: ${result.scorers.join(', ')}\n`;
  output += `**Ranked by**: ${result.ranked_by}\n`;
  output += filterLines(result);
  if (!result.complete) {
    output += `**Incomplete**: the time limit was reached before every variant was scored; the unscored ones are listed below.\n`;
  }
  output += `**Shown**: ${result.response_cap}\n\n`;
  output += rankedTable(result.ranked, result.scorers);
  output += skippedList('Not in the Atlas', result.not_in_atlas);
  output += skippedList('Not scored', result.invalid);
  return output;
}

export function formatRankedVariants(result: RankedVariants, title = 'Variant Ranking'): string {
  return capResponse(`# AlphaGenome: ${title}\n\n` + formatRankedGroup(result) + FOOTER);
}

export function formatRegionScan(result: RegionScan): string {
  let output = `# AlphaGenome Atlas: Region Scan\n\n`;
  output += `**Region requested**: ${result.region} (${result.width_bp.toLocaleString('en-US')} bp)\n`;
  output += formatSourceLine('atlas');
  if (result.complete) {
    output += `**Region scanned**: ${result.scanned_region} (complete)\n`;
  } else {
    const reason = (result.stopped_because ?? 'stopped early').replace(/[.\s]+$/, '');
    output += `**Incomplete**: scanned ${result.scanned_region} only (${reason}). The ranking below covers the scanned part, not the whole request.\n`;
  }
  output += `**Substitutions scanned**: ${result.variants_scanned.toLocaleString('en-US')}\n`;
  output += `**Ranked by**: ${result.ranked_by}\n`;
  output += `**Shown**: ${result.response_cap}\n`;
  if (result.ranking_value_distribution) {
    const d = result.ranking_value_distribution;
    output += `**Ranking value in the scanned part**: median ${num(d.median)}, 90th percentile ${num(
      d.p90
    )}, 99th percentile ${num(d.p99)}, max ${num(d.max)}\n`;
  }
  output += `\n`;
  output += rankedTable(result.ranked, result.scorers);
  return capResponse(output + FOOTER);
}
