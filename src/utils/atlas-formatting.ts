// src/utils/atlas-formatting.ts

import {
  AtlasBatchResult,
  AtlasCell,
  AtlasRankedVariant,
  AtlasRegionResult,
  AtlasScorerList,
  AtlasSkippedVariant,
  AtlasVariantResult,
} from '../types.js';
import { formatSourceLine } from './formatting.js';

/**
 * Text output for AlphaGenome Atlas results.
 *
 * Atlas results are summaries by construction (ranked rows, never a matrix).
 * capResponse() is the last line of defence: whatever a tool produced, the
 * text handed to the model stays under MAX_RESPONSE_CHARS.
 */

/** Hard ceiling on the text of one tool response. */
export const MAX_RESPONSE_CHARS = 40000;

export function capResponse(text: string, limit: number = MAX_RESPONSE_CHARS): string {
  if (text.length <= limit) {
    return text;
  }
  const notice = `\n\n[Response truncated at ${limit.toLocaleString('en-US')} characters. Ask for a smaller top_n or fewer scorers.]\n`;
  return text.slice(0, Math.max(0, limit - notice.length)) + notice;
}

function num(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  return abs >= 1000 || abs < 0.001 ? value.toExponential(2) : value.toPrecision(4);
}

function cell(text: string | number | undefined | null): string {
  if (text === undefined || text === null || text === '') return '-';
  return String(text).replace(/\|/g, '/');
}

/** "APOE, psoas muscle, polyA plus RNA-seq" from whatever the cell carries. */
function describeCell(entry: AtlasCell): string {
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

const DISCLAIMER =
  '\n---\n\n*Precomputed AlphaGenome predictions from the AlphaGenome Atlas. Research use only; not for clinical decisions.*\n';

export function formatAtlasScorers(result: AtlasScorerList): string {
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
  output += `\n"Signed" is the flag the Atlas itself reports for each scorer.\n`;
  return capResponse(output + DISCLAIMER);
}

export function formatAtlasVariant(result: AtlasVariantResult): string {
  let output = `# AlphaGenome Atlas: Variant Lookup\n\n`;
  output += `**Variant**: ${result.variant}\n`;
  output += formatSourceLine('atlas');
  output += `**Scorers**: ${result.scorers.join(', ')}\n`;
  output += `**Shown**: ${result.response_cap}\n\n`;

  for (const summary of result.results) {
    output += `## ${summary.scorer}\n\n`;
    if (!summary.available) {
      output += `No scores stored for this variant.\n\n`;
      continue;
    }
    output += `${summary.rows} row(s) x ${summary.tracks} track(s); largest absolute score ${num(
      summary.max_abs_score
    )}, median ${num(summary.median_abs_score)}.\n\n`;
    output += `| Score | Quantile | Where |\n|---|---|---|\n`;
    for (const entry of summary.top ?? []) {
      output += `| ${num(entry.score)} | ${num(entry.quantile)} | ${cell(describeCell(entry))} |\n`;
    }
    output += `\n`;
  }
  return capResponse(output + DISCLAIMER);
}

function rankedTable(ranked: AtlasRankedVariant[], scorers: string[], withId: boolean): string {
  const primary = scorers[0];
  let output = `| Rank | Variant |${withId ? ' ID |' : ''} ${primary} | Quantile | Where |`;
  for (const extra of scorers.slice(1)) output += ` ${extra} |`;
  output += `\n|---|---|${withId ? '---|' : ''}---|---|---|${scorers
    .slice(1)
    .map(() => '---|')
    .join('')}\n`;
  for (const entry of ranked) {
    const main = entry.scores[primary];
    output += `| ${entry.rank} | ${entry.variant} |${withId ? ` ${cell(entry.variant_id)} |` : ''} ${num(
      main?.score
    )} | ${num(main?.quantile)} | ${cell(main ? describeCell(main) : '')} |`;
    for (const extra of scorers.slice(1)) output += ` ${num(entry.scores[extra]?.score)} |`;
    output += `\n`;
  }
  return output;
}

function skippedList(title: string, skipped: AtlasSkippedVariant[]): string {
  if (skipped.length === 0) return '';
  let output = `\n## ${title} (${skipped.length})\n\n`;
  for (const entry of skipped.slice(0, 50)) {
    const id = entry.variant_id ? ` (${entry.variant_id})` : '';
    output += `- ${entry.variant}${id}: ${entry.reason}\n`;
  }
  if (skipped.length > 50) output += `- ... and ${skipped.length - 50} more\n`;
  return output;
}

export function formatAtlasBatch(result: AtlasBatchResult): string {
  let output = `# AlphaGenome Atlas: Variant Ranking\n\n`;
  output += formatSourceLine('atlas');
  output += `**Requested**: ${result.requested} | **Found**: ${result.found} | **Not in the Atlas**: ${result.not_in_atlas.length} | **Rejected**: ${result.invalid.length}\n`;
  output += `**Ranked by**: ${result.ranked_by}\n`;
  output += `**Shown**: ${result.response_cap}\n\n`;
  const withId = result.ranked.some((entry) => entry.variant_id);
  output += rankedTable(result.ranked, result.scorers, withId);
  output += skippedList('Not in the Atlas', result.not_in_atlas);
  output += skippedList('Rejected by the Atlas', result.invalid);
  return capResponse(output + DISCLAIMER);
}

export function formatAtlasRegion(result: AtlasRegionResult): string {
  let output = `# AlphaGenome Atlas: Region Scan\n\n`;
  output += `**Region**: ${result.region} (${result.width_bp.toLocaleString('en-US')} bp)\n`;
  output += formatSourceLine('atlas');
  output += `**Substitutions scanned**: ${result.variants_scanned.toLocaleString('en-US')}\n`;
  output += `**Ranked by**: ${result.ranked_by}\n`;
  output += `**Shown**: ${result.response_cap}\n`;
  if (!result.complete) {
    output += `**Incomplete**: scanned ${result.scanned_region ?? 'part of the region'} only. ${
      result.stopped_because ?? ''
    }\n`;
  }
  if (result.abs_score_distribution) {
    const d = result.abs_score_distribution;
    output += `**Absolute score in this region**: median ${num(d.median)}, 90th percentile ${num(
      d.p90
    )}, 99th percentile ${num(d.p99)}, max ${num(d.max)}\n`;
  }
  output += `\n`;
  output += rankedTable(result.ranked, result.scorers, false);
  return capResponse(output + DISCLAIMER);
}
