// docs/generate-api.mjs
//
// Writes docs/API.md from the tool definitions in src/tools.ts (through the
// build), so the reference cannot drift from what the server really exposes.
//
//   npm run docs:api          regenerate docs/API.md
//   npm run docs:api:check    fail if docs/API.md is out of date (CI)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, 'API.md');
const { ALL_TOOLS } = await import(pathToFileURL(path.join(here, '..', 'build', 'tools.js')).href);

const GROUPS = [
  {
    title: 'Tools that choose between the Atlas and live inference',
    intro:
      'A single-nucleotide variant is answered from the precomputed AlphaGenome Atlas; an indel or multi-nucleotide variant runs live inference. Override with `source`.',
    match: (tool) => 'source' in (tool.inputSchema.properties ?? {}),
    source:
      '`source=auto` (default): Atlas for single-nucleotide variants, live inference otherwise; falls back to live only when the Atlas does not hold the variant, and labels it `live (atlas fallback: <reason>)`. `source=atlas`: Atlas only, never falls back. `source=live`: always runs the model.',
  },
  {
    title: 'Live-inference tools',
    intro:
      "These run `score_variant` with the SDK's recommended variant scorers. They accept single-nucleotide variants, indels and multi-nucleotide variants.",
    match: (tool) => !tool.name.startsWith('atlas_'),
    source: 'Live inference only. The result states `source: live`.',
  },
  {
    title: 'AlphaGenome Atlas tools',
    intro:
      'Precomputed scores for single-nucleotide substitutions on hg38. No model call.',
    match: () => true,
    source: 'Atlas only. The result states `source: atlas`.',
  },
];

function typeOf(schema) {
  if (schema.enum) return schema.enum.map((value) => `\`${value}\``).join(' \\| ');
  if (schema.type === 'array') {
    const items = schema.items ?? {};
    if (items.enum) return `array of ${items.enum.map((value) => `\`${value}\``).join(' \\| ')}`;
    return `array of ${items.type === 'object' ? 'variant objects' : (items.type ?? 'values')}`;
  }
  return schema.type === 'object' ? 'variant object' : (schema.type ?? 'any');
}

function limits(schema) {
  const parts = [];
  if (schema.minimum !== undefined) parts.push(`min ${schema.minimum}`);
  if (schema.maximum !== undefined) parts.push(`max ${schema.maximum}`);
  if (schema.minItems !== undefined) parts.push(`at least ${schema.minItems}`);
  if (schema.maxItems !== undefined) parts.push(`at most ${schema.maxItems}`);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

const oneLine = (text) => String(text ?? '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();

function variantFields(schema) {
  const object = schema.type === 'array' ? schema.items : schema;
  if (!object || object.type !== 'object' || !object.properties) return '';
  const required = new Set(object.required ?? []);
  const fields = Object.keys(object.properties).map((name) =>
    required.has(name) ? `\`${name}\`` : `\`${name}\` (optional)`
  );
  return ` Fields: ${fields.join(', ')}.`;
}

function renderTool(tool, source) {
  const [purpose, ...rest] = (tool.description ?? '').split('\n\n');
  const example = rest.find((paragraph) => paragraph.startsWith('Example:'));
  const details = rest.filter(
    (paragraph) =>
      !paragraph.startsWith('Example:') &&
      !paragraph.startsWith('Source:') &&
      !paragraph.startsWith('Runs live inference') &&
      !paragraph.startsWith('Results are AlphaGenome model predictions') &&
      !paragraph.startsWith('The Atlas holds precomputed') &&
      !paragraph.startsWith('The response is a summary')
  );

  let out = `### ${tool.name}\n\n${purpose.trim()}\n\n`;
  for (const paragraph of details) out += `${paragraph.trim()}\n\n`;
  out += `**Source behavior.** ${source}\n\n`;

  const properties = tool.inputSchema.properties ?? {};
  const required = new Set(tool.inputSchema.required ?? []);
  const names = Object.keys(properties);
  if (names.length === 0) {
    out += `**Parameters.** None.\n\n`;
  } else {
    out += `| Parameter | Type | Required | Description |\n|---|---|---|---|\n`;
    for (const name of names) {
      const schema = properties[name];
      const description = oneLine(schema.description) + limits(schema) + variantFields(schema);
      out += `| \`${name}\` | ${typeOf(schema)} | ${required.has(name) ? 'yes' : 'no'} | ${description.trim() || '-'} |\n`;
    }
    out += `\n`;
  }
  if (example) out += `${example.trim()}\n\n`;
  return out;
}

let output = `# AlphaGenome MCP Server: Tool Reference

Generated from \`src/tools.ts\` by \`npm run docs:api\`; do not edit by hand.

${ALL_TOOLS.length} tools. Every result states its source (\`atlas\` or \`live\`). Results are AlphaGenome model predictions for research prioritization, not clinical classifications: scores and calibrated quantiles are reported as returned, and no tool makes a pathogenic/benign call, assigns a risk label or states a percent change. Responses are ranked summaries, never a full score matrix, capped at \`top_n\` rows and 40,000 characters.

Installation, environment variables, routing rules, default scorers and worked examples are in the [README](../README.md).

`;

const remaining = [...ALL_TOOLS];
const sections = GROUPS.map((group) => {
  const tools = remaining.filter(group.match);
  for (const tool of tools) remaining.splice(remaining.indexOf(tool), 1);
  return { ...group, tools };
});

output += `## Contents\n\n`;
for (const section of sections) {
  output += `- ${section.title}: ${section.tools.map((tool) => `[${tool.name}](#${tool.name})`).join(', ')}\n`;
}
output += `\n`;

for (const section of sections) {
  output += `## ${section.title}\n\n${section.intro}\n\n`;
  for (const tool of section.tools) output += renderTool(tool, section.source);
}
output = output.trimEnd() + '\n';

if (process.argv.includes('--check')) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== output) {
    console.error('docs/API.md is out of date. Run: npm run docs:api');
    process.exit(1);
  }
  console.log(`docs/API.md is up to date (${ALL_TOOLS.length} tools).`);
} else {
  fs.writeFileSync(target, output);
  console.log(`docs/API.md written: ${ALL_TOOLS.length} tools, ${output.length.toLocaleString()} characters.`);
}
