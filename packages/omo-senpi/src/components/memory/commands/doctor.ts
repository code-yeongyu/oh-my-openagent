// /doctor — deterministic memory health checks plus the skill frontmatter repair.
//
// Checks: repository presence, frontmatter validity sweep, persona presence,
// stale locks, orphaned reflection worktrees, and the compile-warn token
// advisory. Output is read-only and never enters model context.

import type { SenpiExtensionAPI } from "../../../extension/types"
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

export function registerDoctorCommand(pi: SenpiExtensionAPI, deps: MemoryCommandDeps): void {
  pi.registerCommand("doctor", {
    description: "Run deterministic memory health checks and repair skill frontmatter.",
    argumentHint: "",
    handler: async (_args: string, ctx: MemoryCommandContext): Promise<string> => {
      const identity = requireIdentity(deps, ctx)
      if (typeof identity === "string") return respond(ctx, identity, "error")

      const repoDir = identity.identityPaths.repo
      const repository = checkRepository(identity)
      const checks: DoctorCheck[] = [repository]
      const extra: string[] = []

      if (repository.level === "ok") {
        const warnTokens = deps.loadSettings().settings.compile_warn_tokens
        checks.push(
          ...(await checkFrontmatter(repoDir)),
          await checkSoulSeed(repoDir),
          await checkLocks(deps, identity.identityPaths.locks),
          await checkWorktrees(deps, identity),
          await checkAbandonedRuns(identity.identityPaths.reflection),
          await checkReflectionHealth(identity.identityPaths.reflection, { now: deps.now?.() ?? Date.now() }),
          await checkTokens(repoDir, warnTokens),
        )

        const facts = await checkFacts(deps, identity.identityPaths)
        if (facts !== undefined) checks.push(facts)

        const repaired = await repairMissingSkillNameFrontmatter(repoDir)
        const report = formatSkillNameFrontmatterRepairReport(repaired)
        extra.push(
          `[info] skills: scanned ${repaired.scanned} skill file${repaired.scanned === 1 ? "" : "s"}`,
          ...report.split("\n").filter((line) => line.length > 0).map((line) => `[info] skills: ${line}`),
        )
      }

      const level = worstLevel(checks)
      const lines = [
        `# Memory doctor: ${identity.identity}`,
        "",
        ...checks.map((check) => `[${check.level}] ${check.name}: ${check.detail}`),
        ...extra,
      ]
      if (level === "fail") lines.push("", "fix the failing checks above, then re-run /doctor")
      else if (level === "warn") lines.push("", "warnings do not block memory; re-run /doctor after addressing them")

      return respond(ctx, lines.join("\n"), level === "fail" ? "error" : level === "warn" ? "warning" : "info")
    },
  })
}
