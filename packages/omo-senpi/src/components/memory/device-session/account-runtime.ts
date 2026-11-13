// Sidecar entry for the signed-in device account, bundled as extensions/omo-device-account.js and imported through
// `#omo-device-account-runtime`: the CLI account (the service-auth credential store, session refresh and account read)
// on the first memory sync resolve, and the desktop memory-sync claim, Worker port and desktop account once a desktop
// launch declares memory-sync (see account-runtime-loader.ts). The npm launcher's engine entry also starts that claim
// from here before senpi's CLI loads (bin/lib/engine-boot.js), behind the same exported gate; bootClaim.ts states the
// order every entry (the desktop's included) follows.

import { sessionWorkerData } from "@code-yeongyu/senpi/session-worker-data"
import {
  connectDeviceService,
  type DeviceService,
  deviceServiceStateDir,
  forgetDeviceService,
  handDeviceKeys,
} from "@oh-my-opencode/device-service-core"
import { resolveMemoryRoot, syncPinDir } from "@oh-my-opencode/memory-core"
import {
  createCredentialStore,
  createSession,
  quietNotice,
  retireSyncPinOnDiscard,
  serviceOrigin,
} from "@oh-my-opencode/omo-opencode/service-auth"
import { createOmoNativeProductConfig } from "../../telemetry/product-identity"
import { MEMORY_SYNC_WORKER_DATA, type MemorySyncSelection } from "../desktop-sync/hostSelection"
import { launchCarriedPrivateTable } from "../desktop-sync/launchClassification"
import { workerMemorySyncSource } from "../desktop-sync/workerPort"
import { createCliAccountSource, DEFAULT_SERVICE_API } from "./account-source"
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
  connect: () => Promise<DeviceService> = () =>
    connectDeviceService({ version: createOmoNativeProductConfig().packageVersion, stateDir, background: true }),
  log?: (line: string) => void,
): HeldCredentialRelay {
  return {
    readopt: async (credential) =>
      (await handDeviceKeys({ stateDir, connect, credential, when: "not_adopted", log })) !== "not_running",
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
  return accountSourceFromSelection({
    selection,
    cli: () =>
      createCliAccountSource({
        relay: engineDeviceService(
          undefined,
          undefined,
          options.logger === undefined ? undefined : (line) => options.logger?.warn(line),
        ),
        ...options,
      }),
  })
}

/**
 * The signed-in CLI device's way into the account service outside memory sync (the thread tools' alias registry,
 * #12833): its origin and a bearer token that refreshes under the same credential lock and the same discard rules
 * (trust-pin retirement, device-service forget) as the CLI account source. A desktop launch never reads the CLI
 * credential store (account-transport-api v9 section 7.3), so there every token request is refused.
 */
export function cliServiceAccess(options: {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly cwd: string
  readonly log?: (line: string) => void
}): { readonly origin: string; readonly accessToken: () => Promise<string> } {
  const warn = (line: string): void => options.log?.(line)
  const origin = serviceOrigin(options.env["OMO_SERVICE_API_URL"] ?? DEFAULT_SERVICE_API)
  let session: ReturnType<typeof createSession> | undefined
  return {
    origin,
    accessToken: async () => {
      if (launchCarriedPrivateTable())
        throw new Error("a desktop launch uses the desktop's own sign-in, not the CLI credential store")
      session ??= createSession({
        api: origin,
        store: createCredentialStore(origin, { notice: quietNotice }),
        beforeKeysDiscarded: retireSyncPinOnDiscard({
          pinDir: () => syncPinDir(resolveMemoryRoot({ ...options.env }, options.cwd)),
          log: warn,
        }),
        deviceService: {
          adopt: async () => undefined,
          forget: () =>
            engineDeviceService(undefined, undefined, warn)
              .forget()
              .catch((error: unknown) =>
                warn(
                  `thread aliases: the device service forget failed (${error instanceof Error ? error.message : String(error)})`,
                ),
              ),
        },
      })
      return await session.accessToken()
    },
  }
}

/** A session Worker's selection: the port its host issued through senpi's session worker data, read on first use. */
export function workerMemorySyncSelection(): Promise<MemorySyncSelection> {
  return workerMemorySyncSource(sessionWorkerData(MEMORY_SYNC_WORKER_DATA))
}
