// src/utils/formatting.ts

import { VariantResult, RegionResult, BatchResult } from '../types.js';

/**
 * Format variant prediction result as beautiful Markdown
 */
export function formatVariantResult(result: VariantResult): string {
  const date = new Date().toISOString().split('T')[0];
  const time = new Date().toISOString().split('T')[1].split('.')[0];

  let output = `# 🧬 AlphaGenome Variant Analysis\n\n`;
  output += `**Variant**: ${result.variant}\n`;
  if (result.gene_context) {
    output += `**Gene Context**: ${result.gene_context}\n`;
  }
  output += `**Analysis Date**: ${date} ${time} UTC\n`;
  output += formatSourceLine(result.source, result.source_hint);
  output += `\n---\n\n`;

  // Summary table
  output += `## 📊 Regulatory Impact Summary\n\n`;
  output += `| Metric | Reference | Alternate | Change | Impact Level |\n`;
  output += `|--------|-----------|-----------|--------|--------------||\n`;

  if (result.predictions.rna_seq) {
    const rna = result.predictions.rna_seq;
    const change = (
      ((rna.alternate_score - rna.reference_score) / rna.reference_score) *
      100
    ).toFixed(0);
    const arrow = parseFloat(change) < 0 ? '↓' : '↑';
    const level =
      Math.abs(parseFloat(change)) > 50
        ? '🔴 High'
        : Math.abs(parseFloat(change)) > 20
          ? '🟡 Moderate'
          : '🟢 Low';
    output += `| RNA Expression | ${rna.reference_score.toFixed(
      2
    )} | ${rna.alternate_score.toFixed(2)} | ${change}% ${arrow} | ${level} |\n`;
  }

  if (result.predictions.splice) {
    const splice = result.predictions.splice;
    const change = (splice.delta * 100).toFixed(0);
    const arrow = splice.delta < 0 ? '↓' : '↑';
    const level = Math.abs(splice.delta) > 0.2 ? '🟡 Moderate' : '🟢 Low';
    output += `| Splice Score | ${splice.reference_score.toFixed(
      2
    )} | ${splice.alternate_score.toFixed(2)} | ${change}% ${arrow} | ${level} |\n`;
  }

  output += `\n**Overall Impact**: ${getImpactBadge(result.interpretation.impact_level)}\n\n`;
  output += `---\n\n`;

  // Detailed analysis
  output += `## 🔬 Detailed Analysis\n\n`;

  if (result.predictions.rna_seq) {
    const rna = result.predictions.rna_seq;
    output += `### RNA Expression Impact\n`;
    output += `- **Fold Change**: ${rna.fold_change.toFixed(2)}x ${
      rna.fold_change < 0 ? 'decrease' : 'increase'
    }\n`;
    output += `- **Mechanism**: Likely affects ${
      rna.fold_change < 0 ? 'promoter activity' : 'enhancer activation'
    }\n\n`;
  }

  if (result.predictions.splice) {
    const splice = result.predictions.splice;
    output += `### Splicing Analysis\n`;
    output += `- **Consequence**: ${splice.consequence.replace(/_/g, ' ')}\n`;
    output += `- **Clinical Relevance**: ${getSpliceRelevance(splice.delta)}\n\n`;
  }

  if (result.predictions.tf_binding && result.predictions.tf_binding.length > 0) {
    output += `### Transcription Factor Binding\n`;
    output += `**Disrupted Sites** (${result.predictions.tf_binding.length} found):\n`;
    result.predictions.tf_binding.forEach((tf, i) => {
      const pct = (tf.change * 100).toFixed(0);
      output += `${i + 1}. **${tf.factor}** binding site\n`;
      output += `   - Reference score: ${tf.ref_score.toFixed(2)}\n`;
      output += `   - Alternate score: ${tf.alt_score.toFixed(2)}\n`;
      output += `   - Change: ${pct}% ${tf.change < 0 ? '↓' : '↑'}\n\n`;
    });
  }

  // Clinical interpretation
  output += `---\n\n`;
  output += `## 🎯 Clinical Interpretation\n\n`;
  output += `### Impact Classification\n`;
  output += `**${result.interpretation.clinical_significance?.toUpperCase() || 'UNCERTAIN'}** `;
  output += `(impact level: ${result.interpretation.impact_level})\n\n`;

  if (result.interpretation.recommendations.length > 0) {
    output += `### Recommendations\n`;
    result.interpretation.recommendations.forEach((rec) => {
      output += `- 🔬 ${rec}\n`;
    });
    output += `\n`;
  }

  // Disclaimer
  output += `---\n\n`;
  output += `## ⚠️ Important Disclaimer\n\n`;
  output += `**For Research Use Only**\n\n`;
  output += `- ⚠️ NOT for clinical diagnosis or treatment decisions\n`;
  output += `- ✅ Powered by Google DeepMind's AlphaGenome AI\n`;
  output += `- ✅ Predictions based on multi-modal genomic data\n`;
  output += `- 📋 Always validate findings with wet-lab experiments\n\n`;
  output += `---\n\n`;
  output += `*AlphaGenome MCP Server*\n`;
  output += `*GitHub: https://github.com/taehojo/alphagenome-mcp*\n`;

  return output;
}

