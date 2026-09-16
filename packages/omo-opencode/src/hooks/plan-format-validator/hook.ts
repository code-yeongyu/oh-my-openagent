import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"

import { getPlanProgress } from "../../features/boulder-state/storage"
import { log } from "../../shared/logger"

const WRITE_TOOLS = new Set(["Write", "Edit", "write", "edit"])

const SECTION_BOUNDARY_HEADING = /^#{1,2}(?:[ \t]+|$)/
const HEADING_TODOS = /^##[ \t]+TODOs(?:[ \t]+#+)?[ \t]*$/i
const HEADING_FINAL_WAVE = /^##[ \t]+Final Verification Wave(?:[ \t]+#+)?[ \t]*$/i
const TOPLEVEL_CHECKBOX = /^[-*]\s*\[[ xX]?\]/
const TODO_TASK = /^- \[[ xX]\] [1-9]\d*\. .+$/
const FINAL_WAVE_TASK = /^- \[[ xX]\] F[1-9]\d*\. .+$/i
const FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/

/**
 * The five Effort bands the plan template offers. Effort is a size signal, never a wall-clock
 * estimate: a plan that says "200 hours" is model prose, not a measurement.
 */
export const PLAN_EFFORT_BANDS = ["Quick", "Short", "Medium", "Large", "XL"] as const
export type PlanEffortBand = (typeof PLAN_EFFORT_BANDS)[number]

const EFFORT_LINE = /^(\*\*Effort:\*\*[ \t]*)(.*)$/
const DURATION_VALUE = /(\d+(?:[.,]\d+)?)\s*(?:-|–|to)?\s*(\d+(?:[.,]\d+)?)?\s*(min(?:ute)?s?|h(?:ou)?rs?|d(?:ay)?s?|w(?:ee)?ks?|mo(?:nth)?s?)\b/i

const HOURS_PER_UNIT: Readonly<Record<string, number>> = {
  min: 1 / 60,
  h: 1,
  d: 8,
  w: 40,
  mo: 160,
}

// Upper bound of agent-hours a band stands for; anything past the last bound is XL.
const BAND_UPPER_BOUND_HOURS: readonly (readonly [PlanEffortBand, number])[] = [
  ["Quick", 1],
  ["Short", 4],
  ["Medium", 16],
  ["Large", 40],
]

function unitKey(unit: string): string {
  const lower = unit.toLowerCase()
  if (lower.startsWith("mi")) return "min"
  if (lower.startsWith("mo")) return "mo"
  return lower.charAt(0)
}

/** Maps a written duration ("200 hours", "3 days", "2-3 weeks") to the band that bounds it. */
export function effortBandForDuration(value: string): PlanEffortBand | null {
  const match = value.match(DURATION_VALUE)
  if (match === null) return null
  const upper = (match[2] ?? match[1] ?? "").replace(",", ".")
  const unit = match[3] ?? ""
  const hours = Number.parseFloat(upper) * (HOURS_PER_UNIT[unitKey(unit)] ?? 1)
  if (!Number.isFinite(hours)) return null
  for (const [band, bound] of BAND_UPPER_BOUND_HOURS) {
    if (hours <= bound) return band
  }
  return "XL"
}

type EffortNormalization = {
  readonly content: string
  readonly original: string
  readonly band: PlanEffortBand
}

/**
 * Rewrites an `**Effort:**` value that carries a duration to the bounding band. Band values,
 * localized labels, and anything without a number+unit are left alone.
 */
export function normalizePlanEffort(content: string): EffortNormalization | null {
  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    const match = line.match(EFFORT_LINE)
    if (match === null) continue
    const prefix = match[1] ?? ""
    const value = (match[2] ?? "").trim()
    const band = effortBandForDuration(value)
    if (band === null) return null
    lines[index] = `${prefix}${band}`
    const newline = content.includes("\r\n") ? "\r\n" : "\n"
    return { content: lines.join(newline), original: value, band }
  }
  return null
}

function buildEffortWarning(normalized: EffortNormalization): string {
  return [
    "",
    "<plan-format-warning>",
    `Effort was written as a duration (\`${normalized.original}\`) and has been replaced with the band \`${normalized.band}\`.`,
    "Effort is a size band, never a wall-clock estimate. Use exactly one of:",
    "  Quick (single edit, minutes of agent work) | Short (one focused change, a few files)",
    "  | Medium (multi-file feature in one session) | Large (several waves, one long session)",
    "  | XL (multi-session or architectural work).",
    "Size is communicated by the counted todo rows; do not write hours or days.",
    "</plan-format-warning>",
  ].join("\n")
}

type SectionName = "todo" | "final-wave"

type SectionStats = {
  readonly rawCount: number
  readonly validCount: number
}

type ActiveSection = {
  readonly name: SectionName
  readonly stats: { rawCount: number; validCount: number }
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
  const sections: SectionStats[] = []
  let section: ActiveSection | null = null
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

    if (SECTION_BOUNDARY_HEADING.test(line)) {
      const name = HEADING_TODOS.test(line) ? "todo" : HEADING_FINAL_WAVE.test(line) ? "final-wave" : null
      if (name === null) {
        section = null
      } else {
        const stats = { rawCount: 0, validCount: 0 }
        sections.push(stats)
        section = { name, stats }
      }
      continue
    }
    if (section === null || !TOPLEVEL_CHECKBOX.test(line)) continue

    section.stats.rawCount += 1
    const validPattern = section.name === "todo" ? TODO_TASK : FINAL_WAVE_TASK
    if (validPattern.test(line)) section.stats.validCount += 1
  }

  return {
    rawCount: sections.reduce((total, item) => total + item.rawCount, 0),
    hasEmptySection: sections.some((item) => item.validCount === 0),
    hasMalformedRows: sections.some((item) => item.rawCount !== item.validCount),
    recognized: sections.length > 0,
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
      "Those sections will contribute no tasks to `/ulw-execute` progress.",
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
    `\`/ulw-execute\` will show \"Progress: ${parsedCount} tasks\" — missing ${skipped} task(s).`,
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

      let content = readFileSync(resolvedPath, "utf-8")
      const effort = normalizePlanEffort(content)
      if (effort !== null) {
        content = effort.content
        writeFileSync(resolvedPath, content, "utf-8")
        log(`[plan-format-validator] Plan ${filePath}: Effort "${effort.original}" normalized to ${effort.band}`, {
          sessionID: input.sessionID,
          filePath,
        })
        output.output = `${output.output}${buildEffortWarning(effort)}`
      }

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
