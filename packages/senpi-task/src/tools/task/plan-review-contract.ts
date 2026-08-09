import { EMPTY_SKILL_INVOCATIONS, interactionPolicyForAgent } from "../../agents"
import type { PlanArtifactReference, SkillInvocationState } from "../../agents"

import type { TaskToolDeps } from "./types"

// The plan-review prompt contract for one-shot review agents (momus): whatever the caller asked,
// the child receives EXACTLY one canonical sentence carrying one .omo/plans/*.md path - no claims,
// no emphasis, no skill prepends. Target precedence: an explicit single path in the caller prompt
// wins; otherwise the session's most-referenced plan artifact (count desc, recency tie-break);
// otherwise the spawn is denied. The deny branch is defensive: through the real tool path the
// plan gate (requiresPlanArtifact) fires first, so a passing session always has references.

const PLAN_PATH_GLOBAL = /[^\s"'`()\[\]]*\.omo[\\/]plans[\\/][^\s"'`()\[\]/\\]+\.md/gi

export const PLAN_REVIEW_DENY_MESSAGE =
  "momus requires exactly one .omo/plans/*.md path: include the plan path in the prompt, or touch the plan file in this session first."

export function extractPlanPaths(text: string): readonly string[] {
  const seen = new Set<string>()
  const paths: string[] = []
  for (const match of text.matchAll(PLAN_PATH_GLOBAL)) {
    const normalized = match[0].replace(/\\/g, "/")
    if (seen.has(normalized)) continue
    seen.add(normalized)
    paths.push(normalized)
  }
  return paths
}

export type PlanReviewTarget = { readonly kind: "path"; readonly path: string } | { readonly kind: "deny"; readonly message: string }

export function resolvePlanReviewTarget(callerPrompt: string, state: SkillInvocationState): PlanReviewTarget {
  const references = state.planArtifactReferences()
  const explicit = extractPlanPaths(callerPrompt)
  if (explicit.length === 1) {
    const only = explicit[0]
    const recorded = only !== undefined ? matchRecordedReference(only, references) : undefined
    if (recorded !== undefined) return { kind: "path", path: recorded.path }
  }
  const mostReferenced = topReference(references)
  if (mostReferenced !== undefined) return { kind: "path", path: mostReferenced.path }
  return { kind: "deny", message: PLAN_REVIEW_DENY_MESSAGE }
}

// An explicit caller path is a SELECTOR over session-recorded references, never a value that
// reaches the child: the prompt is built from the RECORDED path, so caller-controlled prefixes,
// absolute paths, and `..` segments cannot be interpolated into the momus prompt. Identity is the
// normalized `.omo/plans/<name>.md` suffix, which keeps worktree-rooted recordings matchable.
function matchRecordedReference(candidate: string, references: readonly PlanArtifactReference[]): PlanArtifactReference | undefined {
  const wanted = planSuffix(candidate)
  if (wanted === undefined) return undefined
  return references.find((reference) => planSuffix(reference.path) === wanted)
}

function planSuffix(path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/")
  const marker = ".omo/plans/"
  const index = normalized.indexOf(marker)
  return index === -1 ? undefined : normalized.slice(index)
}

export function buildPlanReviewPrompt(path: string): string {
  return `Review the work plan at ${path} for contradictions and blocking issues.`
}

export type PlanReviewContractOutcome =
  | { readonly kind: "prompt"; readonly prompt: string }
  | { readonly kind: "deny"; readonly message: string }

// Tool-layer bridge mirroring invocation-gate.ts: returns undefined when the target agent carries
// no plan-review contract (passthrough), otherwise the forced prompt or the denial. A missing
// resolver fails CLOSED into EMPTY_SKILL_INVOCATIONS, which yields the deny branch for contract
// agents - consistent with the gate's closed default.
export function planReviewContractOutcome(
  deps: TaskToolDeps,
  subagentType: string,
  callerPrompt: string,
  sessionId: string,
): PlanReviewContractOutcome | undefined {
  if (interactionPolicyForAgent(subagentType)?.promptContract !== "plan-review") return undefined
  const state = deps.resolveSkillInvocations?.(sessionId) ?? EMPTY_SKILL_INVOCATIONS
  const target = resolvePlanReviewTarget(callerPrompt, state)
  if (target.kind === "deny") return { kind: "deny", message: target.message }
  return { kind: "prompt", prompt: buildPlanReviewPrompt(target.path) }
}

function topReference(references: readonly PlanArtifactReference[]): PlanArtifactReference | undefined {
  let top: PlanArtifactReference | undefined
  for (const reference of references) {
    if (top === undefined || reference.count > top.count || (reference.count === top.count && reference.lastTouchedAt > top.lastTouchedAt)) {
      top = reference
    }
  }
  return top
}