/**
 * Format region analysis result as beautiful Markdown
 */
export function formatRegionResult(result: RegionResult): string {
  const date = new Date().toISOString().split('T')[0];
  const time = new Date().toISOString().split('T')[1].split('.')[0];

  let output = `# 🔍 AlphaGenome Region Analysis\n\n`;
  output += `**Region**: ${result.region}\n`;
  output += `**Analysis Date**: ${date} ${time} UTC\n\n`;
  output += `---\n\n`;

  output += `## 📊 Regulatory Elements Detected\n\n`;

  if (result.elements.promoters && result.elements.promoters.length > 0) {
    output += `### Promoters (${result.elements.promoters.length} found)\n`;
    result.elements.promoters.forEach((p, i) => {
      output += `${i + 1}. **Position**: ${p.start.toLocaleString()}-${p.end.toLocaleString()}\n`;
      output += `   - **Score**: ${p.score.toFixed(2)} (${getConfidenceLabel(p.score)})\n`;
      output += `   - **Type**: ${p.type.replace(/_/g, ' ')}\n`;
      if (p.associated_gene) {
        output += `   - **Associated Gene**: ${p.associated_gene}\n`;
      }
      if (p.activity) {
        output += `   - **Activity**: ${p.activity}\n`;
      }
      output += `\n`;
    });
  }

  if (result.elements.enhancers && result.elements.enhancers.length > 0) {
    output += `### Enhancers (${result.elements.enhancers.length} found)\n`;
    result.elements.enhancers.forEach((e, i) => {
      output += `${i + 1}. **Position**: ${e.start.toLocaleString()}-${e.end.toLocaleString()}\n`;
      output += `   - **Score**: ${e.score.toFixed(2)} (${getConfidenceLabel(e.score)})\n`;
      if (e.type) {
        output += `   - **Type**: ${e.type.replace(/_/g, ' ')}\n`;
      }
      if (e.target_gene) {
        output += `   - **Target Gene**: ${e.target_gene}\n`;
      }
      if (e.distance_to_tss) {
        output += `   - **Distance to TSS**: ${e.distance_to_tss.toLocaleString()} bp\n`;
      }
      if (e.chromatin_loop) {
        output += `   - **Chromatin Loop**: Confirmed by Hi-C\n`;
      }
      output += `\n`;
    });
  }

  if (result.elements.tf_binding_sites && result.elements.tf_binding_sites.length > 0) {
    output += `### Transcription Factor Binding Sites (${result.elements.tf_binding_sites.length} found)\n\n`;
    output += `**High-confidence sites** (score > 0.8):\n`;
    const highConf = result.elements.tf_binding_sites.filter((s) => s.score > 0.8);
    highConf.forEach((s) => {
      output += `- **${s.factor}** (${s.position.toLocaleString()}): Score ${s.score.toFixed(
        2
      )} [${s.strand}]\n`;
    });
    output += `\n`;
  }

  if (result.elements.chromatin_states && result.elements.chromatin_states.length > 0) {
    output += `### Chromatin State Map\n\n`;
    output += `| Position Range | State | Activity |\n`;
    output += `|----------------|-------|----------|\n`;
    result.elements.chromatin_states.forEach((cs) => {
      output += `| ${cs.start.toLocaleString()}-${cs.end.toLocaleString()} | ${
        cs.state
      } | ${cs.activity} |\n`;
    });
    output += `\n`;
  }

  output += `---\n\n`;
  output += `## ⚠️ Important Disclaimer\n\n`;
  output += `**For Research Use Only**\n\n`;
  output += `- ⚠️ NOT for clinical use or diagnosis\n`;
  output += `- ✅ Powered by AlphaGenome AI predictions\n`;
  output += `- 📋 Validate with experimental data\n\n`;
  output += `---\n\n`;
  output += `*AlphaGenome MCP Server*\n`;
  output += `*GitHub: https://github.com/taehojo/alphagenome-mcp*\n`;

  return output;
}

