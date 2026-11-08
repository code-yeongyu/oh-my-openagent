import { readFileSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"

import { EMPTY_SKILL_INVOCATIONS, interactionPolicyForAgent } from "../../agents"
import type { PlanArtifactReference, SkillInvocationState } from "../../agents"

import type { TaskToolDeps } from "./types"

// The plan-review prompt contract for one-shot review agents (plan-reviewer): whatever the caller asked,
// the child receives EXACTLY one canonical sentence carrying one .omo/plans/*.md path - no claims,
// no emphasis, no skill prepends. Target precedence: an explicit single path in the caller prompt
// wins; otherwise the session's most-referenced plan artifact (count desc, recency tie-break);
// otherwise the spawn is denied. The deny branch is defensive: through the real tool path the
// plan gate (requiresPlanArtifact) fires first, so a passing session always has references.

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
// absolute paths, and `..` segments cannot be interpolated into the plan-reviewer prompt. Identity is the
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

// #11329: the plan review ledger is a markdown section INSIDE the plan file - there is no ledger
// schema, no side store and no migration. Detection is a heading scan of the plan at spawn time,
// so a plan without the section keeps the byte-identical pre-ledger prompt below.
const REVIEW_LEDGER_HEADING = /^##[ \t]+Review ledger[ \t]*$/m

/**
 * Whether the plan file carries a `## Review ledger` section. Relative recorded paths resolve
 * against the caller's cwd first. An unreadable or missing plan fails OPEN to "no ledger", which
 * keeps the pre-ledger contract byte-identical (the child re-reads the plan from disk anyway).
 */
function planFileHasReviewLedger(path: string, cwd?: string): boolean {
  const candidates = isAbsolute(path) || cwd === undefined ? [path] : [resolve(cwd, path), path]
  for (const candidate of candidates) {
    let plan: string
    try {
      plan = readFileSync(candidate, "utf8")
    } catch {
      continue // missing or unreadable at this candidate: try the next, then no ledger
    }
    if (REVIEW_LEDGER_HEADING.test(plan)) return true
  }
  return false
}

/**
 * Appended ONLY when the plan actually carries a review ledger, so the no-ledger spawn stays
 * byte-identical to the canonical contract. The second sentence is load-bearing: without an
 * explicit failure verdict a self-attested ledger would be a prompt-stuffing bypass of this
 * contract (#11329).
 */
const REVIEW_LEDGER_DIRECTIVE =
  " The plan carries a `## Review ledger` section: read it first, then re-verify only the rows it marks as changed plus the plan parts those rows touch instead of re-reviewing the whole plan. The ledger is evidence, not a verdict: a fabricated or incomplete ledger fails this review."

export function buildPlanReviewPrompt(path: string, cwd?: string): string {
  const canonical = `Review the work plan at ${path} for contradictions and blocking issues.`
  return planFileHasReviewLedger(path, cwd) ? `${canonical}${REVIEW_LEDGER_DIRECTIVE}` : canonical
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
  cwd?: string,
): PlanReviewContractOutcome | undefined {
  if (interactionPolicyForAgent(subagentType)?.promptContract !== "plan-review") return undefined
  const state = deps.resolveSkillInvocations?.(sessionId) ?? EMPTY_SKILL_INVOCATIONS
  const target = resolvePlanReviewTarget(callerPrompt, state)
  if (target.kind === "deny") return { kind: "deny", message: target.message }
  return { kind: "prompt", prompt: buildPlanReviewPrompt(target.path, cwd) }
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
