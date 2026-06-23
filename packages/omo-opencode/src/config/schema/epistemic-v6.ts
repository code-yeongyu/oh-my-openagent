import { z } from "zod"

export const PlausibilitaThresholdSchema = z.number().min(0).max(1).default(0.5)

export const EthicalValueHierarchySchema = z.array(z.string()).default([
  "vita_umana",
  "benessere_collettivo",
  "integrita_personale",
  "autonomia",
  "trasparenza",
  "convenienza",
])

export const PragmaticWeightsSchema = z
  .object({
    peso_proprio: z.number().min(0).max(1).default(0.65),
    peso_controparte: z.number().min(0).max(1).default(0.35),
  })
  .default({ peso_proprio: 0.65, peso_controparte: 0.35 })
  .refine((data) => Math.abs(data.peso_proprio + data.peso_controparte - 1.0) < 0.001, {
    message: "pragmatic weights must sum to 1.0",
  })

export const MoralContextDefaultsSchema = z.object({
  default_audience: z.enum(["expert", "general", "vulnerable"]).default("general"),
  require_audience_model: z.boolean().default(false),
}).default({ default_audience: "general", require_audience_model: false })

export const TransitionThresholdsSchema = z.object({
  advancement_min_strength: z.number().min(1).max(3).default(1),
  retrocession_min_strength: z.number().min(1).max(3).default(2),
  expulsion_min_strength: z.number().min(1).max(3).default(3),
  reopening_min_strength: z.number().min(1).max(3).default(2),
}).default({
  advancement_min_strength: 1,
  retrocession_min_strength: 2,
  expulsion_min_strength: 3,
  reopening_min_strength: 2,
})

const ProofStrengthByKindSchema = z.object({
  strict: z.number().min(0).max(1).default(1),
  mixed: z.number().min(0).max(1).default(0.7),
  defeasible: z.number().min(0).max(1).default(0.5),
  unknown: z.number().min(0).max(1).default(0.3),
}).default({ strict: 1, mixed: 0.7, defeasible: 0.5, unknown: 0.3 })

export const EthicalEvaluatorTuningSchema = z.object({
  proof_strength_by_kind: ProofStrengthByKindSchema,
  legal_tag_prefixes: z.array(z.string()).default(["legal:", "regulatory:", "compliance:"]),
  ethical_tag_prefixes: z.array(z.string()).default(["ethics:", "value:"]),
  legal_alignment_base: z.number().min(0).max(1).default(0.3),
  legal_alignment_floor: z.number().min(0).max(1).default(0.5),
  legal_alignment_per_tag: z.number().min(0).max(1).default(0.15),
  empathy_benefit_multiplier: z.number().min(0).max(1).default(0.8),
  override_higher_value_threshold: z.number().min(0).max(1).default(0.7),
  override_legal_threshold: z.number().min(0).max(1).default(0.5),
  override_empathy_cost_ratio: z.number().min(0).default(1.5),
  default_score_weights: z.object({
    legal: z.number().min(0).max(1).default(0.5),
    validity: z.number().min(0).max(1).default(0.3),
    empathy: z.number().min(0).max(1).default(0.2),
  }).default({ legal: 0.5, validity: 0.3, empathy: 0.2 }),
  override_score_weights: z.object({
    empathy: z.number().min(0).max(1).default(0.4),
    magnitude: z.number().min(0).max(1).default(0.3),
    validity: z.number().min(0).max(1).default(0.3),
  }).default({ empathy: 0.4, magnitude: 0.3, validity: 0.3 }),
  label_lecito_threshold: z.number().min(0).max(1).default(0.5),
})

export const PragmaticEvaluatorTuningSchema = z.object({
  proof_strength_by_kind: ProofStrengthByKindSchema,
  competition_factor_decay: z.number().min(0).max(1).default(0.2),
  attack_allowance_with_attackers: z.number().min(0).max(1).default(0.7),
  attack_allowance_no_attackers: z.number().min(0).max(1).default(1),
  beneficio_proprio_weights: z.object({
    proof: z.number().min(0).max(1).default(0.4),
    extension: z.number().min(0).max(1).default(0.4),
    attack_allowance: z.number().min(0).max(1).default(0.2),
  }).default({ proof: 0.4, extension: 0.4, attack_allowance: 0.2 }),
  beneficio_controparte_weights: z.object({
    extension: z.number().min(0).max(1).default(0.6),
    competition: z.number().min(0).max(1).default(0.4),
  }).default({ extension: 0.6, competition: 0.4 }),
  cost_subtraction_factor: z.number().min(0).max(1).default(0.5),
  label_conveniente_threshold: z.number().min(0).max(1).default(0.6),
  label_sconveniente_threshold: z.number().min(0).max(1).default(0.4),
})

