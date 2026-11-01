// The registration-time half of the engine's one memory-sync selection (account-transport-api v11 section 7.3), the
// only part omo.js carries: classify the launch and provide each session Worker its port synchronously, before any
// session Worker starts. The channel claim, each Worker port's answer, the account source and the desktop account load
// from the `#omo-device-account-runtime` sidecar: once a launch declared memory-sync, a Worker spawns, or a sync resolves.
// senpi's CLI entry captures the private-descriptor table onto a global symbol before any extension loads (senpi#4749),
// so the launch is classified from that captured table instead of a bundled copy of senpi's capture module; only the
// sidecar's claim bundles `#senpi-private-fds`, and it reads the same global.

import { isMainThread } from "node:worker_threads"
import { provideSessionWorkerData } from "@code-yeongyu/senpi/session-worker-data"
import { type HostMemorySync, type MemorySyncSelection, MEMORY_SYNC_WORKER_DATA, selectHostMemorySyncSource } from "../desktop-sync/hostSelection"
import { launchCarriedPrivateTable } from "../desktop-sync/launchClassification"
import { SyncSidecarUnavailableError } from "../sync-runner"
import type { DeviceAccountSource } from "./account-source"
import type * as AccountRuntime from "./account-runtime"

export type DeviceAccountRuntimeModule = Pick<typeof AccountRuntime, "claimInheritedDesktopSync" | "selectedAccountSource" | "serveWorkerPort" | "workerMemorySyncSelection">

const importDeviceAccountRuntime = (): Promise<DeviceAccountRuntimeModule> => import("#omo-device-account-runtime")
let memorySyncHost: HostMemorySync | undefined

/**
 * The thread's one account source: on the main thread it selects once per process and provides the Worker port; in a
 * session Worker it reads the port the host issued. The CLI credential source is built only for a CLI selection.
 */
export function selectedDeviceAccountSource(
  options: Parameters<DeviceAccountRuntimeModule["selectedAccountSource"]>[1],
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
      declared: launchCarriedPrivateTable,
      sidecar: runtime,
    })
    // A duplicate/late provider is a bootstrap failure, not an unavailable account.
    if (memorySyncHost === undefined) {
      provideSessionWorkerData(MEMORY_SYNC_WORKER_DATA, host.workerData)
      memorySyncHost = host
    }
    selection = () => host.selection
  } else {
    selection = () => runtime().then(loaded => loaded.workerMemorySyncSelection())
  }
  let source: DeviceAccountSource | undefined
  return async () => {
    const loaded = await runtime()
    source ??= loaded.selectedAccountSource(selection, options)
    return source()
  }
}
