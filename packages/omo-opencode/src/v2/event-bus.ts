import type { Plugin } from "@opencode/plugin"
import type { V2StatusCache } from "./stores"

export type V2EventDomain = Plugin.Context["event"]

export type V2Event = V2EventDomain["subscribe"] extends (...args: never[]) => AsyncIterable<infer E>
  ? E
  : never

export type V2EventHandler = (event: V2Event) => void | Promise<void>

export interface V2EventBus {
  on(type: string, handler: V2EventHandler): () => void
  run(signal: AbortSignal): Promise<void>
}

function readSessionID(event: V2Event): string | undefined {
  const data = (event as { data?: unknown }).data
  if (typeof data !== "object" || data === null) return undefined
  const sessionID = (data as { sessionID?: unknown }).sessionID
  return typeof sessionID === "string" ? sessionID : undefined
}

function statusFromType(type: string): "busy" | "idle" | "retry" | undefined {
  if (type === "session.status") return undefined
  if (type === "session.idle") return "idle"
  if (type === "session.execution.started") return "busy"
  if (
    type === "session.execution.succeeded" ||
    type === "session.execution.failed" ||
    type === "session.execution.interrupted"
  ) {
    return "idle"
  }
  return undefined
}

export function createEventBus(event: V2EventDomain, statusCache: V2StatusCache): V2EventBus {
  const handlers = new Map<string, Set<V2EventHandler>>()
  return {
    on(type: string, handler: V2EventHandler): () => void {
      let set = handlers.get(type)
      if (!set) {
        set = new Set()
        handlers.set(type, set)
      }
      set.add(handler)
      return () => {
        set.delete(handler)
      }
    },
    async run(signal: AbortSignal): Promise<void> {
      const stream = event.subscribe({ signal })
      for await (const item of stream) {
        if (signal.aborted) break
        const type = (item as { type?: unknown }).type
        if (typeof type !== "string") continue
        if (type === "session.status") {
          const data = (item as { data?: { sessionID?: unknown; status?: { type?: unknown } } }).data
          const sessionID = typeof data?.sessionID === "string" ? data.sessionID : undefined
          const status = data?.status?.type
          if (sessionID && (status === "idle" || status === "busy" || status === "retry")) {
            statusCache.set(sessionID, status)
          }
        } else {
          const derived = statusFromType(type)
          const sessionID = readSessionID(item)
          if (derived && sessionID) statusCache.set(sessionID, derived)
        }
        const set = handlers.get(type)
        if (!set) continue
        for (const handler of [...set]) {
          await handler(item)
        }
      }
    },
  }
}