/**
 * Format batch scoring result as beautiful Markdown
 */
export function formatBatchResult(result: BatchResult): string {
  const date = new Date().toISOString().split('T')[0];
  const time = new Date().toISOString().split('T')[1].split('.')[0];

  let output = `# 📊 AlphaGenome Batch Variant Analysis\n\n`;
  output += `**Total Variants Analyzed**: ${result.total_analyzed}\n`;
  output += `**Analysis Date**: ${date} ${time} UTC\n`;
  output += formatSourceLine(result.source);
  if (result.source_counts) {
    const c = result.source_counts;
    output += `**Answered from**: atlas ${c.atlas}, live ${c.live}`;
    output += c.atlas_fallback > 0 ? ` (${c.atlas_fallback} after atlas fallback)\n` : `\n`;
  }
  output += `\n---\n\n`;

  output += `## 🏆 Top Variants by Impact\n\n`;
  output += `| Rank | Variant ID | Location | Impact Score | Impact Level | Key Effect |\n`;
  output += `|------|------------|----------|--------------|--------------|------------|\n`;

  result.variants.forEach((v) => {
    const badge =
      v.impact_level === 'high'
        ? '🔴 High'
        : v.impact_level === 'moderate'
          ? '🟡 Moderate'
          : '🟢 Low';
    const varId = v.variant_id || '-';
    const keyEffect = v.key_effect || 'Regulatory element';
    output += `| ${v.rank} | ${varId} | ${v.variant} | ${v.score.toFixed(
      2
    )} | ${badge} | ${keyEffect} |\n`;
  });

  output += `\n---\n\n`;

  output += `## 📈 Impact Distribution\n\n`;
  output += `\`\`\`\n`;
  output += `Impact Level    | Count | Percentage\n`;
  output += `----------------|-------|------------\n`;
  for (const [level, count] of Object.entries(result.distribution)) {
    const pct = ((count / result.total_analyzed) * 100).toFixed(1);
    const emoji = level === 'high' ? '🔴' : level === 'moderate' ? '🟡' : '🟢';
    output += `${emoji} ${level.padEnd(13)} | ${String(count).padStart(5)} | ${pct.padStart(5)}%\n`;
  }
  output += `----------------|-------|------------\n`;
  output += `Total           | ${String(result.total_analyzed).padStart(5)} | 100.0%\n`;
  output += `\`\`\`\n\n`;

  output += `---\n\n`;
  output += `## ⚠️ Important Disclaimer\n\n`;
  output += `**For Research Use Only**\n\n`;
  output += `- ⚠️ NOT for clinical use or diagnosis\n`;
  output += `- ✅ Powered by AlphaGenome AI predictions\n`;
  output += `- 📋 Validate with experimental data\n\n`;
  output += `---\n\n`;
  output += `*AlphaGenome MCP Server*\n`;
  output += `*GitHub: https://github.com/taehojo/alphagenome-mcp*\n`;

  return output;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * The line that says where an answer came from. Every formatted result has
 * one, so a reader never has to guess whether a number is a precomputed Atlas
 * score or a fresh model call.
 */
export function formatSourceLine(source?: string, hint?: string): string {
  let line = `**Source**: ${source ?? 'live'}\n`;
  if (hint) {
    line += `**Note**: ${hint}\n`;
  }
  return line;
}

function getImpactBadge(level: string): string {
  switch (level) {
    case 'critical':
    case 'high':
      return '🔴 HIGH RISK ⚠️';
    case 'moderate':
      return '🟡 MODERATE RISK';
    case 'low':
      return '🟢 LOW RISK';
    default:
      return '⚪ UNKNOWN';
  }
}

function getConfidenceLabel(score: number): string {
  if (score >= 0.9) return 'Very High';
  if (score >= 0.7) return 'High';
  if (score >= 0.5) return 'Moderate';
  return 'Low';
}

function getSpliceRelevance(delta: number): string {
  const abs = Math.abs(delta);
  if (abs > 0.3) return 'High - May cause aberrant splicing';
  if (abs > 0.15) return 'Moderate - Could affect splicing';
  return 'Low - Minimal splicing impact';
}
