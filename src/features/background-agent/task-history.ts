import type { BackgroundTaskStatus } from "./types"

const MAX_ENTRIES_PER_PARENT = 100

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

  formatForCompaction(parentSessionID: string): string | null {
    const list = this.getByParentSession(parentSessionID)
    if (list.length === 0) return null

    const lines = list.map((e) => {
      const desc = e.description.replace(/[\n\r]+/g, " ").trim()
      const parts = [
        `- **${e.agent}**`,
        e.category ? `[${e.category}]` : null,
        `(${e.status})`,
        `: ${desc}`,
        e.sessionID ? ` | session: \`${e.sessionID}\`` : null,
      ]
      return parts.filter(Boolean).join("")
    })

    return lines.join("\n")
  }
}
