// src/utils/validation.ts

import { z } from 'zod';

/**
 * Zod validation schemas for AlphaGenome MCP Server inputs
 */

// ============================================================================
// Base Validation Schemas
// ============================================================================

// Chromosome validation
const chromosomeSchema = z
  .string()
  .regex(
    /^chr([1-9]|1[0-9]|2[0-2]|X|Y)$/,
    'Invalid chromosome format (use chr1-chr22, chrX, chrY)'
  );

// Nucleotide validation (case-insensitive, converts to uppercase)
const nucleotideSchema = z
  .string()
  .regex(/^[ATGCatgc]+$/, 'Invalid nucleotide (use A, T, G, C only)')
  .transform((s) => s.toUpperCase());

// Positive integer validation
const positiveIntSchema = z.number().int().positive('Position must be a positive integer');

// Where a variant is answered from. Omitted means auto.
const sourceSchema = z.enum(['auto', 'atlas', 'live']).optional().default('auto');

// Atlas scorer names. The valid names come from atlas_list_scorers.
const scorersSchema = z
  .array(z.string().min(1, 'Scorer name must not be empty'))
  .min(1, 'scorers must not be empty when given')
  .max(20, 'At most 20 scorers per request')
  .optional();

// ============================================================================
// Shared pieces
// ============================================================================

const variantShape = {
  chromosome: chromosomeSchema,
  position: positiveIntSchema,
  ref: nucleotideSchema,
  alt: nucleotideSchema,
};

const differentAlleles = {
  check: (data: { ref: string; alt: string }) => data.ref !== data.alt,
  message: { message: 'Reference and alternate alleles must be different' },
};

/** A variant of any kind: SNV, indel or multi-nucleotide. */
export const variantSchema = z
  .object({ ...variantShape, variant_id: z.string().optional() })
  .refine(differentAlleles.check, differentAlleles.message);

const tissueSchema = z.string().min(1).optional();

/** Most variants one live-inference call accepts; each one runs the model. */
export const LIVE_MAX_VARIANTS = 100;

const liveVariantsSchema = z
  .array(variantSchema)
  .min(1, 'At least one variant is required')
  .max(LIVE_MAX_VARIANTS, `Maximum ${LIVE_MAX_VARIANTS} variants allowed`);

// ============================================================================
// Tools that route between the Atlas and live inference
// ============================================================================

export const variantPredictionSchema = z
  .object({
    ...variantShape,
    output_types: z
      .array(
        z.enum([
          'rna_seq',
          'cage',
          'splice',
          'histone',
          'tf_binding',
          'dnase',
          'atac',
          'contact_map',
        ])
      )
      .optional(),
    tissue_type: tissueSchema,
    source: sourceSchema,
    scorers: scorersSchema,
  })
  .refine(differentAlleles.check, differentAlleles.message);

export const batchScoreSchema = z.object({
  variants: liveVariantsSchema,
  scoring_metric: z.enum(['rna_seq', 'splice', 'regulatory_impact', 'combined']),
  top_n: z.number().int().min(1).max(100).optional().default(10),
  source: sourceSchema,
  scorers: scorersSchema,
});

export const pathogenicityFilterSchema = z.object({
  variants: liveVariantsSchema,
  threshold: z
    .number()
    .min(0, 'threshold is an absolute quantile between 0 and 1')
    .max(1, 'threshold is an absolute quantile between 0 and 1')
    .optional(),
  source: sourceSchema,
  scorers: scorersSchema,
});

// ============================================================================
// Live-inference tools
// ============================================================================

export const singleVariantSchema = z
  .object({ ...variantShape, tissue_type: tissueSchema })
  .refine(differentAlleles.check, differentAlleles.message);

export const tissueSpecificSchema = z
  .object({ ...variantShape, tissues: z.array(z.string().min(1)).max(10).optional() })
  .refine(differentAlleles.check, differentAlleles.message);

export const compareVariantsSchema = z.object({ variant1: variantSchema, variant2: variantSchema });

export const compareProtectiveRiskSchema = z.object({
  protective_variant: variantSchema,
  risk_variant: variantSchema,
});

export const compareAllelesSchema = z.object({
  chromosome: chromosomeSchema,
  position: positiveIntSchema,
  ref: nucleotideSchema,
  alts: z.array(nucleotideSchema).min(1, 'At least one alternate allele is required').max(20),
});

export const gwasLocusSchema = z.object({
  variants: liveVariantsSchema,
  chromosome: z.string().optional(),
  start: z.number().optional(),
  end: z.number().optional(),
});

export const sameGeneSchema = z.object({
  variants: liveVariantsSchema,
  gene_name: z.string().min(1).optional(),
});

