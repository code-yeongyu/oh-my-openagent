import { z } from "zod";

export const AuthorityTier = z.enum([
  "tier-1-ground-truth",
  "tier-2-validated-reference",
  "tier-3-battle-tested",
  "tier-4-community",
]);

export const ProvenanceSchema = z.object({
  ref: z.string().min(1),
  claim: z.string().min(1),
  tier: AuthorityTier,
  confidence: z.number().min(0).max(1),
  type: z.enum(["textbook", "paper", "spec", "oss", "docs", "blog"]),
  isbn: z.string().optional(),
  url: z.string().url().optional(),
  verified_by: z.string().optional(),
});

export const SolutionSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  spec_compliant: z.boolean().optional(),
  sources: z.array(ProvenanceSchema).min(1),
  constraints: z.record(z.string(), z.unknown()).optional(),
});

export const TaxonomyEntrySchema = z.object({
  category: z.string().min(1),
  solutions: z.array(SolutionSchema).min(1),
  pitfalls: z
    .array(
      z.object({
        trigger: z.string(),
        source: ProvenanceSchema,
      })
    )
    .optional(),
  complexity: z.string().optional(),
  related: z.array(z.string()),
  implementation_notes: z.array(z.string()).optional(),
});

export type AuthorityTierType = z.infer<typeof AuthorityTier>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type Solution = z.infer<typeof SolutionSchema>;
export type TaxonomyEntry = z.infer<typeof TaxonomyEntrySchema>;
