import { appendFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { readBoulderState, readPlanExecutionSummary } from "../../features/boulder-state"

function extractExplicitOverrideReason(prompt: string): string | undefined {
  const patterns = [
    /override reason:\s*(.+)/i,
    /reason for override:\s*(.+)/i,
    /override because\s+(.+)/i,
  ]

  for (const pattern of patterns) {
    const match = prompt.match(pattern)
    if (match?.[1]?.trim()) {
      return match[1].trim()
    }
  }

  return undefined
}

function extractTaskIdFromPrompt(prompt: string): string | undefined {
  const sectionMatch = prompt.match(/##\s*1\.\s*TASK[\s\S]*?(?:\n([^\n]+))/i)
  const candidate = sectionMatch?.[1]?.trim() ?? prompt.split(/\r?\n/).find((line) => /\b[A-Za-z0-9-]+\.\s+/.test(line))?.trim()
  const idMatch = candidate?.match(/\b([A-Za-z0-9-]+)\.\s+/)
  return idMatch?.[1]
}

function ensureFile(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function trackAtlasPlanOverride(input: {
  directory: string
  sessionID?: string
  category?: string
  subagentType?: string
  prompt?: string
}): boolean {
  if (!input.sessionID) return false

  const boulderState = readBoulderState(input.directory)
  if (!boulderState) return false

  const summary = readPlanExecutionSummary(boulderState.active_plan)
  if (!summary || summary.nextTasks.length === 0) return false

  const prompt = input.prompt ?? ""
  const promptTaskId = extractTaskIdFromPrompt(prompt)
  const plannedTask = promptTaskId
    ? summary.nextTasks.find((task) => task.id === promptTaskId) ?? summary.nextTasks[0]
    : summary.nextTasks[0]

  const plannedCategory = plannedTask.category
  const actualCategory = input.category ?? input.subagentType
  const actualWave = plannedTask.wave ?? summary.nextWaveId
  const plannedWave = plannedTask.wave ?? summary.nextWaveId

  const taskIdMismatch = Boolean(promptTaskId && !summary.nextTasks.some((task) => task.id === promptTaskId))
  const categoryMismatch = Boolean(plannedCategory && actualCategory && plannedCategory !== actualCategory)
  const directAgentMismatch = Boolean(!input.category && input.subagentType && plannedCategory)

  if (!taskIdMismatch && !categoryMismatch && !directAgentMismatch) {
    return false
  }

  const reason = extractExplicitOverrideReason(prompt) ?? "No explicit override reason provided"
  const decisionsPath = join(input.directory, ".sisyphus", "notepads", boulderState.plan_name, "decisions.md")
  ensureFile(decisionsPath)

  const lines = [
    `## Atlas Override ${new Date().toISOString()}`,
    `- Planned task: \`${plannedTask.id}. ${plannedTask.title}\``,
    `- Prompt task: ${promptTaskId ? `\`${promptTaskId}\`` : "`unknown`"}`,
    `- Planned category: ${plannedCategory ? `\`${plannedCategory}\`` : "`unspecified`"}`,
    `- Actual category: ${actualCategory ? `\`${actualCategory}\`` : "`unspecified`"}`,
    `- Planned wave: ${plannedWave ? `\`${plannedWave}\`` : "`unspecified`"}`,
    `- Actual wave: ${actualWave ? `\`${actualWave}\`` : "`unspecified`"}`,
    `- Reason: ${reason}`,
    "",
  ]

  appendFileSync(decisionsPath, `${lines.join("\n")}\n`, "utf-8")
  return true
}
