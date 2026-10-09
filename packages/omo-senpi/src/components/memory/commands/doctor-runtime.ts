// /doctor — deterministic memory health checks plus the skill frontmatter repair.
//
// Checks: repository presence, frontmatter validity sweep, persona presence,
// stale locks, orphaned reflection worktrees, and the compile-warn token
// advisory. Output is read-only and never enters model context.

import { auditMemoryRepo, redactSecretLikeMaterial, type MemoryAuditReport } from "@oh-my-opencode/memory-core"
import { parseCommandArgs } from "./args"
import { projectionLimits } from "../projection-limits"
import { checkProjection } from "./doctor-projection"
import { estimateSystemTokens } from "./tokens"
import {
  checkAbandonedRuns,
  checkFrontmatter,
  checkLocks,
  checkRepository,
  checkReflectionHealth,
  checkSoulSeed,
  checkTokens,
  checkWorktrees,
  type CheckLevel,
  type DoctorCheck,
} from "./doctor-checks"
import { checkQuarantinedRuns, checkReceipts, type QuarantinedRun, type ReceiptSummaries } from "./doctor-receipts"
import { checkGhostReservation } from "./doctor-reservation"
import { factsRemediationHint, formatFactsAdvisory, readFactsOverview } from "./facts-status"
import {
  formatSkillNameFrontmatterRepairReport,
  repairMissingSkillNameFrontmatter,
} from "./skill-frontmatter"
import {
  requireIdentity,
  respond,
  type MemoryCommandContext,
  type MemoryCommandDeps,
  type MemoryCommandIdentity,
} from "./types"

const LEVEL_ORDER: Record<CheckLevel, number> = { ok: 0, warn: 1, fail: 2 }

function worstLevel(checks: readonly DoctorCheck[]): CheckLevel {
  return checks.reduce<CheckLevel>(
    (worst, check) => (LEVEL_ORDER[check.level] > LEVEL_ORDER[worst] ? check.level : worst),
    "ok",
  )
}

/**
 * Advisory only, and only when there IS something to advise: a healthy facts ledger renders
 * nothing, so the zero state stays silent. A corrupt ledger is a `fail`, since launches are
 * blocked until it is repaired.
 */
async function checkFacts(
  deps: MemoryCommandDeps,
  identityPaths: MemoryCommandIdentity["identityPaths"],
): Promise<DoctorCheck | undefined> {
  const overview = await readFactsOverview({
    identityPaths,
    now: new Date(deps.now?.() ?? Date.now()),
  })
  const advisory = formatFactsAdvisory(overview)
  if (advisory === undefined) return undefined
  const hint = factsRemediationHint(overview)
  return {
    name: "facts",
    level: overview.corrupt === undefined ? "warn" : "fail",
    detail: `${advisory.replace(/^facts: /, "")}${hint === undefined ? "" : `; ${hint}`}`,
  }
}

function redactReportStrings(value: unknown): unknown {
  if (typeof value === "string") return redactSecretLikeMaterial(value)
  if (Array.isArray(value)) return value.map(redactReportStrings)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, redactReportStrings(field)]))
  }
  return value
}

export async function runDoctor(deps: MemoryCommandDeps, ctx: MemoryCommandContext, args = ""): Promise<string> {
  const parsed = parseCommandArgs(args, { booleans: ["json"] })
  for (const flag of parsed.flags.keys()) {
    if (flag !== "json") return respond(ctx, `unknown flag --${flag}`, "error")
  }
  if (parsed.positionals.length > 0 || (parsed.flags.has("json") && parsed.flags.get("json") !== true)) {
    return respond(ctx, "usage: /doctor [--json]", "error")
  }
  const identity = requireIdentity(deps, ctx)
  if (typeof identity === "string") return respond(ctx, identity, "error")

  const repoDir = identity.identityPaths.repo
  const repository = checkRepository(identity)
  const checks: DoctorCheck[] = [repository]
  const extra: string[] = []
  let audit: MemoryAuditReport | null = null
  let skills = { scanned: 0, repaired: 0 }
  let receipts: ReceiptSummaries | null = null
  let quarantinedRuns: readonly QuarantinedRun[] = []

  if (repository.level === "ok") {
    const settings = deps.loadSettings().settings
    const warnTokens = settings.compile_warn_tokens
    const systemTokens = await estimateSystemTokens(repoDir)
    audit = await auditMemoryRepo(repoDir, { systemTokens, budgetTokens: warnTokens })
    const receiptCheck = await checkReceipts(identity.identityPaths.runtime, deps.now?.() ?? Date.now())
    const quarantine = await checkQuarantinedRuns(identity.identityPaths.reflection)
    receipts = receiptCheck.receipts
    quarantinedRuns = quarantine.runs
    checks.push(
      ...(await checkFrontmatter(repoDir, audit)),
      await checkSoulSeed(repoDir),
      await checkLocks(deps, identity.identityPaths.locks),
      await checkWorktrees(deps, identity),
      await checkAbandonedRuns(identity.identityPaths.reflection),
      quarantine.check,
      receiptCheck.check,
      await checkGhostReservation(identity.identityPaths, deps),
      await checkReflectionHealth(identity.identityPaths.reflection, { now: deps.now?.() ?? Date.now() }),
      await checkTokens(repoDir, warnTokens, systemTokens),
    )
    const projection = await checkProjection(repoDir, identity.identity, projectionLimits(settings, identity.identity))
    if (projection !== undefined) checks.push(projection)
    if (audit.issues.length === 0) {
      checks.push({ name: "audit", level: "ok", detail: "no structural issues" })
    } else {
      for (const [code, count] of Object.entries(audit.counts)) {
        if (code === "frontmatter_invalid" || count === 0) continue
        const issues = audit.issues.filter((issue) => issue.code === code)
        checks.push({
          name: `audit:${code}`,
          level: code === "file_unreadable" ? "fail" : "warn",
          detail: `${issues.length} issue${issues.length === 1 ? "" : "s"}: ${issues.map((issue) => `${issue.path} -> ${issue.detail}`).join("; ")}`,
        })
      }
    }

    const facts = await checkFacts(deps, identity.identityPaths)
    if (facts !== undefined) checks.push(facts)

    const repaired = await repairMissingSkillNameFrontmatter(repoDir)
    skills = { scanned: repaired.scanned, repaired: repaired.repaired.length }
    const report = formatSkillNameFrontmatterRepairReport(repaired)
    extra.push(
      `[info] skills: scanned ${repaired.scanned} skill file${repaired.scanned === 1 ? "" : "s"}`,
      ...report.split("\n").filter((line) => line.length > 0).map((line) => `[info] skills: ${line}`),
    )
  }

  const level = worstLevel(checks)
  const notifyLevel = level === "fail" ? "error" : level === "warn" ? "warning" : "info"
  if (parsed.flags.has("json")) {
    return respond(ctx, JSON.stringify(redactReportStrings({ identity: identity.identity, level, checks, audit, skills, receipts, quarantinedRuns }), null, 2), notifyLevel)
  }
  const lines = [
    `# Memory doctor: ${identity.identity}`,
    "",
    ...checks.map((check) => `[${check.level}] ${check.name}: ${check.detail}`),
    ...extra,
  ]
  if (level === "fail") lines.push("", "fix the failing checks above, then re-run /doctor")
  else if (level === "warn") lines.push("", "warnings do not block memory; re-run /doctor after addressing them")

  return respond(ctx, redactSecretLikeMaterial(lines.join("\n")), notifyLevel)
}
