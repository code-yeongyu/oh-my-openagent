// Sidecar entry for the signed-in device account, bundled as extensions/omo-device-account.js and imported through
// `#omo-device-account-runtime`: the CLI account (the service-auth credential store, session refresh and account read)
// on the first memory sync resolve, and the desktop memory-sync claim, Worker port and desktop account once a desktop
// launch declares memory-sync (see account-runtime-loader.ts). The npm launcher's engine entry also starts that claim
// from here before senpi's CLI loads (bin/lib/engine-boot.js), behind the same exported gate; bootClaim.ts states the
// order every entry (the desktop's included) follows.

import { sessionWorkerData } from "@code-yeongyu/senpi/session-worker-data"
import { connectDeviceService, type DeviceService, deviceServiceStateDir, forgetDeviceService, handDeviceKeys } from "@oh-my-opencode/device-service-core"
import { createOmoNativeProductConfig } from "../../telemetry/product-identity"
import { MEMORY_SYNC_WORKER_DATA, type MemorySyncSelection } from "../desktop-sync/hostSelection"
import { workerMemorySyncSource } from "../desktop-sync/workerPort"
import { createCliAccountSource } from "./account-source"
import type { DeviceAccountSource, HeldCredentialRelay } from "./account-source"
import { accountSourceFromSelection } from "./selected-account-source"

export { claimMemorySyncAtBoot } from "../desktop-sync/bootClaim"
export { claimsMemorySyncAtBoot } from "../desktop-sync/bootGate"
export { claimInheritedDesktopSync } from "../desktop-sync/desktopClaim"
export { serveWorkerPort } from "../desktop-sync/workerPort"

/**
 * This machine's running device service (never installed or started from here): the re-adopt from the memory device
 * session's held credential, and forget when the service ends the sign-in (design D r9 section 3).
 */
export function engineDeviceService(
  stateDir: string = deviceServiceStateDir(),
  connect: () => Promise<DeviceService> = () => connectDeviceService({ version: createOmoNativeProductConfig().packageVersion, stateDir, background: true }),
  log?: (line: string) => void,
): HeldCredentialRelay {
  return {
    readopt: async credential => (await handDeviceKeys({ stateDir, connect, credential, when: "not_adopted", log })) !== "not_running",
    forget: async () => {
      await forgetDeviceService({ stateDir, connect, log })
    },
  }
}

/** The thread's one account source over its selection; only a CLI selection constructs the CLI credential source. */
export function selectedAccountSource(
  selection: () => Promise<MemorySyncSelection>,
  options: Parameters<typeof createCliAccountSource>[0],
): DeviceAccountSource {
  return accountSourceFromSelection({ selection, cli: () => createCliAccountSource({ relay: engineDeviceService(undefined, undefined, options.logger === undefined ? undefined : line => options.logger?.warn(line)), ...options }) })
}

/** A session Worker's selection: the port its host issued through senpi's session worker data, read on first use. */
export function workerMemorySyncSelection(): Promise<MemorySyncSelection> {
  return workerMemorySyncSource(sessionWorkerData(MEMORY_SYNC_WORKER_DATA))
}
