export type RequestSnapshotLease = {
  owns: (messageID: unknown) => boolean
  bind: (messageID: unknown) => void
  commit: () => void
  complete: (info: Record<string, unknown>) => void
  remove: (messageID: unknown) => void
  release: () => void
}

type Snapshot<T> = { config: T; generation: number; startedAt: number; terminal: boolean; holds: Set<symbol>; assistants: Map<string, number> }

/** Retain only active requests and concrete event/recovery owners, never turn history. */
export function createRequestSnapshotStore<T>() {
  const sessions = new Map<string, Map<string, Snapshot<T>>>()
  const pending = new Map<string, Map<string, RequestSnapshotLease>>()

  function prune(sessionID: string): void {
    const records = sessions.get(sessionID)
    for (const [id, record] of records ?? []) if (record.terminal && record.holds.size === 0) records?.delete(id)
    if (records?.size === 0) sessions.delete(sessionID)
  }

  function capture(sessionID: string, owner?: string, info?: Record<string, unknown>): RequestSnapshotLease {
    const token = Symbol(owner ?? "event")
    const records = sessions.get(sessionID)
    const captured = new Map([...records ?? []].map(([id, record]) => [id, { record, generation: record.generation }]))
    if (typeof info?.parentID === "string" && typeof info.id === "string") {
      const entry = captured.get(info.parentID)
      if (entry) {
        const created = (info.time as { created?: unknown } | undefined)?.created
        if (!entry.record.assistants.has(info.id)) entry.record.assistants.set(info.id,
          typeof created === "number" && created < entry.record.startedAt ? -1 : entry.generation)
        entry.generation = entry.record.assistants.get(info.id)!
      }
    }
    for (const { record } of captured.values()) record.holds.add(token)
    let released = false
    const lease: RequestSnapshotLease = {
      owns: (messageID) => typeof messageID === "string" && captured.has(messageID),
      bind(messageID) {
        for (const [id, { record }] of captured) {
          if (id === messageID) continue
          record.holds.delete(token)
          captured.delete(id)
        }
        prune(sessionID)
      },
      commit() {
        if (released || owner === undefined) return
        // A retry may already have re-entered chat.message before its ACK returns.
        for (const [id, { record, generation }] of captured) {
          if (sessions.get(sessionID)?.get(id) === record && record.generation === generation) continue
          record.holds.delete(token)
          captured.delete(id)
        }
        if (captured.size === 0) { lease.release(); return }
        const owners = pending.get(sessionID) ?? new Map<string, RequestSnapshotLease>()
        if (owners.get(owner) !== lease) owners.get(owner)?.release()
        owners.set(owner, lease)
        pending.set(sessionID, owners)
      },
      complete(info) {
        const id = typeof info.parentID === "string" ? info.parentID : undefined
        const entry = id ? captured.get(id) : undefined
        const time = info.time
        if (!entry || sessions.get(sessionID)?.get(id!) !== entry.record || entry.record.generation !== entry.generation) return
        if (typeof time !== "object" || time === null || !("completed" in time) || typeof time.completed !== "number") return
        if (!info.error && (typeof info.finish !== "string" || !info.finish || ["tool-calls", "unknown"].includes(info.finish))) return
        entry.record.terminal = true
      },
      remove(messageID) {
        const entry = typeof messageID === "string" ? captured.get(messageID) : undefined
        if (!entry || sessions.get(sessionID)?.get(messageID as string) !== entry.record || entry.record.generation !== entry.generation) return
        for (const pendingLease of pending.get(sessionID)?.values() ?? []) if (pendingLease.owns(messageID)) pendingLease.release()
        sessions.get(sessionID)?.delete(messageID as string)
        prune(sessionID)
      },
      release() {
        if (released) return
        released = true
        for (const { record } of captured.values()) record.holds.delete(token)
        captured.clear()
        const owners = pending.get(sessionID)
        if (owner !== undefined && owners?.get(owner) === lease) owners.delete(owner)
        if (owners?.size === 0) pending.delete(sessionID)
        prune(sessionID)
      },
    }
    return lease
  }

  return {
    set(sessionID: string, messageID: string, config: T) {
      const records = sessions.get(sessionID) ?? new Map<string, Snapshot<T>>()
      records.set(messageID, { config, generation: 0, startedAt: Date.now(), terminal: false, holds: new Set(), assistants: new Map() })
      sessions.set(sessionID, records)
    },
    get: (sessionID: string, messageID: unknown) => typeof messageID === "string" ? sessions.get(sessionID)?.get(messageID)?.config : undefined,
    resume(sessionID: string, messageID: unknown) {
      const record = typeof messageID === "string" ? sessions.get(sessionID)?.get(messageID) : undefined
      if (!record) return undefined
      record.generation++
      record.startedAt = Date.now()
      record.terminal = false
      // Ownership transfers from a queued/accepted recovery to the active request.
      for (const lease of pending.get(sessionID)?.values() ?? []) {
        if (lease.owns(messageID)) lease.release()
      }
      return record.config
    },
    capture,
    remove(sessionID: string, messageID: unknown) {
      for (const lease of pending.get(sessionID)?.values() ?? []) if (lease.owns(messageID)) lease.release()
      if (typeof messageID === "string") sessions.get(sessionID)?.delete(messageID)
      prune(sessionID)
    },
    clear(sessionID: string) {
      sessions.delete(sessionID)
      for (const lease of pending.get(sessionID)?.values() ?? []) lease.release()
      pending.delete(sessionID)
    },
    size: (sessionID: string) => sessions.get(sessionID)?.size ?? 0,
  }
}