export const modalityScreenSchema = z.object({
  variants: liveVariantsSchema,
  modality: z.enum(['expression', 'splicing', 'tf_binding', 'chromatin']),
});

export const batchTissueSchema = z.object({
  variants: liveVariantsSchema,
  tissues: z.array(z.string().min(1)).min(1, 'At least one tissue is required').max(10),
});

// ============================================================================
// AlphaGenome Atlas Validation
// ============================================================================

/** Most variants one atlas_lookup_variants call accepts. */
export const ATLAS_MAX_VARIANTS = 500;

/** Widest region atlas_scan_region accepts without being asked twice, in base pairs. */
export const ATLAS_MAX_REGION_BP = 10000;

/** Widest region atlas_scan_region accepts with allow_large_region, in base pairs. */
export const ATLAS_MAX_LARGE_REGION_BP = 50000;

/** Ranked rows returned by an Atlas tool unless the caller asks otherwise. */
export const ATLAS_DEFAULT_TOP_N = 25;

/** Most ranked rows an Atlas tool returns, whatever the caller asks for. */
export const ATLAS_MAX_TOP_N = 100;

const topNSchema = z
  .number()
  .int()
  .min(1)
  .max(ATLAS_MAX_TOP_N, `top_n must be at most ${ATLAS_MAX_TOP_N}`)
  .optional()
  .default(ATLAS_DEFAULT_TOP_N);

// The Atlas holds single-nucleotide substitutions only.
const singleBaseSchema = z
  .string()
  .regex(
    /^[ATGCatgc]$/,
    'The Atlas covers single-nucleotide substitutions only (one of A, C, G, T)'
  )
  .transform((s) => s.toUpperCase());

const atlasVariantShape = {
  chromosome: chromosomeSchema,
  position: positiveIntSchema,
  ref: singleBaseSchema,
  alt: singleBaseSchema,
};

export const atlasLookupVariantSchema = z
  .object({
    ...atlasVariantShape,
    scorers: scorersSchema,
    top_n: topNSchema,
  })
  .refine(differentAlleles.check, differentAlleles.message);

export const atlasLookupVariantsSchema = z.object({
  variants: z
    .array(
      z
        .object({ ...atlasVariantShape, variant_id: z.string().optional() })
        .refine(differentAlleles.check, differentAlleles.message)
    )
    .min(1, 'At least one variant is required')
    .max(ATLAS_MAX_VARIANTS, `Maximum ${ATLAS_MAX_VARIANTS} variants per call`),
  scorers: scorersSchema,
  top_n: topNSchema,
});

const bp = (value: number) => value.toLocaleString('en-US');

export const atlasScanRegionSchema = z
  .object({
    chromosome: chromosomeSchema,
    start: positiveIntSchema,
    end: positiveIntSchema,
    allow_large_region: z.boolean().optional().default(false),
    scorers: scorersSchema,
    top_n: topNSchema,
  })
  .refine((data) => data.end > data.start, {
    message: 'End position must be greater than start position',
  })
  .refine((data) => data.end - data.start <= ATLAS_MAX_LARGE_REGION_BP, {
    message: `Region must be at most ${bp(ATLAS_MAX_LARGE_REGION_BP)} bp. Scan it in pieces.`,
  })
  .refine((data) => data.allow_large_region || data.end - data.start <= ATLAS_MAX_REGION_BP, {
    message:
      `Region must be at most ${bp(ATLAS_MAX_REGION_BP)} bp. A scan is one API request per 32 bp under a ` +
      `requests-per-minute quota, so a larger scan can take minutes and may come back incomplete. ` +
      `Pass allow_large_region=true to scan up to ${bp(ATLAS_MAX_LARGE_REGION_BP)} bp, or scan the region in pieces.`,
  });

// ============================================================================
// Validation Helper Function
// ============================================================================

/**
 * Validate input data against a Zod schema
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns Validated and typed data
 * @throws ValidationError with detailed error messages
 */
export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map((e) => {
        const path = e.path.length > 0 ? `${e.path.join('.')}: ` : '';
        return `${path}${e.message}`;
      });
      throw new Error(`Validation error:\n${messages.join('\n')}`);
    }
    throw error;
  }
}

/**
 * Safe validation that returns result object instead of throwing
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns Object with success flag and either data or error
 */
export function safeValidateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: string } {
  try {
    const validated = schema.parse(data);
    return { success: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map((e) => {
        const path = e.path.length > 0 ? `${e.path.join('.')}: ` : '';
        return `${path}${e.message}`;
      });
      return { success: false, error: messages.join('\n') };
    }
    return { success: false, error: 'Unknown validation error' };
  }
}
