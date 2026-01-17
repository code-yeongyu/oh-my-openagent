import { groupTasksIntoWaves, type WaveTaskInput, type WaveGroupingResult } from "./wave-grouper"

export type RiskTier = 0 | 1 | 2 | 3

export type TaskType = "code" | "frontend" | "docs"

export type AgentType = "implementer" | "frontend-ui-ux-engineer" | "document-writer"

export interface ParsedTaskFiles {
  create: string[]
  modify: string[]
  test: string[]
}

export interface ParsedTask {
  id: string
  name: string
  riskTier: RiskTier
  dependsOn: string[]
  taskType: TaskType
  agent: AgentType
  files: ParsedTaskFiles
  acceptance: string[]
  tddNotes: string[]
}

export interface ParsedFileConflict {
  file: string
  taskIds: string[]
}

export interface ParsedTasksMd {
  featureName: string
  tasks: ParsedTask[]
  fileConflicts: ParsedFileConflict[]
  waveResult: WaveGroupingResult
}

const TASK_HEADER_REGEX = /^###\s+Task\s+([\d.]+):\s*(.+?)(?:\s*<!--.*-->)*\s*$/
const DEPENDS_ON_REGEX = /<!--\s*depends_on:\s*([^>]+)\s*-->/i
const RISK_TIER_REGEX = /<!--\s*Risk:\s*Tier-?(\d)\s*-->/i
const TASK_TYPE_REGEX = /<!--\s*type:\s*(code|frontend|docs)\s*-->/i
const AGENT_REGEX = /<!--\s*agent:\s*(implementer|frontend-ui-ux-engineer|document-writer)\s*-->/i
const FEATURE_NAME_REGEX = /^#\s+Tasks:\s*(.+)$/m

export function parseRiskTier(line: string): RiskTier {
  const match = line.match(RISK_TIER_REGEX)
  if (!match) {
    return 2
  }
  const tier = parseInt(match[1], 10)
  if (tier >= 0 && tier <= 3) {
    return tier as RiskTier
  }
  return 2
}

export function parseDependsOn(line: string): string[] {
  const match = line.match(DEPENDS_ON_REGEX)
  if (!match) {
    return []
  }
  const deps = match[1]
    .split(",")
    .map((d) => d.trim())
    .filter((d) => d.length > 0 && d.toLowerCase() !== "none")
  return deps
}

export function parseTaskType(line: string): TaskType {
  const match = line.match(TASK_TYPE_REGEX)
  if (!match) {
    return "code"
  }
  return match[1] as TaskType
}

export function parseAgent(line: string): AgentType {
  const match = line.match(AGENT_REGEX)
  if (!match) {
    return "implementer"
  }
  return match[1] as AgentType
}

export function parseFilesSection(content: string): ParsedTaskFiles {
  const files: ParsedTaskFiles = { create: [], modify: [], test: [] }

  const createMatch = content.match(/Create:\s*`([^`]+)`/g)
  const modifyMatch = content.match(/Modify:\s*`([^`]+)`/g)
  const testMatch = content.match(/Test:\s*`([^`]+)`/g)

  if (createMatch) {
    for (const match of createMatch) {
      const file = match.match(/Create:\s*`([^`]+)`/)
      if (file?.[1]) {
        files.create.push(file[1].replace(/\s*⚠️.*$/, "").trim())
      }
    }
  }

  if (modifyMatch) {
    for (const match of modifyMatch) {
      const file = match.match(/Modify:\s*`([^`]+)`/)
      if (file?.[1]) {
        files.modify.push(file[1].replace(/\s*⚠️.*$/, "").trim())
      }
    }
  }

  if (testMatch) {
    for (const match of testMatch) {
      const file = match.match(/Test:\s*`([^`]+)`/)
      if (file?.[1]) {
        files.test.push(file[1].replace(/\s*⚠️.*$/, "").trim())
      }
    }
  }

  return files
}

export function parseAcceptance(content: string): string[] {
  const acceptanceMatch = content.match(/\*\*Acceptance[^*]*\*\*:?\s*([\s\S]*?)(?=\n\*\*|\n---|\n###|$)/i)
  if (!acceptanceMatch) {
    return []
  }

  const lines = acceptanceMatch[1].split("\n")
  const criteria: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith("- [")) {
      const text = trimmed.replace(/^-\s*\[[^\]]*\]\s*/, "").trim()
      if (text.length > 0) {
        criteria.push(text)
      }
    }
  }

  return criteria
}

