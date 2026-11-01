// One memory-sync selection per engine process (account-transport-api v10 section 7.3). The main thread, which captured
// senpi's private-descriptor table, classifies the launch here and claims a declared channel once (desktopClaim.ts). Each session Worker gets its own host-issued MessagePort
// (senpi registerSessionWorkerPort): the settled outcome and every proxied request travel only on that port, and the
// host refuses a handle another port opened. Errors and missing ports are unavailable, never the CLI source.
// This module is the registration-time half in omo.js; answering a Worker's port is lazy (workerPort.ts).

import { MessageChannel, type MessagePort } from "node:worker_threads"
import type { DesktopSyncEngineWire } from "./desktopSyncAccount"

export type UnavailableReason = "private_channel_unavailable" | "port_absent" | "selection_failed" | "host_bootstrap_absent"

export type MemorySyncSelection =
  | { readonly kind: "cli" }
  | { readonly kind: "unavailable"; readonly reason: UnavailableReason }
  | { readonly kind: "desktop"; readonly channel: DesktopSyncEngineWire }
/** The lazily loaded half: the claim (desktopClaim.ts) and the answer on each Worker's port (workerPort.ts). */
export interface HostMemorySyncSidecar {
  claimInheritedDesktopSync(): Promise<MemorySyncSelection>
  serveWorkerPort(selection: Promise<MemorySyncSelection>, port: MessagePort, closed: AbortSignal): void
}
/** One session Worker's memory-sync value for senpi provideSessionWorkerData: a private port, transferred. */
export interface MemorySyncWorkerData { readonly value: MessagePort; readonly transfer: readonly MessagePort[]; dispose(): void }
export interface HostMemorySync {
  readonly selection: Promise<MemorySyncSelection>
  /** The create() for senpi provideSessionWorkerData(MEMORY_SYNC_WORKER_DATA, ...): one private port per session Worker. */
  readonly workerData: () => MemorySyncWorkerData
}

export const MEMORY_SYNC_CHANNEL = "memory-sync"
export const MEMORY_SYNC_WORKER_DATA = "omo.memory-sync.v1"

const HOST_KEY = Symbol.for("omo.memory-sync.host-selection.v10")
type HostGlobal = typeof globalThis & { [HOST_KEY]?: HostMemorySync }

/** Main thread only (the caller's guard), memoized per process: classify the launch, claim memory-sync once. */
export function selectHostMemorySyncSource(options: {
  /** The launch declared memory-sync or carried a private-descriptor table at all; a throw is selection_failed. */
  readonly declared: () => boolean
  /** Loaded only for a declared launch's claim or a Worker's port; a failed load is selection_failed or a closed port. */
  readonly sidecar: () => Promise<HostMemorySyncSidecar>
}): HostMemorySync {
  const host = globalThis as HostGlobal
  if (host[HOST_KEY] !== undefined) return host[HOST_KEY]
  const selection = select(options)
  const created: HostMemorySync = {
    selection,
    workerData: () => {
      const { port1, port2 } = new MessageChannel()
      // Watch the close now: the lazily loaded answer must not miss a Worker that already exited.
      const closed = new AbortController()
      port1.once("close", () => closed.abort())
      // A sidecar that cannot load closes the port: the Worker reads port_absent, never the CLI source.
      void options.sidecar().then(loaded => loaded.serveWorkerPort(selection, port1, closed.signal), () => port1.close())
      return { value: port2, transfer: [port2], dispose: () => port1.close() }
    },
  }
  host[HOST_KEY] = created
  return created
}

async function select(options: Parameters<typeof selectHostMemorySyncSource>[0]): Promise<MemorySyncSelection> {
  try {
    return options.declared() ? await (await options.sidecar()).claimInheritedDesktopSync() : { kind: "cli" }
  } catch {
    return { kind: "unavailable", reason: "selection_failed" }
  }
}
