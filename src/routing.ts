// src/routing.ts

import { AtlasNotAvailableError, ValidationError } from './types.js';

/**
 * Choosing between the precomputed AlphaGenome Atlas and live inference.
 *
 * The Atlas holds scores for single-nucleotide substitutions on the human
 * reference genome. Everything else (indels, multi-nucleotide variants,
 * combinations, custom sequences) needs live inference. These functions are
 * pure so the rule can be tested without an API key.
 */

/** What the caller asked for. */
export type SourceMode = 'auto' | 'atlas' | 'live';

/** Where the answer actually came from. */
export type ResolvedSource = 'atlas' | 'live';

export const SOURCE_MODES: readonly SourceMode[] = ['auto', 'atlas', 'live'];

export interface VariantLike {
  chromosome: string;
  ref: string;
  alt: string;
}

export interface RoutingDecision {
  source: ResolvedSource;
  /** Short explanation, suitable for showing to the user. */
  reason: string;
}

const HUMAN_REFERENCE_CHROMOSOME = /^chr([1-9]|1[0-9]|2[0-2]|X|Y)$/;
const SINGLE_BASE = /^[ACGT]$/i;

/**
 * Whether the Atlas can hold this variant at all.
 *
 * This is a statement about the kind of variant, not a promise that the
 * Atlas has it: a lookup can still come back empty, which is what the
 * fallback rule below is for.
 */
export function atlasEligibility(variant: VariantLike): { eligible: boolean; reason: string } {
  if (!HUMAN_REFERENCE_CHROMOSOME.test(variant.chromosome)) {
    return {
      eligible: false,
      reason: `${variant.chromosome} is not a human reference chromosome (chr1-22, chrX, chrY)`,
    };
  }
  if (!SINGLE_BASE.test(variant.ref) || !SINGLE_BASE.test(variant.alt)) {
    const kind =
      variant.ref.length === variant.alt.length
        ? 'multi-nucleotide variant'
        : variant.ref.length > variant.alt.length
          ? 'deletion'
          : 'insertion';
    return {
      eligible: false,
      reason: `${kind} (${variant.ref}>${variant.alt}); the Atlas covers single-nucleotide substitutions only`,
    };
  }
  return { eligible: true, reason: 'single-nucleotide substitution on the human reference' };
}

/**
 * Decide where a variant is answered from.
 *
 * - live: always live inference.
 * - atlas: the Atlas or an error. A request that names the Atlas is never
 *   silently answered from somewhere else.
 * - auto: the Atlas when the variant is eligible, live inference otherwise.
 *
 * @throws ValidationError when mode is 'atlas' and the variant cannot be in the Atlas
 */
export function decideSource(mode: SourceMode, variant: VariantLike): RoutingDecision {
  if (mode === 'live') {
    return { source: 'live', reason: 'live inference requested' };
  }

  const { eligible, reason } = atlasEligibility(variant);

  if (mode === 'atlas') {
    if (!eligible) {
      throw new ValidationError(
        `source=atlas cannot answer this variant: ${reason}. Use source=auto or source=live.`
      );
    }
    return { source: 'atlas', reason };
  }

  return eligible ? { source: 'atlas', reason } : { source: 'live', reason };
}

/**
 * Whether an Atlas failure may be answered by live inference instead.
 *
 * Only in auto mode, and only when the Atlas said the variant is not
 * available. Authentication, rate limit, network and timeout failures are
 * real problems the caller needs to see, so they are never papered over.
 */
export function shouldFallBackToLive(mode: SourceMode, error: unknown): boolean {
  return mode === 'auto' && error instanceof AtlasNotAvailableError;
}

/**
 * A hint for the most common reason an eligible variant is missing: the given
 * reference base does not match the reference genome at that position.
 */
export function fallbackHint(reason: string): string | undefined {
  if (/reference|ref(erence)?[ _-]?base|mismatch|does not match/i.test(reason)) {
    return (
      'The reference base may not match the human reference genome (hg38) at this position. ' +
      'Check the coordinate system (1-based), the genome build, and the strand.'
    );
  }
  return undefined;
}

/** The label every result carries. */
export function sourceLabel(source: ResolvedSource, fallbackReason?: string): string {
  if (source === 'live' && fallbackReason) {
    return `live (atlas fallback: ${fallbackReason})`;
  }
  return source;
}

/**
 * Split a batch by where each variant will be answered from, keeping the
 * original index so results can be put back in order.
 */
export function partitionBySource<T extends VariantLike>(
  mode: SourceMode,
  variants: readonly T[]
): { atlas: Array<{ index: number; variant: T }>; live: Array<{ index: number; variant: T }> } {
  const atlas: Array<{ index: number; variant: T }> = [];
  const live: Array<{ index: number; variant: T }> = [];
  variants.forEach((variant, index) => {
    const decision = decideSource(mode, variant);
    (decision.source === 'atlas' ? atlas : live).push({ index, variant });
  });
  return { atlas, live };
}
