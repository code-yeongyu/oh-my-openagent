// allow: SIZE_OK - one TypeBox data table for the toolkit tool's argument surface; every line is a
// field declaration with the prose the model reads, and splitting it would scatter one contract.
import { Type, type Static } from "typebox"

export const AGENT_TOOLKIT_OPERATIONS = [
  "help",
  "create-goals",
  "status",
  "complete-goals",
  "checkpoint",
  "steer",
  "add-goal",
  "criteria",
  "record-evidence",
  "record-review-blockers",
] as const

export const AgentToolkitToolParams = Type.Object({
  operation: Type.Union(
    [
      Type.Literal("help"),
      Type.Literal("create-goals"),
      Type.Literal("status"),
      Type.Literal("complete-goals"),
      Type.Literal("checkpoint"),
      Type.Literal("steer"),
      Type.Literal("add-goal"),
      Type.Literal("criteria"),
      Type.Literal("record-evidence"),
      Type.Literal("record-review-blockers"),
    ],
    {
      description:
        "help lists the manifest; status reads this session's plan; create-goals seeds it; complete-goals ACQUIRES the next pending goal; criteria lists a goal's criteria; record-evidence marks one criterion; checkpoint closes a goal or prints its quality-gate template; steer proposes a plan mutation; add-goal appends one; record-review-blockers records final-review blockers.",
    },
  ),
  brief: Type.Optional(Type.String({ description: "create-goals only: the plan brief text, inline. One line per goal." })),
  goalId: Type.Optional(Type.String({ description: "Goal id for criteria, record-evidence, checkpoint, and record-review-blockers." })),
  criterionId: Type.Optional(Type.String({ description: "record-evidence only: the criterion id within the goal." })),
  status: Type.Optional(
    Type.String({
      description:
        "record-evidence: pass, fail, or blocked. checkpoint: complete, failed, or blocked. Ignored by every other operation.",
    }),
  ),
  evidence: Type.Optional(Type.String({ description: "Observable proof recorded with record-evidence, checkpoint, steer, or record-review-blockers." })),
  notes: Type.Optional(Type.String({ description: "record-evidence only: optional annotation stored beside the captured evidence." })),
  title: Type.Optional(Type.String({ description: "add-goal and record-review-blockers: short goal title." })),
  objective: Type.Optional(Type.String({ description: "add-goal and record-review-blockers: the goal objective." })),
  rationale: Type.Optional(Type.String({ description: "steer only: why this mutation is necessary." })),
  kind: Type.Optional(Type.String({ description: "steer only: the mutation kind, for example annotate_ledger or revise_criterion." })),
  criterionScenario: Type.Optional(Type.String({ description: "steer revise_criterion: replacement scenario text." })),
  criterionExpectedEvidence: Type.Optional(Type.String({ description: "steer revise_criterion: replacement expected-evidence text." })),
  printTemplate: Type.Optional(Type.Boolean({ description: "checkpoint only: return the quality-gate template for this goal instead of closing it." })),
  retryFailed: Type.Optional(Type.Boolean({ description: "complete-goals only: also re-acquire goals that previously failed." })),
  codexGoal: Type.Optional(
    Type.Unknown({
      description:
        "Optional driver snapshot recorded verbatim. On omo-senpi it is filled from this session's goal store when omitted, so agents never paste one. Inline value only, never a path.",
    }),
  ),
  qualityGate: Type.Optional(
    Type.Unknown({ description: "checkpoint only: the filled quality-gate object for a final checkpoint. Inline value only, never a path." }),
  ),
})

export type AgentToolkitToolInput = Static<typeof AgentToolkitToolParams>
