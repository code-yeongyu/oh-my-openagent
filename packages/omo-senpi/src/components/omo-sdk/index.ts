import { userInfo } from "node:os"

import { type AccessPorts, createAccountAccess } from "./access"
import type { AccountApi, SignInProcess } from "./account"
import type { ConfigApi } from "./config"
import type { Endpoint, OmoPrincipal, OmoSdkRoot } from "./contract"
import type { DeviceServiceApi, DeviceServiceStatusPort } from "./device-service"
import type { DevicesApi } from "./devices"
import { assembleRoot } from "./root/assemble"
import { type CoreLoaders, LAUNCHER_NAMESPACES } from "./root/members"
import { shippedNamespaces } from "./root/shipped"

export type { CredentialStorePort, SessionPort } from "./access"
export type { SignedIn, SignInOptions, SignInProcess, UserCode, WhoAmI } from "./account"
export type { ConfigStatus } from "./config"
export type { OmoSdkRoot } from "./contract"
export type { DeviceServiceStatus, DeviceServiceStatusPort } from "./device-service"
export type { LiveDevice } from "./devices"
export type { OmoError, OmoErrorCode, OmoResult } from "./result"
export type { CoreContext, CoreLoader, CoreLoaders, LauncherNamespace, NamespaceCore } from "./root/members"

export type OmoSdkPorts = AccessPorts & {
  readonly deviceServiceStatus?: DeviceServiceStatusPort
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
  /** The home the device service's state dir resolves under; absent, the user's own. */
  readonly home?: string
  /** Fixed for the root's life (security design 3); absent, a script run by this process's user. No call takes one. */
  readonly principal?: OmoPrincipal
  /** A non-default engine endpoint, by its paths only (security design 4.4, 5.6). */
  readonly endpoint?: Endpoint
  /** The cores another package supplies, each loaded on its namespace's first call (members.ts). */
  readonly cores?: CoreLoaders
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

const processUid = (): number => process.getuid?.() ?? userInfo().uid

// Architecture, not a guard (security design 2.4): a loader adds a namespace whose core this package cannot import, and a
// caller in the same process could reach any core anyway; refusing a built-in namespace keeps one core per domain.
function assertLauncherCores(cores: CoreLoaders): void {
  const builtIn = Object.keys(cores).filter((name) => !(LAUNCHER_NAMESPACES as readonly string[]).includes(name))
  if (builtIn.length > 0)
    throw new TypeError(
      `createOmoSdk: cores may only add ${LAUNCHER_NAMESPACES.join(", ")}; ${builtIn.join(", ")} ${builtIn.length === 1 ? "is" : "are"} served by the SDK itself`,
    )
}

/** The omo SDK: one root over every core (first-party design 4.1). Building it opens nothing. */
export function createOmoSdk(options: OmoSdkOptions = {}): OmoSdk {
  const given = options.env ?? process.env
  const env = options.accounts === undefined ? given : { ...given, OMO_SERVICE_ACCOUNTS_URL: options.accounts }
  const cwd = options.cwd ?? process.cwd()
  const ports = options.ports ?? {}
  const cores = options.cores ?? {}
  assertLauncherCores(cores)
  const principal = options.principal ?? { kind: "script", uid: processUid() }
  const access = createAccountAccess({ ...(options.api === undefined ? {} : { api: options.api }), env, cwd, ports })
  const shipped = shippedNamespaces({
    access,
    env,
    cwd,
    ...(options.home === undefined ? {} : { home: options.home }),
    ...(ports.signInProcess === undefined ? {} : { signInProcess: ports.signInProcess }),
    ...(ports.deviceServiceStatus === undefined ? {} : { deviceServiceStatus: ports.deviceServiceStatus }),
  })
  const root = assembleRoot([shipped], cores, {
    env,
    cwd,
    ...(options.home === undefined ? {} : { home: options.home }),
    principal,
  })
  // The shipped serving placed the shipped API objects' own functions at these keys, so the tree is that surface too.
  return root as OmoSdk
}
