import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"

import { getPlanProgress } from "../../features/boulder-state/storage"
import { log } from "../../shared/logger"

const WRITE_TOOLS = new Set(["Write", "Edit", "write", "edit"])

const HEADING_ANY_LEVEL = /^#{1,6}(?:[ \t]+|$)/
const HEADING_TODOS = /^##[ \t]+TODOs(?:[ \t]+#+)?[ \t]*$/i
const HEADING_FINAL_WAVE = /^##[ \t]+Final Verification Wave(?:[ \t]+#+)?[ \t]*$/i
const TOPLEVEL_CHECKBOX = /^[-*]\s*\[[ xX]?\]/
const TODO_TASK = /^- \[[ xX]\] [1-9]\d*\. .+$/
const FINAL_WAVE_TASK = /^- \[[ xX]\] F[1-9]\d*\. .+$/i
const FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/

type SectionName = "todo" | "final-wave"

type SectionStats = {
  readonly recognized: boolean
  readonly rawCount: number
  readonly validCount: number
}

type PlanFormatStats = {
  readonly rawCount: number
  readonly hasEmptySection: boolean
  readonly hasMalformedRows: boolean
  readonly recognized: boolean
}

type MarkdownFence = {
  readonly marker: "`" | "~"
  readonly length: number
}

function analyzeStructuredSections(content: string): PlanFormatStats {
  const lines = content.split(/\r?\n/)
  const stats: Record<SectionName, { recognized: boolean; rawCount: number; validCount: number }> = {
    todo: { recognized: false, rawCount: 0, validCount: 0 },
    "final-wave": { recognized: false, rawCount: 0, validCount: 0 },
  }
  let section: SectionName | null = null
  let fence: MarkdownFence | null = null

  for (const line of lines) {
    if (fence !== null) {
      if (isClosingFence(line, fence)) fence = null
      continue
    }
    const openingFence = parseOpeningFence(line)
    if (openingFence !== null) {
      fence = openingFence
      continue
    }

    if (HEADING_ANY_LEVEL.test(line)) {
      section = HEADING_TODOS.test(line) ? "todo" : HEADING_FINAL_WAVE.test(line) ? "final-wave" : null
      if (section !== null) stats[section].recognized = true
      continue
    }
    if (section === null || !TOPLEVEL_CHECKBOX.test(line)) continue

    stats[section].rawCount += 1
    const validPattern = section === "todo" ? TODO_TASK : FINAL_WAVE_TASK
    if (validPattern.test(line)) stats[section].validCount += 1
  }

  const sections: readonly SectionStats[] = [stats.todo, stats["final-wave"]]
  return {
    rawCount: sections.reduce((total, item) => total + item.rawCount, 0),
    hasEmptySection: sections.some((item) => item.recognized && item.validCount === 0),
    hasMalformedRows: sections.some((item) => item.rawCount !== item.validCount),
    recognized: sections.some((item) => item.recognized),
  }
}

function parseOpeningFence(line: string): MarkdownFence | null {
  const match = line.match(FENCE_PATTERN)
  const run = match?.[1]
  const info = match?.[2]
  const marker = run?.charAt(0)
  if (
    run === undefined ||
    info === undefined ||
    (marker !== "`" && marker !== "~") ||
    (marker === "`" && info.includes("`"))
  ) {
    return null
  }
  return { marker, length: run.length }
}

function isClosingFence(line: string, fence: MarkdownFence): boolean {
  const run = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/)?.[1]
  return run?.charAt(0) === fence.marker && run.length >= fence.length
}

function buildWarning(rawCount: number, parsedCount: number, hasEmptySection: boolean): string {
  const skipped = rawCount - parsedCount

  if (hasEmptySection) {
    const summary =
      parsedCount === 0
        ? "Plan has recognized task sections but no valid task rows."
        : "One or more recognized task sections contain no valid task rows."

    return [
      "",
      "<plan-format-warning>",
      summary,
      "Those sections will contribute no tasks to `/start-work` progress.",
      "",
      "**Fix**: Every task checkbox under `## TODOs` MUST start with a bare number",
      "followed by dot + space: `1.`, `2.`, `3.` — NOT `T1.`, `Phase 1:`, `Task-1.` etc.",
      "Every Final Verification Wave checkbox MUST start with `F` + number:",
      "`F1.`, `F2.` — NOT `T-F1.`, `F-1.`, `Final-1.` etc.",
      "</plan-format-warning>",
    ].join("\n")
  }

  return [
    "",
    "<plan-format-warning>",
    `Plan has **${rawCount} task checkbox(es)** but \`getPlanProgress()\` only parsed **${parsedCount}**. `,
    `**${skipped} task(s)** have malformed labels and will be SKIPPED by the progress counter.`,
    `\`/start-work\` will show \"Progress: ${parsedCount} tasks\" — missing ${skipped} task(s).`,
    "",
    "**Fix**: Ensure every skipped task checkbox uses bare-number format:",
    "  `## TODOs` → `1.`, `2.`, `3.` (NOT `T1.`, `Phase 1:`, `Task-1.`)",
    "  `## Final Verification Wave` → `F1.`, `F2.`, `F3.` (NOT `T-F1.`, `F-1.`, `Final-1.`)",
    "</plan-format-warning>",
  ].join("\n")
}

function isPlanWrite(tool: string, args: Record<string, unknown>): string | null {
  if (!WRITE_TOOLS.has(tool)) return null

  const filePath = (args.filePath ?? args.path ?? args.file) as string | undefined
  if (!filePath) return null

  return filePath
}

function isPlanFilePath(filePath: string): boolean {
  const normalized = filePath.toLowerCase().replace(/\\/g, "/")
  return normalized.includes(".omo/plans/") && normalized.endsWith(".md")
}

/**
 * Programmatic plan format validator.
 *
 * After any agent writes to a `.omo/plans/*.md` file, compares the
 * raw top-level checkbox count against `getPlanProgress()` to detect
 * malformed task labels. Warns the agent when some or all tasks
 * will be skipped by the progress counter.
 */
export function createPlanFormatValidatorHook(_ctx: PluginInput) {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args?: Record<string, unknown> },
      output: { title: string; output: string; metadata: unknown },
    ): Promise<void> => {
      if (!input.args) return
      if (typeof output.output !== "string") return
      if (output.output.includes("<plan-format-warning>")) return

      const filePath = isPlanWrite(input.tool, input.args)
      if (!filePath) return
      if (!isPlanFilePath(filePath)) return

      const resolvedPath = resolve(_ctx.directory, filePath)
      if (!existsSync(resolvedPath)) return

      const content = readFileSync(resolvedPath, "utf-8")
      const formatStats = analyzeStructuredSections(content)
      if (!formatStats.recognized) return

      const progress = getPlanProgress(resolvedPath)
      const parsedCount = progress.total

      if (!formatStats.hasEmptySection && !formatStats.hasMalformedRows) return

      log(`[plan-format-validator] Plan ${filePath}: ${parsedCount}/${formatStats.rawCount} tasks parsed`, {
        sessionID: input.sessionID,
        filePath,
        rawCount: formatStats.rawCount,
        parsedCount,
      })

      output.output = `${output.output}${buildWarning(formatStats.rawCount, parsedCount, formatStats.hasEmptySection)}`
    },
  }
}
