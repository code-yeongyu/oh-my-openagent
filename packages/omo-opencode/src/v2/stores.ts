import type { JsonValue, V2SessionRecord, V2SessionStatus, V2Storage, V2TodoItem } from "./types"

const SESSION_PREFIX = "omo-v2:session:"
const TODO_PREFIX = "omo-v2:todos:"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asSessionRecord(value: unknown): V2SessionRecord | undefined {
  // given
  if (!isRecord(value)) return undefined
  const { id, directory } = value
  if (typeof id !== "string" || typeof directory !== "string") return undefined
  const record: V2SessionRecord = { id, directory, createdAt: 0 }
  if (typeof value["parentID"] === "string") record.parentID = value["parentID"]
  if (typeof value["agent"] === "string") record.agent = value["agent"]
  if (typeof value["createdAt"] === "number") record.createdAt = value["createdAt"]
  return record
}

function asTodoList(value: unknown): V2TodoItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items: V2TodoItem[] = []
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry["content"] !== "string") return undefined
    const status = entry["status"]
    if (status !== "pending" && status !== "in_progress" && status !== "completed" && status !== "cancelled") {
      return undefined
    }
    const item: V2TodoItem = { content: entry["content"], status }
    if (typeof entry["id"] === "string") item.id = entry["id"]
    if (typeof entry["priority"] === "string") item.priority = entry["priority"]
    items.push(item)
  }
  return items
}

export interface V2SessionRegistry {
  register(record: V2SessionRecord): Promise<void>
  get(sessionID: string): Promise<V2SessionRecord | undefined>
  childrenOf(parentID: string): Promise<V2SessionRecord[]>
  list(): Promise<V2SessionRecord[]>
  remove(sessionID: string): Promise<void>
}

export function createSessionRegistry(storage: V2Storage): V2SessionRegistry {
  return {
    async register(record: V2SessionRecord): Promise<void> {
      await storage.set(`${SESSION_PREFIX}${record.id}`, { ...record } as unknown as JsonValue)
    },
    async get(sessionID: string): Promise<V2SessionRecord | undefined> {
      return asSessionRecord(await storage.get(`${SESSION_PREFIX}${sessionID}`))
    },
    async childrenOf(parentID: string): Promise<V2SessionRecord[]> {
      return (await this.list()).filter((record) => record.parentID === parentID)
    },
    async list(): Promise<V2SessionRecord[]> {
      const records: V2SessionRecord[] = []
      let after: string | undefined
      for (;;) {
        const page = await storage.scan({ prefix: SESSION_PREFIX, after, limit: 100 })
        for (const entry of page.entries) {
          const record = asSessionRecord(entry.value)
          if (record) records.push(record)
        }
        if (!page.next) break
        after = page.next
      }
      return records.sort((a, b) => a.createdAt - b.createdAt)
    },
    async remove(sessionID: string): Promise<void> {
      await storage.remove(`${SESSION_PREFIX}${sessionID}`)
    },
  }
}

export interface V2TodoStore {
  get(sessionID: string): Promise<V2TodoItem[]>
  set(sessionID: string, todos: V2TodoItem[]): Promise<void>
}

export function createTodoStore(storage: V2Storage): V2TodoStore {
  return {
    async get(sessionID: string): Promise<V2TodoItem[]> {
      return asTodoList(await storage.get(`${TODO_PREFIX}${sessionID}`)) ?? []
    },
    async set(sessionID: string, todos: V2TodoItem[]): Promise<void> {
      await storage.set(`${TODO_PREFIX}${sessionID}`, [...todos] as unknown as JsonValue)
    },
  }
}

export interface V2StatusCache {
  get(sessionID: string): V2SessionStatus
  set(sessionID: string, status: V2SessionStatus): void
  snapshot(): Record<string, { type: V2SessionStatus }>
}

export function createStatusCache(): V2StatusCache {
  const statuses = new Map<string, V2SessionStatus>()
  return {
    get(sessionID: string): V2SessionStatus {
      return statuses.get(sessionID) ?? "idle"
    },
    set(sessionID: string, status: V2SessionStatus): void {
      statuses.set(sessionID, status)
    },
    snapshot(): Record<string, { type: V2SessionStatus }> {
      const result: Record<string, { type: V2SessionStatus }> = {}
      for (const [id, status] of statuses) result[id] = { type: status }
      return result
    },
  }
}