export function parseTddNotes(content: string): string[] {
  const tddMatch = content.match(/\*\*TDD\s*Notes?[^*]*\*\*:?\s*([\s\S]*?)(?=\n\*\*|\n---|\n###|$)/i)
  if (!tddMatch) {
    return []
  }

  const lines = tddMatch[1].split("\n")
  const notes: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith("- Test:") || trimmed.startsWith("-Test:")) {
      const text = trimmed.replace(/^-\s*Test:\s*/i, "").trim()
      if (text.length > 0) {
        notes.push(text)
      }
    }
  }

  return notes
}

export function splitIntoTaskBlocks(content: string): { headerLine: string; body: string }[] {
  const lines = content.split("\n")
  const blocks: { headerLine: string; body: string }[] = []

  let currentHeader: string | null = null
  let currentBody: string[] = []

  for (const line of lines) {
    const headerMatch = line.match(TASK_HEADER_REGEX)
    if (headerMatch) {
      if (currentHeader !== null) {
        blocks.push({ headerLine: currentHeader, body: currentBody.join("\n") })
      }
      currentHeader = line
      currentBody = []
    } else if (currentHeader !== null) {
      currentBody.push(line)
    }
  }

  if (currentHeader !== null) {
    blocks.push({ headerLine: currentHeader, body: currentBody.join("\n") })
  }

  return blocks
}

export function parseTaskBlock(headerLine: string, body: string): ParsedTask | null {
  const headerMatch = headerLine.match(TASK_HEADER_REGEX)
  if (!headerMatch) {
    return null
  }

  const id = headerMatch[1]
  const name = headerMatch[2].replace(/<!--.*-->/g, "").trim()

  const riskTier = parseRiskTier(headerLine)
  const dependsOn = parseDependsOn(headerLine)
  const taskType = parseTaskType(headerLine)
  const agent = parseAgent(headerLine)
  const files = parseFilesSection(body)
  const acceptance = parseAcceptance(body)
  const tddNotes = parseTddNotes(body)

  return {
    id,
    name,
    riskTier,
    dependsOn,
    taskType,
    agent,
    files,
    acceptance,
    tddNotes,
  }
}

export function detectFileConflicts(tasks: ParsedTask[]): ParsedFileConflict[] {
  const fileToTasks = new Map<string, string[]>()

  for (const task of tasks) {
    const allFiles = [...task.files.create, ...task.files.modify]
    for (const file of allFiles) {
      const taskIds = fileToTasks.get(file) ?? []
      taskIds.push(task.id)
      fileToTasks.set(file, taskIds)
    }
  }

  const conflicts: ParsedFileConflict[] = []
  for (const [file, taskIds] of fileToTasks) {
    if (taskIds.length > 1) {
      conflicts.push({ file, taskIds })
    }
  }

  return conflicts
}

export function convertToWaveInput(tasks: ParsedTask[]): WaveTaskInput[] {
  return tasks.map((task) => ({
    id: task.id,
    dependsOn: task.dependsOn.length > 0 ? task.dependsOn : undefined,
    files: {
      create: task.files.create,
      modify: task.files.modify,
      test: task.files.test,
    },
  }))
}

export function parseTasksMd(content: string): ParsedTasksMd {
  const featureMatch = content.match(FEATURE_NAME_REGEX)
  const featureName = featureMatch ? featureMatch[1].trim() : "unknown"

  const blocks = splitIntoTaskBlocks(content)
  const tasks: ParsedTask[] = []

  for (const block of blocks) {
    const task = parseTaskBlock(block.headerLine, block.body)
    if (task) {
      tasks.push(task)
    }
  }

  const fileConflicts = detectFileConflicts(tasks)

  const waveInput = convertToWaveInput(tasks)
  const waveResult = groupTasksIntoWaves(waveInput, { featureName })

  return {
    featureName,
    tasks,
    fileConflicts,
    waveResult,
  }
}

export function formatWavePreview(result: ParsedTasksMd): string {
  const lines: string[] = []

  lines.push("## Wave Preview")
  lines.push("")
  lines.push("| Wave | Tasks | Parallel |")
  lines.push("|------|-------|----------|")

  for (const wave of result.waveResult.waves) {
    const taskIds = wave.tasks.map((t) => t.id).join(", ")
    const parallel = wave.tasks.length > 1 ? "✅ Yes" : "-"
    lines.push(`| Wave ${wave.id} | ${taskIds} | ${parallel} |`)
  }

  if (result.fileConflicts.length > 0) {
    lines.push("")
    lines.push("## File Conflicts")
    lines.push("")
    lines.push("| File | Tasks | Resolution |")
    lines.push("|------|-------|------------|")

    for (const conflict of result.fileConflicts) {
      const tasks = conflict.taskIds.join(", ")
      lines.push(`| \`${conflict.file}\` | ${tasks} | Serialized |`)
    }
  }

  return lines.join("\n")
}
