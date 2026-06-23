import { z } from "zod"

export const DeliberationRequestSchema = z.object({
  id: z.string(),
  timestamp: z.string(), // ISO-8601
  problem_statement: z.string(),
  options: z.array(z.string()),
  constraints: z.array(z.string()),
  preferences: z.array(z.object({
    superior: z.string(),
    inferior: z.string(),
  })),
  context: z.string().optional(),
  requested_semantics: z.enum(["grounded", "preferred", "stable", "complete"]),
})

export type DeliberationRequest = z.infer<typeof DeliberationRequestSchema>

// Proof chain entry from ASPIC+ output
const ProofChainEntrySchema = z.object({
  conclusion: z.string(),
  from: z.array(z.string()),
  rule_id: z.string().nullable(),
  rule_kind: z.string(),
})

// Selected policy bundle (null when verdict is no_selectable_bundle or failure)
const PolicyBundleSchema = z.object({
  selected_option: z.string(),
  burdens: z.array(z.string()).optional(),
  mitigations: z.array(z.string()).optional(),
  guardrails: z.array(z.string()).optional(),
}).nullable()

const DerivedTheoryPreferencesSchema = z.union([
  z.array(z.any()),
  z.object({
    pairwise: z.array(z.any()).optional(),
    groups: z.array(z.any()).optional(),
  }),
])

const StringRecordSchema = z.record(z.string(), z.string())
const NumberRecordSchema = z.record(z.string(), z.number())

const EpistemicAnalysisSchema = z.object({
  piano_a: StringRecordSchema.optional(),
  piano_b: NumberRecordSchema.optional(),
  piano_c: z.object({
    deontological: StringRecordSchema.optional(),
    consequentialist: StringRecordSchema.optional(),
    virtue_ethics: StringRecordSchema.optional(),
  }).optional(),
  piano_d: z.object({
    synthesis: z.string(),
    dominant_conclusion: z.string().optional(),
    confidence: z.number(),
  }).optional(),
})

const FormalizationProvenanceSchema = z.object({
  model_id: z.string(),
  model_version: z.string().optional(),
  prompt_version: z.string(),
  schema_version: z.number(),
  mode: z.enum(["permissive", "strict"]),
  cache_hit: z.boolean(),
  iterations_attempted: z.number(),
  error_code: z.enum([
    "provider_failure",
    "timeout",
    "schema_invalid",
    "theory_invalid",
    "confirmation_required",
  ]).optional(),
  derived_theory: z.object({
    premises: z.array(z.object({
      formula: z.string(),
      kind: z.string().optional(),
    })).min(1),
    strict_rules: z.array(z.any()).optional(),
    defeasible_rules: z.array(z.any()).optional(),
    preferences: DerivedTheoryPreferencesSchema.optional(),
    classical_negation: z.boolean().optional(),
  }).optional(),
})

const RationaleDetailSchema = z.object({
  verdict_mode: z.enum(["selected", "no_selectable_bundle", "defer_recommended"]),
  verdict_basis: z.string(),
  decisive_factors: z.array(z.string()),
  audience_signal: z.string().nullable(),
  semantics_signal: z.string().nullable(),
  risk_signal: z.string().nullable(),
  actionability_signal: z.string().nullable(),
})

const RuntimeProvenanceSchema = z.object({
  build_id: z.string(),
  build_timestamp: z.string(),
  latest_build_id: z.string().optional(),
  latest_build_timestamp: z.string().optional(),
  stale_runtime_detected: z.boolean().optional(),
})

export const DeliberationResponseSchema = z.object({
  // 6 REQUIRED core fields (MH-5)
  verdict: z.enum([
    "selected",
    "no_selectable_bundle",
    "multiple_extensions",
    "defer_recommended",
    "converged_after_revision",
    "unable_to_converge",
    "formalization_failed",
    "sidecar_internal_error",
    "catastrophic_blocked",
    "refused",
  ]),
  rationale: z.string(), // verbatim from sidecar; must NOT be softened
  rationale_detail: RationaleDetailSchema.optional(),
  runtime_provenance: RuntimeProvenanceSchema.optional(),
  proof_chain: z.array(ProofChainEntrySchema),
  sidecar_trace: z.unknown(), // audit-only: raw ASPIC+/extension/sidecar data
  provenance: z.object({
    semantics: z.string(),
    iterations: z.number(),
    timestamp: z.string(),
    input_request: DeliberationRequestSchema,
  }),
  bundle: PolicyBundleSchema,
  formalization: FormalizationProvenanceSchema.optional(),
  preference_cycle_detected: z.boolean().optional(),
  preference_cycle_path: z.array(z.string()).optional(),
  semantics_comparison: z.unknown().optional(),
  epistemic_analysis: EpistemicAnalysisSchema.optional(),
  audience_analysis: z.unknown().optional(),
  confidence: z.unknown().optional(),
  convergence: z.unknown().optional(),

  // Optional audit fields
  extensions: z.array(z.unknown()).optional(),
  catastrophic_risks: z.array(z.string()).optional(),
  undermined_premises: z.array(z.string()).optional(),
  revised_premises: z.array(z.string()).optional(),
  undercut_rules: z.array(z.string()).optional(),
  voi_analysis: z.unknown().optional(),
  repair_humility: z.string().optional(),
  error: z.string().nullable().optional(),
})

export type DeliberationResponse = z.infer<typeof DeliberationResponseSchema>
