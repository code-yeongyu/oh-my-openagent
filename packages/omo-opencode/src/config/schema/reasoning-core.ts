import { z } from "zod"
import { CertaintySplitConfigSchema } from "./certainty-split"
import { EpistemicGateModeSchema, PreferenceWeightsSchema } from "./epistemic-gate"
import { EpistemicThresholdsSchema } from "./epistemic-thresholds"
import { ConfidenceWeightsSchema, DominanceThresholdSchema, InconclusiveThresholdsSchema } from "./epistemic-v5"
import {
  EthicalValueHierarchySchema,
  MoralContextDefaultsSchema,
  PlausibilitaThresholdSchema,
  PragmaticWeightsSchema,
  TransitionThresholdsSchema,
} from "./epistemic-v6"

export const InfrastructureFailModeSchema = z
  .enum(["open", "closed"])
  .describe(
    "How policy gates behave when reasoning-core is unavailable, errors, or times out. 'open' (default, backward-compatible) allows the action with a log warning. 'closed' blocks the action with a structured rationale - use when logic-first guarantees must hold even under partial outage. Applies to generic policy gate, epistemic interlock challenge, and Prometheus plan-write gate.",
  )

export const ReasoningCoreConfigSchema = z.object({
  metacognition_enabled: z.boolean().default(true),
  obligation_ledger_enabled: z.boolean().default(true),
  epistemic_interlock_enabled: z.boolean().default(true),
  epistemic_state_interpreter_enabled: z.boolean().default(true),
  infrastructure_fail_mode: InfrastructureFailModeSchema.default("open"),
  catastrophic_block_enabled: z
    .boolean()
    .default(false)
    .describe(
      "When true, the consequence-lifting-sidecar emits a catastrophic_blocked verdict for any decision whose proof chain reaches a catastrophic classification. Default false for safe rollout. The catastrophicGated scoring signal at policy-composer, dominance-comparator-v2, and recourse-classifier continues to be emitted regardless of this flag.",
    ),
  epistemic_thresholds: EpistemicThresholdsSchema.optional(),
  epistemic_gate_mode: EpistemicGateModeSchema.optional(),
  preference_weights: PreferenceWeightsSchema.optional(),
  confidence_weights: ConfidenceWeightsSchema.optional(),
  dominance_confidence_threshold: DominanceThresholdSchema.optional(),
  inconclusive_thresholds: InconclusiveThresholdsSchema.optional(),
  plausibilita_threshold: PlausibilitaThresholdSchema.optional(),
  ethical_value_hierarchy: EthicalValueHierarchySchema.optional(),
  pragmatic_weights: PragmaticWeightsSchema.optional(),
  moral_context_defaults: MoralContextDefaultsSchema.optional(),
  transition_thresholds: TransitionThresholdsSchema.optional(),
  certainty_split: CertaintySplitConfigSchema.optional(),
})

export type ReasoningCoreConfig = z.infer<typeof ReasoningCoreConfigSchema>
