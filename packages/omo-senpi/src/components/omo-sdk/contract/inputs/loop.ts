import { Type } from "typebox"

// The delegated loop's operations (first-party design 6.11) and their one session binding (security design 4.4). The
// fields are the loop manifest's own shapes; `session_id` names the loop session a person or a script binds. A session
// principal is bound only to its own, with the id from the engine, never from this field.
const Str = Type.String()
const Optional = Type.Optional
const SessionId = Optional(Type.String({ minLength: 1 }))
const UserModel = Type.Enum(["happy", "edge", "regression", "adversarial"])

export const ToolkitForSession = Type.Object({ cwd: Type.String({ minLength: 1 }), session_id: SessionId })

export const ToolkitAddGoal = Type.Object({
  title: Str,
  objective: Str,
  successCriteria: Optional(
    Type.Array(
      Type.Object({
        scenario: Str,
        expectedEvidence: Str,
        userModel: Optional(UserModel),
        essential: Optional(Type.Boolean()),
      }),
    ),
  ),
  session_id: SessionId,
})

export const ToolkitCheckpoint = Type.Object({
  goalId: Str,
  status: Type.Enum(["complete", "failed", "blocked"]),
  evidence: Str,
  codexGoalJson: Optional(Str),
  qualityGateJson: Optional(Str),
  printTemplate: Optional(Type.Unsafe<true>({ enum: [true] })),
  advance: Optional(Type.Boolean()),
  session_id: SessionId,
})

export const ToolkitCompleteGoals = Type.Object({ retryFailed: Optional(Type.Boolean()), session_id: SessionId })

export const ToolkitCreateGoals = Type.Object({
  brief: Str,
  codexGoalMode: Optional(Type.Enum(["aggregate", "per_story"])),
  force: Optional(Type.Boolean()),
  validationBatchesJson: Optional(Str),
  session_id: SessionId,
})

export const ToolkitCriteria = Type.Object({ goalId: Str, session_id: SessionId })

export const ToolkitRecordEvidence = Type.Object({
  goalId: Str,
  criterionId: Str,
  status: Type.Enum(["pass", "fail", "blocked"]),
  evidence: Str,
  notes: Optional(Str),
  artifacts: Optional(Type.Array(Str)),
  session_id: SessionId,
})

export const ToolkitRecordReviewBlockers = Type.Object({
  goalId: Str,
  title: Str,
  objective: Str,
  evidence: Str,
  codexGoalJson: Optional(Str),
  session_id: SessionId,
})

export const ToolkitStatus = Type.Object({ session_id: SessionId })

export const ToolkitSteer = Type.Object({
  kind: Type.Enum([
    "add_subgoal",
    "split_subgoal",
    "reorder_pending",
    "revise_pending_wording",
    "revise_criterion",
    "annotate_ledger",
    "mark_blocked_superseded",
  ]),
  source: Type.Enum(["finding", "user_prompt_submit", "cli"]),
  evidence: Str,
  rationale: Str,
  goalId: Optional(Str),
  criterionId: Optional(Str),
  scenario: Optional(Str),
  expectedEvidence: Optional(Str),
  userModel: Optional(UserModel),
  title: Optional(Str),
  objective: Optional(Str),
  childGoals: Optional(Type.Array(Type.Object({ title: Str, objective: Str }))),
  revisedTitle: Optional(Str),
  revisedObjective: Optional(Str),
  pendingOrder: Optional(Type.Array(Str)),
  blockedReason: Optional(Str),
  idempotencyKey: Optional(Str),
  proposals: Optional(Type.Unknown()),
  session_id: SessionId,
})
