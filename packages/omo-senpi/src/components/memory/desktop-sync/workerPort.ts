// The request half of a session Worker's memory-sync port (account-transport-api v10 section 7.3): the host side
// serves a desktop selection's proxied requests and events, and the Worker side reads the outcome and proxies through
// the port. It ships in the device-account sidecar; hostSelection.ts keeps only the registration-time half in omo.js.

import { MessagePort } from "node:worker_threads"
import { z } from "zod"
import type { DesktopSyncEngineWire } from "./desktopSyncAccount"
import { DesktopSyncEvent, DesktopSyncRefused, DesktopSyncRequest, decodeSyncHandle } from "./desktopSyncProtocol"
import type { MemorySyncSelection } from "./hostSelection"

const reason = z.enum(["private_channel_unavailable", "port_absent", "selection_failed", "host_bootstrap_absent"])
const HostToWorker = z.union([
  z.strictObject({ kind: z.literal("outcome"), outcome: z.union([z.literal("cli"), z.literal("desktop"), reason]) }),
  z.strictObject({ kind: z.literal("reply"), id: z.number().int().positive(), ok: z.boolean(), value: z.unknown().optional() }),
  z.strictObject({ kind: z.literal("event"), event: DesktopSyncEvent }),
  z.strictObject({ kind: z.literal("retired") }),
])
const WorkerToHost = z.strictObject({ kind: z.literal("request"), id: z.number().int().positive(), request: DesktopSyncRequest })
type HostToWorker = z.infer<typeof HostToWorker>

/** Host side of one Worker port after a desktop outcome; `closed` aborts when the Worker's port closes. */
export function serveDesktopWorker(channel: DesktopSyncEngineWire, port: MessagePort, closed: AbortSignal): void {
  if (closed.aborted) return
  const owned = new Set<string>()
  const post = (message: HostToWorker) => { if (!closed.aborted) port.postMessage(message) }
  const stopEvents = channel.onEvent(event => {
    if (event.event !== "retired" && owned.has(event.handle)) post({ kind: "event", event })
  })
  closed.addEventListener("abort", () => {
    stopEvents()
    for (const handle of owned) {
      void channel.request({ op: "operationCancel", handle })
        .finally(() => channel.request({ op: "operationEnd", handle })).catch(() => undefined)
    }
    owned.clear()
  }, { once: true })
  if (channel.signal.aborted) post({ kind: "retired" })
  else channel.signal.addEventListener("abort", () => post({ kind: "retired" }), { once: true })
  port.on("message", (raw: unknown) => {
    const parsed = WorkerToHost.safeParse(raw)
    if (!parsed.success) return
    const { id, request } = parsed.data
    if (channel.signal.aborted || ("handle" in request && !owned.has(request.handle))) {
      post({ kind: "reply", id, ok: false })
      return
    }
    void (async () => {
      try {
        const value = await channel.request(request)
        if (request.op === "operationBegin") owned.add(decodeSyncHandle(value).handle)
        if (request.op === "operationEnd") owned.delete(request.handle)
        post({ kind: "reply", id, ok: true, value })
      } catch {
        post({ kind: "reply", id, ok: false })
      }
    })()
  })
}

/** A session Worker's view of the host selection through its own port; no port or a bad answer is unavailable. */
export function workerMemorySyncSource(value: unknown): Promise<MemorySyncSelection> {
  // No value: this Worker runtime has no host bootstrap to select for it. A non-port value is a broken handoff.
  if (value === undefined) return Promise.resolve({ kind: "unavailable", reason: "host_bootstrap_absent" })
  if (!(value instanceof MessagePort)) return Promise.resolve({ kind: "unavailable", reason: "port_absent" })
  const port = value
  const lifetime = new AbortController()
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>()
  const listeners = new Set<(event: DesktopSyncEvent) => void>()
  let next = 0
  const retire = () => {
    lifetime.abort()
    for (const waiter of pending.values()) waiter.reject(new DesktopSyncRefused())
    pending.clear()
  }
  const proxy: DesktopSyncEngineWire = {
    signal: lifetime.signal,
    request(request) {
      if (lifetime.signal.aborted) return Promise.reject(new DesktopSyncRefused())
      next += 1
      const id = next
      const reply = new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }))
      port.postMessage({ kind: "request", id, request })
      return reply
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close: retire,
  }
  return new Promise(resolve => {
    let answered = false
    port.on("close", () => {
      retire()
      if (!answered) resolve({ kind: "unavailable", reason: "port_absent" })
    })
    port.on("message", (raw: unknown) => {
      const parsed = HostToWorker.safeParse(raw)
      if (!answered) {
        answered = true
        if (!parsed.success || parsed.data.kind !== "outcome") {
          resolve({ kind: "unavailable", reason: "selection_failed" })
          return
        }
        const outcome = parsed.data.outcome
        if (outcome === "cli") resolve({ kind: "cli" })
        else if (outcome === "desktop") resolve({ kind: "desktop", channel: proxy })
        else resolve({ kind: "unavailable", reason: outcome })
        return
      }
      if (!parsed.success) return
      const message = parsed.data
      if (message.kind === "reply") {
        const waiter = pending.get(message.id)
        pending.delete(message.id)
        if (message.ok) waiter?.resolve(message.value)
        else waiter?.reject(new DesktopSyncRefused())
      } else if (message.kind === "event") {
        for (const listener of listeners) listener(message.event)
      } else if (message.kind === "retired") {
        retire()
      }
    })
  })
}
