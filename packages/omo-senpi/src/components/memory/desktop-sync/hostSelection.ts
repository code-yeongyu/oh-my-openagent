// One memory-sync selection per engine process (account-transport-api v10 section 7.3). The main thread, which captured
// senpi's private-descriptor table, classifies the launch here and claims a declared channel once (desktopClaim.ts). Each session Worker gets its own host-issued MessagePort
// (senpi registerSessionWorkerPort): the settled outcome and every proxied request travel only on that port, and the
// host refuses a handle another port opened. Errors and missing ports are unavailable, never the CLI source.

import { isMainThread, MessageChannel, type MessagePort } from "node:worker_threads"
import type { DesktopSyncEngineWire } from "./desktopSyncAccount"

export type UnavailableReason = "private_channel_unavailable" | "platform_not_supported" | "port_absent" | "selection_failed" | "host_bootstrap_absent"

export interface InheritedPrivateChannels {
  declared(name: string): boolean
  tablePresent(): boolean
}
export type MemorySyncSelection =
  | { readonly kind: "cli" }
  | { readonly kind: "unavailable"; readonly reason: UnavailableReason }
  | { readonly kind: "desktop"; readonly channel: DesktopSyncEngineWire }
/** Serves one session Worker's port once the selection is desktop: proxied requests and events (workerPort.ts, lazy). */
export type ServeDesktopWorker = (channel: DesktopSyncEngineWire, port: MessagePort, closed: AbortSignal) => void
export interface HostMemorySync {
  readonly selection: Promise<MemorySyncSelection>
  attachWorker(port: MessagePort): void
}

export const MEMORY_SYNC_CHANNEL = "memory-sync"
export const MEMORY_SYNC_WORKER_DATA = "omo.memory-sync.v1"

/** The create() for senpi provideSessionWorkerData(MEMORY_SYNC_WORKER_DATA, ...): one private port per session Worker. */
export function memorySyncWorkerData(host: HostMemorySync): () => { value: MessagePort; transfer: readonly MessagePort[]; dispose(): void } {
  return () => {
    const { port1, port2 } = new MessageChannel()
    host.attachWorker(port1)
    return { value: port2, transfer: [port2], dispose: () => port1.close() }
  }
}

const HOST_KEY = Symbol.for("omo.memory-sync.host-selection.v10")
type HostGlobal = typeof globalThis & { [HOST_KEY]?: HostMemorySync }

/** Main thread only, memoized per process: classify the launch, claim memory-sync once, serve each Worker port. */
export function selectHostMemorySyncSource(options: {
  readonly inherited: InheritedPrivateChannels
  /** A declared launch's claim of memory-sync (desktopClaim.ts, lazy); a throw is selection_failed. */
  readonly claim: () => Promise<MemorySyncSelection>
  readonly serveDesktop: ServeDesktopWorker
}): HostMemorySync {
  if (!isMainThread) throw new Error("memory sync selection runs only in the engine's main thread")
  const host = globalThis as HostGlobal
  if (host[HOST_KEY] !== undefined) return host[HOST_KEY]
  const selection = select(options)
  const created: HostMemorySync = { selection, attachWorker: port => serveWorker(selection, port, options.serveDesktop) }
  host[HOST_KEY] = created
  return created
}

async function select(options: Parameters<typeof selectHostMemorySyncSource>[0]): Promise<MemorySyncSelection> {
  try {
    const declared = options.inherited.declared(MEMORY_SYNC_CHANNEL) || options.inherited.tablePresent()
    return declared ? await options.claim() : { kind: "cli" }
  } catch {
    return { kind: "unavailable", reason: "selection_failed" }
  }
}

/** Every port hears the outcome; only a desktop selection loads the request proxy, so a CLI host never imports it. */
function serveWorker(selection: Promise<MemorySyncSelection>, port: MessagePort, serveDesktop: ServeDesktopWorker): void {
  const closed = new AbortController()
  port.once("close", () => closed.abort())
  void selection.then(settled => {
    if (closed.signal.aborted) return
    port.postMessage({ kind: "outcome", outcome: settled.kind === "unavailable" ? settled.reason : settled.kind })
    if (settled.kind === "desktop") serveDesktop(settled.channel, port, closed.signal)
  })
}
