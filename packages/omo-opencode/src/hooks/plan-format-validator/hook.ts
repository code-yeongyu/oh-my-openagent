import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"

import { getPlanProgress } from "../../features/boulder-state/storage"
import { log } from "../../shared/logger"

const WRITE_TOOLS = new Set(["Write", "Edit", "write", "edit"])

const CHECKBOX_PATTERN = /^[-*]\s*\[[ xX]\]/m

const HEADING_SECOND_LEVEL = /^##\s+/
const HEADING_TODOS = /^##\s+TODOs\b/i
const HEADING_FINAL_WAVE = /^##\s+Final Verification Wave\b/i
const TOPLEVEL_CHECKBOX = /^[-*]\s*\[[ xX]?\]/

function countRawTopLevelCheckboxes(content: string): number {
  const lines = content.split(/\r?\n/)
  let section: "todo" | "final-wave" | "other" = "other"
  let count = 0

  for (const line of lines) {
    if (HEADING_SECOND_LEVEL.test(line)) {
      section = HEADING_TODOS.test(line)
        ? "todo"
        : HEADING_FINAL_WAVE.test(line)
          ? "final-wave"
          : "other"
      continue
    }

    if (section === "other") continue
    if (!TOPLEVEL_CHECKBOX.test(line)) continue

    count++
  }

  return count
}

function buildWarning(rawCount: number, parsedCount: number): string {
  const skipped = rawCount - parsedCount

  if (parsedCount === 0) {
    return [
      "",
      "<plan-format-warning>",
      `Plan has **${rawCount} task checkbox(es)** but \`getPlanProgress()\` parsed **0**.`,
      "This means `/start-work` will show **\"Progress: 0/0\"** for this plan.",
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
      if (!CHECKBOX_PATTERN.test(content)) return

      const rawCount = countRawTopLevelCheckboxes(content)
      if (rawCount === 0) return

      const progress = getPlanProgress(resolvedPath)
      const parsedCount = progress.total

      if (rawCount === parsedCount) return

      log(`[plan-format-validator] Plan ${filePath}: ${parsedCount}/${rawCount} tasks parsed`, {
        sessionID: input.sessionID,
        filePath,
        rawCount,
        parsedCount,
      })

      output.output = `${output.output}${buildWarning(rawCount, parsedCount)}`
    },
  }
}
