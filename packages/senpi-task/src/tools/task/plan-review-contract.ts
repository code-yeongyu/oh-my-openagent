import { realpathSync, statSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"

import { EMPTY_SKILL_INVOCATIONS, interactionPolicyForAgent } from "../../agents"
import type { PlanArtifactReference, SkillInvocationState } from "../../agents"

import type { TaskToolDeps } from "./types"

// The plan-review prompt contract for one-shot review agents (plan-reviewer): whatever the caller asked,
// the child receives EXACTLY one canonical sentence carrying one .omo/plans/*.md path - no claims,
// no emphasis, no skill prepends. Target precedence (#10837):
// - one explicit path in the caller prompt is the target, whether or not the session touched it.
//   It must be a plan the session recorded, or an existing file directly inside the project's
//   .omo/plans; anything else is DENIED - an explicit path is never swapped for another plan.
// - more than one explicit path is denied: the contract reviews exactly one plan.
// - no explicit path falls back to the session's most-referenced plan artifact (count desc,
//   recency tie-break); with no recorded plan either, the spawn is denied.

const PLAN_PATH_GLOBAL = /[^\s"'`()\[\]]*\.omo[\\/]plans[\\/][^\s"'`()\[\]/\\]+\.md/gi

export const PLAN_REVIEW_DENY_MESSAGE =
  "plan-reviewer requires exactly one .omo/plans/*.md path: include the plan path in the prompt, or touch the plan file in this session first."

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

export function resolvePlanReviewTarget(callerPrompt: string, state: SkillInvocationState, cwd: string): PlanReviewTarget {
  const references = state.planArtifactReferences()
  const explicit = extractPlanPaths(callerPrompt)
  if (explicit.length > 1) {
    return {
      kind: "deny",
      message: `plan-reviewer reviews exactly one plan, but the prompt names ${explicit.length}: ${explicit.join(", ")}. Pass a single .omo/plans/*.md path.`,
    }
  }
  const only = explicit[0]
  if (only !== undefined) return resolveExplicitPlan(only, references, cwd)
  const mostReferenced = topReference(references)
  if (mostReferenced !== undefined) return { kind: "path", path: mostReferenced.path }
  return { kind: "deny", message: PLAN_REVIEW_DENY_MESSAGE }
}

// The caller's token never reaches the child verbatim: the prompt carries either the RECORDED path
// of a plan this session touched (worktree plans included) that resolves to the same file, or the
// canonical real path of an existing file whose parent is the project's real .omo/plans directory.
// Caller prefixes, `..` segments, symlink escapes, and paths outside the project are refused.
function resolveExplicitPlan(candidate: string, references: readonly PlanArtifactReference[], cwd: string): PlanReviewTarget {
  const wanted = resolve(cwd, candidate)
  const wantedReal = realPath(wanted)
  const recorded = references.find((reference) => {
    const recordedPath = resolve(cwd, reference.path)
    return recordedPath === wanted || (wantedReal !== undefined && realPath(recordedPath) === wantedReal)
  })
  if (recorded !== undefined) return { kind: "path", path: recorded.path }
  const projectPlans = realPath(resolve(cwd, ".omo", "plans"))
  if (wantedReal !== undefined && projectPlans !== undefined && dirname(wantedReal) === projectPlans && isFile(wantedReal)) {
    return { kind: "path", path: wantedReal }
  }
  const shown = isAbsolute(candidate) ? candidate : `${candidate} (resolved against ${cwd})`
  return {
    kind: "deny",
    message:
      `plan-reviewer cannot review ${shown}: it is not an existing plan file directly inside this project's .omo/plans ` +
      `directory and no plan touched in this session resolves to it. Pass the path of an existing plan.`,
  }
}

function realPath(path: string): string | undefined {
  try {
    return realpathSync.native(path)
  } catch {
    return undefined
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
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
  cwd: string,
): PlanReviewContractOutcome | undefined {
  if (interactionPolicyForAgent(subagentType)?.promptContract !== "plan-review") return undefined
  const state = deps.resolveSkillInvocations?.(sessionId) ?? EMPTY_SKILL_INVOCATIONS
  const target = resolvePlanReviewTarget(callerPrompt, state, cwd)
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
