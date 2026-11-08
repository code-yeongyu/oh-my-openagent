import { createLazyRemoteSurface } from "./lazy-remote"
import type { RemoteThreadSurface } from "./ports"

/**
 * The remote surface every launch builds (on by default): the device-service client and the alias registry client ship
 * in the thread client sidecar (`#omo-thread-client-runtime`), the CLI sign-in in the device-account sidecar
 * (`#omo-device-account-runtime`), and both load on first use, so `omo.js` carries none of them.
 */
export function createDefaultRemoteSurface(options: { readonly version: string; readonly log?: (line: string) => void }): RemoteThreadSurface {
  return createLazyRemoteSurface({
    version: options.version,
    loadRuntime: () => import("#omo-thread-client-runtime"),
    loadAliasRegistry: async () => {
      const [{ createServiceAliasRegistry }, { cliServiceAccess }] = await Promise.all([import("#omo-thread-client-runtime"), import("#omo-device-account-runtime")])
      return createServiceAliasRegistry(cliServiceAccess({ env: process.env, cwd: process.cwd(), ...(options.log === undefined ? {} : { log: options.log }) }))
    },
  })
}
