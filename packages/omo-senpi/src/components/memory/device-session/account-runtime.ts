// Sidecar entry for the signed-in device account, bundled as extensions/omo-device-account.js and imported through
// `#omo-device-account-runtime`: the CLI account (the service-auth credential store, session refresh and account read)
// on the first memory sync resolve, and the desktop memory-sync claim, Worker port and desktop account once a desktop
// launch declares memory-sync (see account-runtime-loader.ts).

import { sessionWorkerData } from "@code-yeongyu/senpi/session-worker-data"
import { MEMORY_SYNC_WORKER_DATA, type MemorySyncSelection } from "../desktop-sync/hostSelection"
import { workerMemorySyncSource } from "../desktop-sync/workerPort"
import { createCliAccountSource } from "./account-source"
import type { DeviceAccountSource } from "./account-source"
import { accountSourceFromSelection } from "./selected-account-source"

export { claimInheritedDesktopSync } from "../desktop-sync/desktopClaim"
export { serveWorkerPort } from "../desktop-sync/workerPort"

/** The thread's one account source over its selection; only a CLI selection constructs the CLI credential source. */
export function selectedAccountSource(
  selection: () => Promise<MemorySyncSelection>,
  options: Parameters<typeof createCliAccountSource>[0],
): DeviceAccountSource {
  return accountSourceFromSelection({ selection, cli: () => createCliAccountSource(options) })
}

/** A session Worker's selection: the port its host issued through senpi's session worker data, read on first use. */
export function workerMemorySyncSelection(): Promise<MemorySyncSelection> {
  return workerMemorySyncSource(sessionWorkerData(MEMORY_SYNC_WORKER_DATA))
}
