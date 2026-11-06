// One memory-sync selection per engine process (account-transport-api v10 section 7.3). The main thread, which captured
// senpi's private-descriptor table, selects and claims once. Each session Worker gets its own host-issued MessagePort
// (senpi registerSessionWorkerPort): the settled outcome and every proxied request travel only on that port, and the
// host refuses a handle another port opened. Errors and missing ports are unavailable, never the CLI source.

import { isMainThread, MessageChannel, MessagePort } from "node:worker_threads"
import type { Duplex } from "node:stream"
import { z } from "zod"
import type { DesktopSyncEngineWire } from "./desktopSyncAccount"
import { DesktopSyncEvent, DesktopSyncRefused, DesktopSyncRequest, decodeSyncHandle } from "./desktopSyncProtocol"

const MEMORY_SYNC_CHANNEL = "memory-sync"
export type UnavailableReason = "private_channel_unavailable" | "platform_not_supported" | "port_absent" | "selection_failed" | "host_bootstrap_absent"

export interface InheritedPrivateChannels {
  declared(name: string): boolean
  tablePresent(): boolean
  take(name: string): Duplex | undefined
}
export type DesktopSyncAttachment =
  | { readonly kind: "connected"; readonly channel: DesktopSyncEngineWire }
  | { readonly kind: "unavailable"; readonly reason: "private_channel_unavailable" | "platform_not_supported" }
export type MemorySyncSelection =
  | { readonly kind: "cli" }
  | { readonly kind: "unavailable"; readonly reason: UnavailableReason }
  | { readonly kind: "desktop"; readonly channel: DesktopSyncEngineWire }
export interface HostMemorySync {
  readonly selection: Promise<MemorySyncSelection>
  attachWorker(port: MessagePort): void
}

export const MEMORY_SYNC_WORKER_DATA = "omo.memory-sync.v1"

/** The create() for senpi provideSessionWorkerData(MEMORY_SYNC_WORKER_DATA, ...): one private port per session Worker. */
export function memorySyncWorkerData(host: HostMemorySync): () => { value: MessagePort; transfer: readonly MessagePort[]; dispose(): void } {
  return () => {
    const { port1, port2 } = new MessageChannel()
    host.attachWorker(port1)
    return { value: port2, transfer: [port2], dispose: () => port1.close() }
  }
}

const reason = z.enum(["private_channel_unavailable", "platform_not_supported", "port_absent", "selection_failed", "host_bootstrap_absent"])
const HostToWorker = z.union([
  z.strictObject({ kind: z.literal("outcome"), outcome: z.union([z.literal("cli"), z.literal("desktop"), reason]) }),
  z.strictObject({ kind: z.literal("reply"), id: z.number().int().positive(), ok: z.boolean(), value: z.unknown().optional() }),
  z.strictObject({ kind: z.literal("event"), event: DesktopSyncEvent }),
  z.strictObject({ kind: z.literal("retired") }),
])
const WorkerToHost = z.strictObject({ kind: z.literal("request"), id: z.number().int().positive(), request: DesktopSyncRequest })
type HostToWorker = z.infer<typeof HostToWorker>

const HOST_KEY = Symbol.for("omo.memory-sync.host-selection.v10")
type HostGlobal = typeof globalThis & { [HOST_KEY]?: HostMemorySync }

/** Main thread only, memoized per process: classify the launch, claim memory-sync once, serve each Worker port. */
export function selectHostMemorySyncSource(options: {
  readonly inherited: InheritedPrivateChannels
  readonly attach: (stream: Duplex | undefined) => Promise<DesktopSyncAttachment>
  /** The bootstrap exchange bound; every present port is answered within it (v11 section 7.3). */
  readonly attachDeadlineMs?: number
}): HostMemorySync {
  if (!isMainThread) throw new Error("memory sync selection runs only in the engine's main thread")
  const host = globalThis as HostGlobal
  if (host[HOST_KEY] !== undefined) return host[HOST_KEY]
  const selection = select(options)
  const created: HostMemorySync = { selection, attachWorker: port => serveWorker(selection, port) }
  host[HOST_KEY] = created
  return created
}

async function select(options: Parameters<typeof selectHostMemorySyncSource>[0]): Promise<MemorySyncSelection> {
  try {
    const declared = options.inherited.declared(MEMORY_SYNC_CHANNEL) || options.inherited.tablePresent()
    if (!declared) return { kind: "cli" }
    const pending = options.attach(options.inherited.take(MEMORY_SYNC_CHANNEL))
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<"expired">(resolve => { timer = setTimeout(() => resolve("expired"), options.attachDeadlineMs ?? 10_000) })
    const attached = await Promise.race([pending, expired]).finally(() => clearTimeout(timer))
    if (attached === "expired") {
      // A late attachment is discarded: close it so the claimed channel cannot outlive the unavailable answer.
      void pending.then(late => { if (late.kind === "connected") late.channel.close() }, () => undefined)
      return { kind: "unavailable", reason: "private_channel_unavailable" }
    }
    return attached.kind === "connected" ? { kind: "desktop", channel: attached.channel } : attached
  } catch {
    return { kind: "unavailable", reason: "selection_failed" }
  }
}

function serveWorker(selection: Promise<MemorySyncSelection>, port: MessagePort): void {
  const owned = new Set<string>()
  let closed = false
  const post = (message: HostToWorker) => { if (!closed) port.postMessage(message) }
  let stopEvents = () => {}
  port.on("close", () => {
    closed = true
    stopEvents()
    void selection.then(settled => {
      if (settled.kind !== "desktop") return
      for (const handle of owned) {
        void settled.channel.request({ op: "operationCancel", handle })
          .finally(() => settled.channel.request({ op: "operationEnd", handle })).catch(() => undefined)
      }
      owned.clear()
    })
  })
  void selection.then(settled => {
    post({ kind: "outcome", outcome: settled.kind === "unavailable" ? settled.reason : settled.kind })
    if (settled.kind !== "desktop") return
    const channel = settled.channel
    stopEvents = channel.onEvent(event => {
      if (event.event !== "retired" && owned.has(event.handle)) post({ kind: "event", event })
    })
    if (channel.signal.aborted) post({ kind: "retired" })
    else channel.signal.addEventListener("abort", () => post({ kind: "retired" }), { once: true })
  })
  port.on("message", (raw: unknown) => {
    const parsed = WorkerToHost.safeParse(raw)
    if (!parsed.success) return
    const { id, request } = parsed.data
    void selection.then(async settled => {
      const foreign = "handle" in request && !owned.has(request.handle)
      if (settled.kind !== "desktop" || settled.channel.signal.aborted || foreign) {
        post({ kind: "reply", id, ok: false })
        return
      }
      try {
        const value = await settled.channel.request(request)
        if (request.op === "operationBegin") owned.add(decodeSyncHandle(value).handle)
        if (request.op === "operationEnd") owned.delete(request.handle)
        post({ kind: "reply", id, ok: true, value })
      } catch {
        post({ kind: "reply", id, ok: false })
      }
    })
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
