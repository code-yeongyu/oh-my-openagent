import type { BackgroundTaskStatus } from "./types"

const MAX_ENTRIES_PER_PARENT = 100
const MAX_COMPACTION_ENTRIES = 20
const MAX_COMPACTION_DESCRIPTION_CHARS = 240
const MAX_COMPACTION_TOTAL_CHARS = 6_000

export interface TaskHistoryEntry {
  id: string
  sessionID?: string
  agent: string
  description: string
  status: BackgroundTaskStatus
  category?: string
  startedAt?: Date
  completedAt?: Date
}

export class TaskHistory {
  private entries: Map<string, TaskHistoryEntry[]> = new Map()

  record(parentSessionID: string | undefined, entry: TaskHistoryEntry): void {
    if (!parentSessionID) return

    const list = this.entries.get(parentSessionID) ?? []
    const existing = list.findIndex((e) => e.id === entry.id)

    if (existing !== -1) {
      const current = list[existing]
      list[existing] = {
        ...current,
        ...(entry.sessionID !== undefined ? { sessionID: entry.sessionID } : {}),
        ...(entry.agent !== undefined ? { agent: entry.agent } : {}),
        ...(entry.description !== undefined ? { description: entry.description } : {}),
        ...(entry.status !== undefined ? { status: entry.status } : {}),
        ...(entry.category !== undefined ? { category: entry.category } : {}),
        ...(entry.startedAt !== undefined ? { startedAt: entry.startedAt } : {}),
        ...(entry.completedAt !== undefined ? { completedAt: entry.completedAt } : {}),
      }
    } else {
      if (list.length >= MAX_ENTRIES_PER_PARENT) {
        list.shift()
      }
      list.push({ ...entry })
    }

    this.entries.set(parentSessionID, list)
  }

  getByParentSession(parentSessionID: string): TaskHistoryEntry[] {
    const list = this.entries.get(parentSessionID)
    if (!list) return []
    return list.map((e) => ({ ...e }))
  }

  clearSession(parentSessionID: string): void {
    this.entries.delete(parentSessionID)
  }

  clearAll(): void {
    this.entries.clear()
  }

  formatForCompaction(parentSessionID: string): string | null {
    const list = this.getByParentSession(parentSessionID)
    if (list.length === 0) return null

    const recent = list.slice(-MAX_COMPACTION_ENTRIES)
    const olderOmittedCount = list.length - recent.length
    const lines: string[] = []

    if (olderOmittedCount > 0) {
      lines.push(`- ${olderOmittedCount} older delegated sessions omitted from compaction summary.`)
    }

    let budgetOmittedCount = 0
    for (let i = recent.length - 1; i >= 0; i--) {
      const entry = recent[i]
      if (!entry) continue

      const line = formatCompactionEntry(entry)
      if (!appendWithinBudget(lines, line, MAX_COMPACTION_TOTAL_CHARS)) {
        budgetOmittedCount = i + 1
        break
      }
    }

    if (budgetOmittedCount > 0) {
      appendBudgetSummary(lines, budgetOmittedCount)
    }

    return lines.join("\n")
  }
}

function formatCompactionEntry(entry: TaskHistoryEntry): string {
  const description = compactInline(entry.description, MAX_COMPACTION_DESCRIPTION_CHARS)
  const parts = [
    `- **${compactInline(entry.agent, 80)}**`,
    entry.category ? `[${compactInline(entry.category, 60)}]` : "",
    `(${entry.status})`,
    ` task_id: \`${compactInline(entry.id, 120)}\``,
    description ? `: ${description}` : "",
    entry.sessionID ? ` | session: \`${compactInline(entry.sessionID, 120)}\`` : "",
  ]
  return parts.filter((part) => part.length > 0).join("")
}

function compactInline(value: string, maxChars: number): string {
  const normalized = value.replace(/[\n\r]+/g, " ").replace(/\s+/g, " ").replace(/`/g, "'").trim()
  if (normalized.length <= maxChars) {
    return normalized
  }

  const suffix = "... [truncated]"
  const keepChars = Math.max(0, maxChars - suffix.length)
  return `${normalized.slice(0, keepChars).trimEnd()}${suffix}`
}

function appendWithinBudget(lines: string[], line: string, maxChars: number): boolean {
  const currentLength = joinedLength(lines)
  const separatorLength = lines.length === 0 ? 0 : 1
  if (currentLength + separatorLength + line.length > maxChars) {
    return false
  }

  lines.push(line)
  return true
}

function appendBudgetSummary(lines: string[], omittedCount: number): void {
  const summary = `- ${omittedCount} delegated sessions omitted to stay within compaction budget.`
  if (appendWithinBudget(lines, summary, MAX_COMPACTION_TOTAL_CHARS)) {
    return
  }

  while (lines.length > 0 && !appendWithinBudget(lines, summary, MAX_COMPACTION_TOTAL_CHARS)) {
    lines.pop()
  }
}

function joinedLength(lines: readonly string[]): number {
  return lines.reduce((total, line, index) => total + line.length + (index === 0 ? 0 : 1), 0)
}