export const MoralEvaluatorTuningSchema = z.object({
  comprehension_by_audience: z.object({
    expert: z.number().min(0).max(1).default(0.9),
    general: z.number().min(0).max(1).default(0.5),
    vulnerable: z.number().min(0).max(1).default(0.2),
  }).default({ expert: 0.9, general: 0.5, vulnerable: 0.2 }),
  action_impact: z.record(z.string(), z.number().min(0).max(1)).default({
    allow: 0.7,
    approve: 0.7,
    ban: 0.3,
    block: 0.3,
    deny: 0.3,
    permit: 0.7,
    restrict: 0.5,
  }),
  moral_trigger_prefixes: z.array(z.string()).default([
    "safety:", "protection:", "care:", "commercial:", "self-interest:", "deceptive:",
  ]),
  protection_prefixes: z.array(z.string()).default(["safety:", "protection:", "care:"]),
  exploitation_prefixes: z.array(z.string()).default(["commercial:", "self-interest:", "deceptive:"]),
  intention_score: z.object({
    benevola: z.number().min(0).max(1).default(0.8),
    malevola: z.number().min(0).max(1).default(0.2),
    neutra: z.number().min(0).max(1).default(0.5),
  }).default({ benevola: 0.8, malevola: 0.2, neutra: 0.5 }),
  transparency_present: z.number().min(0).max(1).default(0.8),
  transparency_absent: z.number().min(0).max(1).default(0.3),
  transparency_weight_by_audience: z.object({
    expert: z.number().min(0).max(1).default(0.15),
    general: z.number().min(0).max(1).default(0.25),
    vulnerable: z.number().min(0).max(1).default(0.35),
  }).default({ expert: 0.15, general: 0.25, vulnerable: 0.35 }),
  default_action_impact: z.number().min(0).max(1).default(0.5),
  contestedness_decay: z.number().min(0).max(1).default(0.2),
  impatto_cascata_contestedness_weight: z.number().min(0).max(1).default(0.3),
  fiducia_weights: z.object({
    intention: z.number().min(0).max(1).default(0.4),
    transparency: z.number().min(0).max(1).default(0.3),
    comprehension: z.number().min(0).max(1).default(0.3),
    contestedness_penalty: z.number().min(0).max(1).default(0.1),
  }).default({ intention: 0.4, transparency: 0.3, comprehension: 0.3, contestedness_penalty: 0.1 }),
  score_weights: z.object({
    intention: z.number().min(0).max(1).default(0.3),
    transparency: z.number().min(0).max(1).default(0.2),
    comprehension: z.number().min(0).max(1).default(0.2),
    impatto_inverse: z.number().min(0).max(1).default(0.15),
    fiducia: z.number().min(0).max(1).default(0.15),
  }).default({ intention: 0.3, transparency: 0.2, comprehension: 0.2, impatto_inverse: 0.15, fiducia: 0.15 }),
  label_giustificabile_threshold: z.number().min(0).max(1).default(0.6),
  label_problematica_threshold: z.number().min(0).max(1).default(0.4),
})

export type PlausibilitaThreshold = z.infer<typeof PlausibilitaThresholdSchema>
export type EthicalValueHierarchy = z.infer<typeof EthicalValueHierarchySchema>
export type PragmaticWeights = z.infer<typeof PragmaticWeightsSchema>
export type MoralContextDefaults = z.infer<typeof MoralContextDefaultsSchema>
export type TransitionThresholds = z.infer<typeof TransitionThresholdsSchema>
export type EthicalEvaluatorTuning = z.infer<typeof EthicalEvaluatorTuningSchema>
export type PragmaticEvaluatorTuning = z.infer<typeof PragmaticEvaluatorTuningSchema>
export type MoralEvaluatorTuning = z.infer<typeof MoralEvaluatorTuningSchema>
