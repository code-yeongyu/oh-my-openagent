import { existsSync, readFileSync } from "node:fs"
import { basename } from "node:path"
import type { PlanProgress } from "./types"

export type ParsedPlanTaskSection = "todo" | "final-wave"
export type ParsedPlanTaskSourceFormat =
  | "recommended-agent-profile"
  | "delegation-recommendation"
  | "legacy"

export interface ParsedPlanTask {
  id: string
  title: string
  checked: boolean
  section: ParsedPlanTaskSection
  category?: string
  skills: string[]
  dependsOn: string[]
  blockedBy: string[]
  blocks: string[]
  wave?: string
  acceptanceCriteria: string[]
  sourceFormat: ParsedPlanTaskSourceFormat
  rawBlock: string
}

export interface ParsedPlanWave {
  id: string
  taskIds: string[]
}

export interface ParsedPlanContract {
  planPath: string
  planName: string
  tasks: ParsedPlanTask[]
  waves: ParsedPlanWave[]
}

export interface PlanExecutionSummary {
  progress: PlanProgress
  pendingImplementationTaskCount: number
  pendingFinalWaveTaskCount: number
  nextWaveId?: string
  nextTasks: Array<Pick<ParsedPlanTask, "id" | "title" | "category" | "wave" | "section">>
}

const TODO_SECTION_HEADER = /^##\s+TODOs\b/i
const FINAL_WAVE_SECTION_HEADER = /^##\s+Final Verification Wave\b/i
const TOP_LEVEL_SECTION_HEADER = /^##\s+/
const TOP_LEVEL_CHECKBOX = /^-\s*\[([ xX])\]\s+/
const TASK_ID_TITLE_PATTERN = /^([A-Za-z0-9-]+)\.\s+(.*)$/

function getPlanNameFromPath(planPath: string): string {
  return basename(planPath, ".md")
}

function parseBracketedList(value: string | undefined): string[] {
  if (!value) return []
  if (/\bnone\b/i.test(value)) return []

  const backticked = [...value.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim())
  if (backticked.length > 0) {
    return backticked
  }

  return value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseTaskRefs(value: string | undefined): string[] {
  if (!value) return []
  if (/\bnone\b/i.test(value)) return []

  const taskRefs = [...value.matchAll(/\b(?:Task\s+)?([A-Za-z0-9-]+)\b/g)]
    .map((match) => match[1].trim())
    .filter((item) => !/^(depends|on|blocked|by|blocks|wave)$/i.test(item))

  return [...new Set(taskRefs)]
}

function extractFieldValue(block: string, label: string): string | undefined {
  const pattern = new RegExp(`${label}:\\s*(.+)`, "i")
  const match = block.match(pattern)
  return match?.[1]?.trim()
}

function extractWave(block: string): string | undefined {
  const waveMatch =
    block.match(/\b(Wave\s+[A-Za-z0-9-]+)\b/i) ??
    block.match(/\bParallel Group:\s*(Wave\s+[A-Za-z0-9-]+)\b/i)

  return waveMatch?.[1]?.trim()
}

function extractAcceptanceCriteria(lines: string[]): string[] {
  const criteria: string[] = []
  let inAcceptanceCriteria = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (/^\*\*Acceptance Criteria\*\*/i.test(trimmed)) {
      inAcceptanceCriteria = true
      continue
    }

    if (inAcceptanceCriteria && /^\*\*[A-Z]/.test(trimmed)) {
      inAcceptanceCriteria = false
    }

    if (inAcceptanceCriteria && /^\s*-\s*\[[ xX]\]\s+/.test(line)) {
      criteria.push(trimmed.replace(/^-+\s*\[[ xX]\]\s+/, "").trim())
    }
  }

  return criteria
}

function parseTaskBlock(section: ParsedPlanTaskSection, lines: string[], index: number): ParsedPlanTask {
  const firstLine = lines[0] ?? ""
  const trimmedFirstLine = firstLine.trim()
  const checked = /\[[xX]\]/.test(trimmedFirstLine)
  const taskText = trimmedFirstLine.replace(TOP_LEVEL_CHECKBOX, "")
  const idTitleMatch = taskText.match(TASK_ID_TITLE_PATTERN)
  const id = idTitleMatch?.[1] ?? `${section}-${index + 1}`
  const title = idTitleMatch?.[2]?.trim() ?? taskText.trim()
  const rawBlock = lines.join("\n")

  const category =
    rawBlock.match(/- Category:\s*`([^`]+)`/i)?.[1]?.trim() ??
    rawBlock.match(/\bCategory:\s*`([^`]+)`/i)?.[1]?.trim()

  const skillsLine =
    extractFieldValue(rawBlock, "- Skills") ??
    extractFieldValue(rawBlock, "\\*\\*Skills\\*\\*") ??
    extractFieldValue(rawBlock, "Skills")

  const dependsOnValue =
    extractFieldValue(rawBlock, "\\*\\*Depends On\\*\\*") ?? extractFieldValue(rawBlock, "Depends On")

  const parallelizationLine =
    extractFieldValue(rawBlock, "\\*\\*Parallelization\\*\\*") ??
    extractFieldValue(rawBlock, "Parallelization")

  const blockedByMatch = parallelizationLine?.match(/Blocked By:\s*([^|]+)/i)
  const blocksMatch = parallelizationLine?.match(/Blocks:\s*([^|]+)/i)

  const sourceFormat: ParsedPlanTaskSourceFormat = rawBlock.includes("**Recommended Agent Profile**")
    ? "recommended-agent-profile"
    : rawBlock.includes("**Delegation Recommendation:**") || rawBlock.includes("**Delegation Recommendation**")
      ? "delegation-recommendation"
      : "legacy"

  return {
    id,
    title,
    checked,
    section,
    ...(category ? { category } : {}),
    skills: parseBracketedList(skillsLine),
    dependsOn: parseTaskRefs(dependsOnValue),
    blockedBy: parseTaskRefs(blockedByMatch?.[1]),
    blocks: parseTaskRefs(blocksMatch?.[1]),
    ...(extractWave(rawBlock) ? { wave: extractWave(rawBlock) } : {}),
    acceptanceCriteria: extractAcceptanceCriteria(lines.slice(1)),
    sourceFormat,
    rawBlock,
  }
}

