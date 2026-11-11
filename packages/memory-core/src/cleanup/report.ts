import type { MemoryCleanupApplyResult } from "./apply"
import { MEMORY_CLEANUP_CLASSES, type CleanupAction, type MemoryCleanupFinding, type MemoryCleanupPlan } from "./types"

export interface RenderMemoryCleanupReportOptions {
  readonly applied?: MemoryCleanupApplyResult
}

const CLASS_TITLES = {
  duplicate: "duplicate: the same fact recorded twice",
  superseded: "superseded: a newer note plainly covers the older one",
  stale: "stale: the note itself declares its horizon passed",
  conflict: "conflict: notes that contradict each other (kept and marked, no winner picked)",
} as const

export function renderMemoryCleanupReport(
  plan: MemoryCleanupPlan,
  options: RenderMemoryCleanupReportOptions = {},
): string {
  const mode = options.applied === undefined ? "dry run" : options.applied.applied ? "applied" : "nothing to apply"
  const homes = Object.entries(plan.scanned.byHome)
    .map(([home, count]) => `${home} ${count}`)
    .join(", ")
  const lines = [
    `# Memory cleanup (${mode}) - ${plan.repoDir}`,
    `scanned ${plan.scanned.notes} note(s) (${homes || "none"}); ARCHIVE.md and notes/ are never candidates`,
  ]
  if (plan.scanned.skipped.length > 0) {
    lines.push(`skipped ${plan.scanned.skipped.length} unreadable file(s), never touched:`)
    for (const file of plan.scanned.skipped) lines.push(`  - ${file.path}: ${file.reason}`)
  }
  for (const cls of MEMORY_CLEANUP_CLASSES) {
    const findings = plan.findings.filter((finding) => finding.class === cls)
    lines.push("", `## ${CLASS_TITLES[cls]} (${findings.length})`)
    if (findings.length === 0) lines.push("- none")
    for (const finding of findings) lines.push(...renderFinding(finding))
  }
  lines.push("", `## held (${plan.held.length}) - reported, not applied`)
  if (plan.held.length === 0) lines.push("- none")
  for (const finding of plan.held)
    lines.push(
      `- ${finding.class} ${finding.subject}${finding.related === undefined ? "" : ` -> ${finding.related}`}: ${finding.held}`,
    )
  lines.push("", `## kept (${plan.kept.length}) - information only, no action`)
  if (plan.kept.length === 0) lines.push("- none")
  for (const note of plan.kept) lines.push(`- ${note.kind}: ${note.detail}`)
  lines.push("", "## budget", renderBudget(plan))
  lines.push("", "## apply would", renderSummary(plan))
  lines.push("", ...renderFooter(plan, options))
  return lines.join("\n")
}

function renderFinding(finding: MemoryCleanupFinding): string[] {
  const head = finding.related === undefined ? finding.subject : `${finding.subject} -> ${finding.related}`
  const lines = [`- ${head}`]
  for (const item of finding.evidence)
    lines.push(`    evidence (${item.kind})${item.at === undefined ? "" : ` at ${item.at}`}: ${item.detail}`)
  for (const action of finding.actions) lines.push(`    apply: ${describeAction(action)}`)
  const repointed = finding.touches.filter(
    (path) => path !== "ARCHIVE.md" && !finding.actions.some((action) => writes(action, path)),
  )
  if (repointed.length > 0) lines.push(`    apply: repoint link(s) in ${repointed.join(", ")}`)
  return lines
}

function writes(action: CleanupAction, path: string): boolean {
  switch (action.kind) {
    case "archive":
      return action.path === path
    case "merge":
      return action.into === path
    case "mark-conflict":
      return action.path === path
  }
}

function describeAction(action: CleanupAction): string {
  switch (action.kind) {
    case "archive":
      return `move ${action.path} into ARCHIVE.md with reason "${action.reason}"${action.successor === undefined ? "" : ` and successor ${action.successor}`}`
    case "merge":
      return `append ${action.paragraphs.length} distinctive paragraph(s) from ${action.from} to ${action.into} under "## Merged from ${action.from}"`
    case "mark-conflict":
      return `add conflicts_with: ${action.other} to ${action.path}`
  }
}

function renderBudget(plan: MemoryCleanupPlan): string {
  const { tokensBefore, tokensAfter, budgetTokens, systemFiles } = plan.budget
  const delta = tokensAfter - tokensBefore
  const of =
    budgetTokens === undefined ? "" : ` of ${budgetTokens} (${Math.round((tokensBefore / budgetTokens) * 100)}%)`
  const afterOf = budgetTokens === undefined ? "" : ` (${Math.round((tokensAfter / budgetTokens) * 100)}%)`
  const change = delta === 0 ? "no change" : `${delta > 0 ? "+" : ""}${delta}`
  return `system/ ${systemFiles} file(s) ~${tokensBefore} tokens${of} -> ~${tokensAfter}${afterOf} after apply (${change}; bytes/4, link rewrites not counted)`
}

function renderSummary(plan: MemoryCleanupPlan): string {
  const { archive, merge, mark, repoint } = plan.summary
  if (archive + merge + mark === 0) return "nothing; the repository is already clean under these rules"
  return `archive ${archive} note(s) into ARCHIVE.md, merge ${merge}, mark ${mark} conflict side(s), repoint links in ${repoint} other note(s); one commit, nothing deleted`
}

function renderFooter(plan: MemoryCleanupPlan, options: RenderMemoryCleanupReportOptions): string[] {
  const applied = options.applied
  if (applied === undefined) {
    return plan.findings.length === 0
      ? ["nothing to apply."]
      : ["Read the findings above, then run again with --apply (add --skip <path> for any finding you veto)."]
  }
  if (!applied.applied) return ["nothing to apply."]
  return [
    `${applied.commit.message}`,
    `written: ${applied.written.join(", ") || "none"}`,
    `archived: ${applied.removed.join(", ") || "none"}`,
  ]
}
