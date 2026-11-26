import { userInfo } from "node:os"

import { createAccountAccess } from "./access"
import type { OmoSdk, OmoSdkOptions } from "./options"
import { assembleRoot } from "./root/assemble"
import { boundaryRefusals } from "./root/authority"
import { type CoreLoaders, LAUNCHER_NAMESPACES } from "./root/members"
import { shippedNamespaces } from "./root/shipped"
import type { ThreadsRuntime } from "./root/thread-runtime-file"
import { threadsServing } from "./thread-assembly"

/** What only the entry that ships the launcher library sets; never part of the public options (design 4.1). */
export type OmoSdkAssembly = {
  readonly cores?: CoreLoaders
  /** Loads the thread runtime file; absent, its import-map specifier. The non-disclosure scan drives its failures. */
  readonly loadThreadsRuntime?: () => Promise<ThreadsRuntime>
}

const processUid = (): number => process.getuid?.() ?? userInfo().uid

/** Launcher-side cores are the shipping entry's to set; a caller's own value is not taken by any public entry. */
export function refuseCallerCores(options: object): void {
  if (Object.hasOwn(options, "cores"))
    throw new TypeError("createOmoSdk: cores is set by the entry that ships the launcher library, not by a caller")
}

// Architecture, not a guard (security design 2.4): a loader adds a namespace whose core this package cannot import, and a
// caller in the same process could reach any core anyway; refusing a built-in namespace keeps one core per domain.
function assertLauncherCores(cores: CoreLoaders): void {
  const builtIn = Object.keys(cores).filter((name) => !(LAUNCHER_NAMESPACES as readonly string[]).includes(name))
  if (builtIn.length > 0)
    throw new TypeError(
      `createOmoSdk: cores may only add ${LAUNCHER_NAMESPACES.join(", ")}; ${builtIn.join(", ")} ${builtIn.length === 1 ? "is" : "are"} served by the SDK itself`,
    )
}

/** The root over this package's cores and the launcher-side cores the shipping entry supplies. Building it opens nothing. */
export function assembleOmoSdk(options: OmoSdkOptions, assembly: OmoSdkAssembly): OmoSdk {
  const given = options.env ?? process.env
  const env = options.accounts === undefined ? given : { ...given, OMO_SERVICE_ACCOUNTS_URL: options.accounts }
  const cwd = options.cwd ?? process.cwd()
  const ports = options.ports ?? {}
  const cores = assembly.cores ?? {}
  assertLauncherCores(cores)
  const principal = options.principal ?? { kind: "script", uid: options.uid ?? processUid() }
  const access = createAccountAccess({ ...(options.api === undefined ? {} : { api: options.api }), env, cwd, ports })
  const shipped = shippedNamespaces({
    access,
    env,
    cwd,
    ...(options.home === undefined ? {} : { home: options.home }),
    ...(ports.signInProcess === undefined ? {} : { signInProcess: ports.signInProcess }),
    ...(ports.deviceServiceStatus === undefined ? {} : { deviceServiceStatus: ports.deviceServiceStatus }),
  })
  const threads = threadsServing(options, env, cwd, principal, true, assembly.loadThreadsRuntime)
  const root = assembleRoot(
    [shipped, threads],
    cores,
    {
      env,
      cwd,
      ...(options.home === undefined ? {} : { home: options.home }),
      principal,
    },
    boundaryRefusals(principal, options),
  )
  // The shipped serving placed the shipped API objects' own functions at these keys, so the tree is that surface too.
  return root as OmoSdk
}