function parsePlanWaves(content: string): ParsedPlanWave[] {
  const waves: ParsedPlanWave[] = []
  const lines = content.split(/\r?\n/)
  let inParallelGraph = false
  let currentWave: ParsedPlanWave | null = null

  for (const line of lines) {
    const trimmed = line.trim()

    if (/^##\s+Parallel Execution Graph\b/i.test(trimmed)) {
      inParallelGraph = true
      currentWave = null
      continue
    }

    if (inParallelGraph && TOP_LEVEL_SECTION_HEADER.test(trimmed) && !/^##\s+Parallel Execution Graph\b/i.test(trimmed)) {
      inParallelGraph = false
      currentWave = null
    }

    if (!inParallelGraph) {
      continue
    }

    const waveMatch = trimmed.match(/^(Wave\s+[A-Za-z0-9-]+)\s*:/i)
    if (waveMatch) {
      currentWave = { id: waveMatch[1].trim(), taskIds: [] }
      waves.push(currentWave)
      continue
    }

    if (!currentWave) {
      continue
    }

    const taskMatches = [...trimmed.matchAll(/\bTask\s+([A-Za-z0-9-]+)\b/g)]
    for (const match of taskMatches) {
      const taskId = match[1].trim()
      if (!currentWave.taskIds.includes(taskId)) {
        currentWave.taskIds.push(taskId)
      }
    }
  }

  return waves
}

export function parsePlanContractFromContent(planPath: string, content: string): ParsedPlanContract {
  const lines = content.split(/\r?\n/)
  const tasks: ParsedPlanTask[] = []
  let currentSection: ParsedPlanTaskSection | null = null
  let currentTaskLines: string[] = []
  let currentTaskSection: ParsedPlanTaskSection | null = null

  const flushTask = () => {
    if (!currentTaskSection || currentTaskLines.length === 0) {
      currentTaskLines = []
      currentTaskSection = null
      return
    }

    tasks.push(parseTaskBlock(currentTaskSection, currentTaskLines, tasks.length))
    currentTaskLines = []
    currentTaskSection = null
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (TODO_SECTION_HEADER.test(trimmed)) {
      flushTask()
      currentSection = "todo"
      continue
    }

    if (FINAL_WAVE_SECTION_HEADER.test(trimmed)) {
      flushTask()
      currentSection = "final-wave"
      continue
    }

    if (TOP_LEVEL_SECTION_HEADER.test(trimmed) && currentSection) {
      flushTask()
      currentSection = null
      continue
    }

    if (!currentSection) {
      continue
    }

    if (TOP_LEVEL_CHECKBOX.test(line)) {
      flushTask()
      currentTaskSection = currentSection
      currentTaskLines = [line]
      continue
    }

    if (currentTaskLines.length > 0) {
      currentTaskLines.push(line)
    }
  }

  flushTask()

  return {
    planPath,
    planName: getPlanNameFromPath(planPath),
    tasks,
    waves: parsePlanWaves(content),
  }
}

export function readPlanContract(planPath: string): ParsedPlanContract | null {
  if (!existsSync(planPath)) {
    return null
  }

  try {
    const content = readFileSync(planPath, "utf-8")
    return parsePlanContractFromContent(planPath, content)
  } catch {
    return null
  }
}

export function summarizePlanExecution(contract: ParsedPlanContract): PlanExecutionSummary {
  const pendingTasks = contract.tasks.filter((task) => !task.checked)
  const completedTasks = contract.tasks.filter((task) => task.checked)
  const pendingImplementationTasks = pendingTasks.filter((task) => task.section === "todo")
  const pendingFinalWaveTasks = pendingTasks.filter((task) => task.section === "final-wave")

  const waveOrder = contract.waves.map((wave) => wave.id)
  const pendingWaveIds = pendingTasks
    .map((task) => task.wave)
    .filter((waveId): waveId is string => Boolean(waveId))
  const nextWaveId = waveOrder.find((waveId) => pendingWaveIds.includes(waveId))

  let nextTasks = pendingTasks
  if (nextWaveId) {
    const waveTasks = pendingTasks.filter((task) => task.wave === nextWaveId)
    if (waveTasks.length > 0) {
      nextTasks = waveTasks
    }
  } else if (pendingTasks.length > 0) {
    nextTasks = [pendingTasks[0]]
  }

  return {
    progress: {
      total: contract.tasks.length,
      completed: completedTasks.length,
      isComplete: pendingTasks.length === 0,
    },
    pendingImplementationTaskCount: pendingImplementationTasks.length,
    pendingFinalWaveTaskCount: pendingFinalWaveTasks.length,
    ...(nextWaveId ? { nextWaveId } : {}),
    nextTasks: nextTasks.map((task) => ({
      id: task.id,
      title: task.title,
      ...(task.category ? { category: task.category } : {}),
      ...(task.wave ? { wave: task.wave } : {}),
      section: task.section,
    })),
  }
}

export function readPlanExecutionSummary(planPath: string): PlanExecutionSummary | null {
  const contract = readPlanContract(planPath)
  if (!contract) {
    return null
  }

  return summarizePlanExecution(contract)
}
