import {
  connectDeviceService,
  type DeviceService,
  deviceServiceStateDir,
  forgetDeviceService,
  handDeviceKeys,
} from "@oh-my-opencode/device-service-core"
import { resolveMemoryRoot, syncPinDir } from "@oh-my-opencode/memory-core"
import {
  type CredentialStore,
  createCredentialStore,
  createSession,
  quietNotice,
  retireSyncPinOnDiscard,
  type Session,
} from "@oh-my-opencode/omo-opencode/service-auth"
import { createOmoNativeProductConfig } from "../../telemetry/product-identity"
import type { HeldCredentialRelay } from "./account-source"

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

export const cliCredentialStore = (origin: string): CredentialStore =>
  createCredentialStore(origin, { notice: quietNotice })

/**
 * The signed-in CLI device's session for a caller inside the engine (the thread tools' alias registry, the shipped omo
 * SDK): it refreshes under the credential lock with the CLI account source's discard rules (trust-pin retirement,
 * device-service forget), and never adopts a credential into the device service.
 */
export function openCliSession(options: {
  readonly origin: string
  readonly store: CredentialStore
  readonly env: Readonly<Record<string, string | undefined>>
  readonly cwd: string
  readonly signal?: AbortSignal
  readonly log: (line: string) => void
}): Session {
  const { log } = options
  return createSession({
    api: options.origin,
    store: options.store,
    log,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    beforeKeysDiscarded: retireSyncPinOnDiscard({
      pinDir: () => syncPinDir(resolveMemoryRoot({ ...options.env }, options.cwd)),
      log,
    }),
    deviceService: {
      adopt: async () => undefined,
      forget: () =>
        engineDeviceService(undefined, undefined, log)
          .forget()
          .catch((error: unknown) =>
            log(`the device service forget failed (${error instanceof Error ? error.message : String(error)})`),
          ),
    },
  })
}
