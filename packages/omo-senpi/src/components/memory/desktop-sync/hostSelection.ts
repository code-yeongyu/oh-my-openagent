// One memory-sync selection per engine process (account-transport-api v9 section 7.3). The main thread, which captured
// senpi's private-descriptor table, selects and claims once; session Workers only receive the outcome and reach the
// one desktop channel through the main thread. No answer from the main thread is unavailable, never the CLI source.

import { BroadcastChannel, isMainThread } from "node:worker_threads"
import type { Duplex } from "node:stream"
import type { DesktopSyncEngineWire } from "./desktopSyncAccount"
import { DesktopSyncRefused, type DesktopSyncEvent, type DesktopSyncRequest } from "./desktopSyncProtocol"

export const MEMORY_SYNC_CHANNEL = "memory-sync"
export type UnavailableReason = "private_channel_unavailable" | "platform_not_supported"

export interface InheritedPrivateChannels {
  declared(name: string): boolean
  tablePresent(): boolean
  take(name: string): Duplex | undefined
}
export type DesktopSyncAttachment =
  | { readonly kind: "connected"; readonly channel: DesktopSyncEngineWire }
  | { readonly kind: "unavailable"; readonly reason: UnavailableReason }
export type MemorySyncSelection =
  | { readonly kind: "cli" }
  | { readonly kind: "unavailable"; readonly reason: UnavailableReason }
  | { readonly kind: "desktop"; readonly channel: DesktopSyncEngineWire }

type Wire =
  | { readonly kind: "ask"; readonly id: string }
  | { readonly kind: "outcome"; readonly id: string; readonly outcome: "cli" | "desktop" | UnavailableReason }
  | { readonly kind: "request"; readonly id: string; readonly request: DesktopSyncRequest }
  | { readonly kind: "reply"; readonly id: string; readonly ok: boolean; readonly value?: unknown }
  | { readonly kind: "event"; readonly event: DesktopSyncEvent }
  | { readonly kind: "retired" }

const busName = () => `omo-memory-sync-source-v1-${process.pid}`
const HOST_KEY = Symbol.for("omo.memory-sync.host-selection.v1")
type HostGlobal = typeof globalThis & { [HOST_KEY]?: Promise<MemorySyncSelection> }

/** Main thread only: classify the launch, claim memory-sync once, and serve the outcome to session Workers. */
export function selectHostMemorySync(options: {
  readonly inherited: InheritedPrivateChannels
  readonly attach: (stream: Duplex | undefined) => Promise<DesktopSyncAttachment>
}): Promise<MemorySyncSelection> {
  if (!isMainThread) throw new Error("memory sync selection runs only in the engine's main thread")
  const host = globalThis as HostGlobal
  host[HOST_KEY] ??= select(options).then(selection => {
    serve(selection)
    return selection
  })
  return host[HOST_KEY]
}

async function select(options: Parameters<typeof selectHostMemorySync>[0]): Promise<MemorySyncSelection> {
  const declared = options.inherited.declared(MEMORY_SYNC_CHANNEL) || options.inherited.tablePresent()
  if (!declared) return { kind: "cli" }
  const attached = await options.attach(options.inherited.take(MEMORY_SYNC_CHANNEL))
  return attached.kind === "connected" ? { kind: "desktop", channel: attached.channel } : attached
}

function serve(selection: MemorySyncSelection): void {
  const bus = new BroadcastChannel(busName())
  bus.unref()
  const post = (message: Wire) => bus.postMessage(message)
  const outcome = selection.kind === "unavailable" ? selection.reason : selection.kind
  if (selection.kind === "desktop") {
    const channel = selection.channel
    channel.onEvent(event => post({ kind: "event", event }))
    if (channel.signal.aborted) post({ kind: "retired" })
    else channel.signal.addEventListener("abort", () => post({ kind: "retired" }), { once: true })
  }
  bus.onmessage = (event: { readonly data: unknown }) => {
    const message = event.data as Wire
    if (message.kind === "ask") post({ kind: "outcome", id: message.id, outcome })
    if (message.kind !== "request") return
    if (selection.kind !== "desktop" || selection.channel.signal.aborted) {
      post({ kind: "reply", id: message.id, ok: false })
      return
    }
    selection.channel.request(message.request).then(
      value => post({ kind: "reply", id: message.id, ok: true, value }),
      () => post({ kind: "reply", id: message.id, ok: false }),
    )
  }
}

/** A session Worker's view of the host selection; a host that never answers is unavailable. */
export function workerMemorySync(waitMs = 5_000): Promise<MemorySyncSelection> {
  const bus = new BroadcastChannel(busName())
  bus.unref()
  const ask = crypto.randomUUID()
  const lifetime = new AbortController()
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void }>()
  const listeners = new Set<(event: DesktopSyncEvent) => void>()
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({ kind: "unavailable", reason: "private_channel_unavailable" }), waitMs)
    bus.onmessage = (event: { readonly data: unknown }) => {
      const message = event.data as Wire
      switch (message.kind) {
        case "outcome": {
          if (message.id !== ask) return
          clearTimeout(timer)
          if (message.outcome === "cli") resolve({ kind: "cli" })
          else if (message.outcome === "desktop") resolve({ kind: "desktop", channel: proxy() })
          else resolve({ kind: "unavailable", reason: message.outcome })
          return
        }
        case "reply": {
          const waiter = pending.get(message.id)
          if (waiter === undefined) return
          pending.delete(message.id)
          if (message.ok) waiter.resolve(message.value)
          else waiter.reject(new DesktopSyncRefused())
          return
        }
        case "event":
          for (const listener of listeners) listener(message.event)
          return
        case "retired":
          lifetime.abort()
          for (const waiter of pending.values()) waiter.reject(new DesktopSyncRefused())
          pending.clear()
          return
        default:
          return
      }
    }
    bus.postMessage({ kind: "ask", id: ask } satisfies Wire)
  })

  function proxy(): DesktopSyncEngineWire {
    return {
      signal: lifetime.signal,
      request(request) {
        if (lifetime.signal.aborted) return Promise.reject(new DesktopSyncRefused())
        const id = crypto.randomUUID()
        const reply = new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }))
        bus.postMessage({ kind: "request", id, request } satisfies Wire)
        return reply
      },
      onEvent(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      close() {
        lifetime.abort()
      },
    }
  }
}
