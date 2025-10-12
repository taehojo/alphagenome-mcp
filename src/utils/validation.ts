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

// ============================================================================
// Variant Prediction Validation
// ============================================================================

export const variantPredictionSchema = z
  .object({
    chromosome: chromosomeSchema,
    position: positiveIntSchema,
    ref: nucleotideSchema,
    alt: nucleotideSchema,
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
    tissue_type: z.string().optional(),
  })
  .refine((data) => data.ref !== data.alt, {
    message: 'Reference and alternate alleles must be different',
  });

// ============================================================================
// Region Analysis Validation
// ============================================================================

export const regionAnalysisSchema = z
  .object({
    chromosome: chromosomeSchema,
    start: positiveIntSchema,
    end: positiveIntSchema,
    analysis_types: z
      .array(z.enum(['promoter', 'enhancer', 'silencer', 'tf_binding', 'chromatin_state']))
      .optional(),
    resolution: z.enum(['base', 'window']).optional(),
  })
  .refine((data) => data.end > data.start, {
    message: 'End position must be greater than start position',
  })
  .refine((data) => data.end - data.start >= 1000, {
    message: 'Region must be at least 1kb (1,000 bp)',
  })
  .refine((data) => data.end - data.start <= 1000000, {
    message: 'Region must be at most 1Mb (1,000,000 bp)',
  });

// ============================================================================
// Batch Scoring Validation
// ============================================================================

export const batchScoreSchema = z.object({
  variants: z
    .array(
      z.object({
        chromosome: chromosomeSchema,
        position: positiveIntSchema,
        ref: nucleotideSchema,
        alt: nucleotideSchema,
        variant_id: z.string().optional(),
      })
    )
    .min(1, 'At least one variant is required')
    .max(100, 'Maximum 100 variants allowed'),
  scoring_metric: z.enum(['rna_seq', 'splice', 'regulatory_impact', 'combined']),
  top_n: z.number().int().min(1).max(100).optional().default(10),
  include_interpretation: z.boolean().optional().default(false),
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
