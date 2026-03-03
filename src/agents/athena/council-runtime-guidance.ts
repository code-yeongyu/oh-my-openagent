import {
  DIAGNOSE_GUIDANCE,
  AUDIT_GUIDANCE,
  PLAN_GUIDANCE,
  EVALUATE_GUIDANCE,
  EXPLAIN_GUIDANCE,
  CREATE_GUIDANCE,
  PERSPECTIVES_GUIDANCE,
  FREEFORM_GUIDANCE,
} from "./guidance"

const VALID_INTENTS = [
  "DIAGNOSE",
  "AUDIT",
  "PLAN",
  "EVALUATE",
  "EXPLAIN",
  "CREATE",
  "PERSPECTIVES",
  "FREEFORM",
] as const

export type CouncilIntent = (typeof VALID_INTENTS)[number]

const RUNTIME_GUIDANCE_BY_INTENT: Record<CouncilIntent, string> = {
  // Delegation agent design rationale:
  // - DIAGNOSE = single targeted fix → Hephaestus (direct implementation) / Sisyphus (orchestrated implementation)
  // - AUDIT = multi-finding remediation → Atlas (todo-list orchestration) / Prometheus (phased planning)
  // Other intents (PLAN, EVALUATE, EXPLAIN, CREATE, PERSPECTIVES, FREEFORM) are INFORMATIONAL
  // and offer context-appropriate delegation options in their action paths.
  DIAGNOSE: DIAGNOSE_GUIDANCE,
  AUDIT: AUDIT_GUIDANCE,
  PLAN: PLAN_GUIDANCE,
  EVALUATE: EVALUATE_GUIDANCE,
  EXPLAIN: EXPLAIN_GUIDANCE,
  CREATE: CREATE_GUIDANCE,
  PERSPECTIVES: PERSPECTIVES_GUIDANCE,
  FREEFORM: FREEFORM_GUIDANCE,
}

export function getValidCouncilIntents(): readonly CouncilIntent[] {
  return VALID_INTENTS
}

export function resolveCouncilIntent(intent?: string): CouncilIntent | null {
  if (!intent) return null
  const normalized = intent.trim().toUpperCase()
  return (VALID_INTENTS as readonly string[]).includes(normalized)
    ? (normalized as CouncilIntent)
    : null
}

export type CouncilGuidanceMode = "interactive" | "non-interactive"

export function buildAthenaRuntimeGuidance(intent: CouncilIntent, mode: CouncilGuidanceMode = "interactive"): string {
  let guidanceContent = RUNTIME_GUIDANCE_BY_INTENT[intent].trim()

  if (mode === "non-interactive") {
    guidanceContent = stripActionPaths(guidanceContent)
  }

  return [
    "<athena_runtime_guidance>",
    "source: council_finalize",
    `intent: ${intent}`,
    `mode: ${mode}`,
    guidanceContent,
    "</athena_runtime_guidance>",
  ].join("\n\n")
}

function stripActionPaths(guidance: string): string {
  return guidance.replace(/<runtime_action_paths>[\s\S]*?<\/runtime_action_paths>/g, "").trim()
}
