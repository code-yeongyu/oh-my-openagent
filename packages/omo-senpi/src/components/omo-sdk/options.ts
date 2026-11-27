import type { AccessPorts } from "./access"
import type { AccountApi, SignInProcess } from "./account"
import type { ConfigApi } from "./config"
import type { Endpoint, OmoPrincipal, OmoSdkRoot } from "./contract"
import type { DeviceServiceApi, DeviceServiceStatusPort } from "./device-service"
import type { DeviceListing, DevicesApi } from "./devices"
import type { ThreadNamespaceOptions, ThreadPorts } from "./root/threads"

export type OmoSdkPorts = AccessPorts &
  ThreadPorts & {
    readonly deviceServiceStatus?: DeviceServiceStatusPort
    /** The clock of devices.list's device-service client; absent, real timers. */
    readonly remoteTimers?: DeviceListing["timers"]
    /** Runs `omo account sign-in`; absent, the omo launcher this engine was started from (`OMO_BIN`). */
    readonly signInProcess?: SignInProcess
  }

export type OmoSdkOptions = {
  /** The account service origin; else `OMO_SERVICE_API_URL` from `env`, else the production API. */
  readonly api?: string
  /** The sign-in page origin; else `OMO_SERVICE_ACCOUNTS_URL` from `env`, else production. */
  readonly accounts?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly cwd?: string
  /** The agent state the thread calls read; absent, the canonical one the omo launcher uses. */
  readonly agentDir?: string
  /** The OS user the thread calls act as; absent, this process's. */
  readonly uid?: number
  readonly user?: string
  readonly threads?: ThreadNamespaceOptions
  /** The home the device service's state dir resolves under; absent, the user's own. */
  readonly home?: string
  /** Fixed for the root's life (security design 3); absent, a script run by this process's user. No call takes one. */
  readonly principal?: OmoPrincipal
  /** A non-default engine endpoint, by its paths only (security design 4.4, 5.6). */
  readonly endpoint?: Endpoint
  readonly ports?: OmoSdkPorts
}

/** The surface `OMO_SDK_ROOT` shipped, with its own result types; its signatures come first, so they keep resolving. */
export type ShippedOmoSdk = {
  readonly account: AccountApi
  readonly devices: DevicesApi
  readonly deviceService: DeviceServiceApi
  readonly config: ConfigApi
  /** Aborts requests in flight; later account and device calls answer `internal_error`. */
  readonly close: () => void
}

/** The root is this entry, extended (design 4.1): the shipped surface, then every call of the root type. */
export type OmoSdk = ShippedOmoSdk & OmoSdkRoot
