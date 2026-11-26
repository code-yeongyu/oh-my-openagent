import { createLazyRemoteSurface } from "../../remote/port/lazy-remote"
import type { RemoteSender } from "../../remote/types"
import type { AliasRegistry, RemoteThreadSurface, SessionProjector } from "./ports"

type SignIn = {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly cwd: string
  readonly log?: (line: string) => void
}

/** The account's alias registry over the CLI sign-in, from the thread client and device-account sidecars. */
async function loadServiceAliasRegistry(signIn: SignIn): Promise<AliasRegistry> {
  const [{ createServiceAliasRegistry }, { cliServiceAccess }] = await Promise.all([
    import("#omo-thread-client-runtime"),
    import("#omo-device-account-runtime"),
  ])
  return createServiceAliasRegistry(cliServiceAccess(signIn))
}

/**
 * The remote surface every launch builds (on by default): the device-service client and the alias registry client ship
 * in the thread client sidecar (`#omo-thread-client-runtime`), the CLI sign-in in the device-account sidecar
 * (`#omo-device-account-runtime`), and both load on first use, so `omo.js` carries none of them.
 */
export function createDefaultRemoteSurface(options: {
  readonly version: string
  readonly sender: RemoteSender
  readonly log?: (line: string) => void
  readonly permissionPreset?: () => string | undefined
  /** The engine's own projector (`senpi-projector.ts`), passed in so this module, which the thread SDK also imports, loads no senpi. */
  readonly loadProjector?: () => Promise<SessionProjector>
}): RemoteThreadSurface {
  return createLazyRemoteSurface({
    version: options.version,
    sender: options.sender,
    loadRuntime: () => import("#omo-thread-client-runtime"),
    loadAliasRegistry: () =>
      loadServiceAliasRegistry({
        env: process.env,
        cwd: process.cwd(),
        ...(options.log === undefined ? {} : { log: options.log }),
      }),
    ...(options.permissionPreset === undefined ? {} : { permissionPreset: options.permissionPreset }),
    ...(options.loadProjector === undefined ? {} : { loadProjector: options.loadProjector }),
  })
}

/**
 * The account surface of a thread SDK whose caller passed none (#14616): this device's device service and the account's
 * alias registry, each loaded from the plugin's sidecars on its first use, so a script that only reads this device's
 * threads loads neither. Without it a script saw only its own daemon and read another device's live thread as not_found.
 */
export function createAccountRemoteSurface(
  options: SignIn & { readonly version: string; readonly sender: RemoteSender },
): RemoteThreadSurface {
  const { version, sender, ...signIn } = options
  return createLazyRemoteSurface({
    version,
    sender,
    loadRuntime: () => import("#omo-thread-client-runtime"),
    loadAliasRegistry: () => loadServiceAliasRegistry(signIn),
  })
}
