// The registration-time half of the engine's one memory-sync selection (account-transport-api v11 section 7.3), the
// only part omo.js carries: classify the launch and provide each session Worker its port synchronously, before any
// session Worker starts. The channel claim, the Worker port proxy and the desktop account load from the
// `#omo-device-account-runtime` sidecar, and only once a desktop launch declared memory-sync or a sync resolves.
// senpi's loader aliases no private-fds subpath, so `#senpi-private-fds` is bundled: its captured table lives on a
// global symbol, so this copy reads the same claim state as the engine's own module.

import { isMainThread } from "node:worker_threads"
import { privateChannelDeclared, privateTablePresent } from "#senpi-private-fds"
import { provideSessionWorkerData, sessionWorkerData } from "@code-yeongyu/senpi/session-worker-data"
import { type HostMemorySync, type MemorySyncSelection, MEMORY_SYNC_WORKER_DATA, memorySyncWorkerData, selectHostMemorySyncSource } from "../desktop-sync/hostSelection"
import { SyncSidecarUnavailableError } from "../sync-runner"
import type { DeviceAccountSource } from "./account-source"
import type * as AccountRuntime from "./account-runtime"

export type DeviceAccountRuntimeModule = Pick<typeof AccountRuntime, "accountSourceFromSelection" | "claimInheritedDesktopSync" | "createCliAccountSource" | "serveDesktopWorker" | "workerMemorySyncSource">

const importDeviceAccountRuntime = (): Promise<DeviceAccountRuntimeModule> => import("#omo-device-account-runtime")
let memorySyncHost: HostMemorySync | undefined

/**
 * The thread's one account source: on the main thread it selects once per process and provides the Worker port; in a
 * session Worker it reads the port the host issued. The CLI credential source is built only for a CLI selection.
 */
export function selectedDeviceAccountSource(
  options: Parameters<DeviceAccountRuntimeModule["createCliAccountSource"]>[0],
  importRuntime: () => Promise<DeviceAccountRuntimeModule> = importDeviceAccountRuntime,
): DeviceAccountSource {
  let pending: Promise<DeviceAccountRuntimeModule> | undefined
  // A failed load is not cached, so the next resolve retries.
  const runtime = (): Promise<DeviceAccountRuntimeModule> => pending ??= importRuntime().catch((error: unknown) => {
    pending = undefined
    throw new SyncSidecarUnavailableError("device account", error)
  })
  let selection: () => Promise<MemorySyncSelection>
  if (isMainThread) {
    const host = memorySyncHost ?? selectHostMemorySyncSource({
      inherited: { declared: privateChannelDeclared, tablePresent: privateTablePresent },
      claim: () => runtime().then(loaded => loaded.claimInheritedDesktopSync()),
      serveDesktop: (channel, port, closed) => {
        void runtime().then(loaded => loaded.serveDesktopWorker(channel, port, closed), () => port.close())
      },
    })
    // A duplicate/late provider is a bootstrap failure, not an unavailable account.
    if (memorySyncHost === undefined) {
      provideSessionWorkerData(MEMORY_SYNC_WORKER_DATA, memorySyncWorkerData(host))
      memorySyncHost = host
    }
    selection = () => host.selection
  } else {
    const port = sessionWorkerData(MEMORY_SYNC_WORKER_DATA)
    selection = () => runtime().then(loaded => loaded.workerMemorySyncSource(port))
  }
  let source: DeviceAccountSource | undefined
  return async () => {
    const loaded = await runtime()
    source ??= loaded.accountSourceFromSelection({ selection, cli: () => loaded.createCliAccountSource(options) })
    return source()
  }
}
