import { createServiceAliasRegistry, type ServiceAccess } from "../../thread/remote/alias-registry"
import type { RemoteSessionsPort, RemoteThreadSurface } from "../../thread/remote/ports"
import { createDeviceServiceSessions } from "./device-service"
import { createLazyRemoteSurface } from "./lazy-remote"

// What the thread client sidecar (`#omo-thread-client-runtime`, live-surface.ts) takes from the remote module: the thread
// tools' port over this device's device service is built here, in L2, so no thread file opens a device-service
// connection itself (guard G1, design v8-core r2).

export const remoteSessionsPort = (version: string): RemoteSessionsPort => createDeviceServiceSessions({ version })

/**
 * The remote surface the `omo thread` CLI hands its SDK (#12833), from this sidecar's own device-service and alias clients;
 * `loadAccess` is the CLI sign-in (the device-account sidecar's `cliServiceAccess`), loaded only when an alias is used.
 * The caller closes it with `sessions.close` before it exits.
 */
export function createCliRemoteSurface(options: {
  readonly version: string
  readonly loadAccess: () => Promise<ServiceAccess>
}): RemoteThreadSurface {
  return createLazyRemoteSurface({
    version: options.version,
    loadRuntime: async () => ({ remoteSessionsPort }),
    loadAliasRegistry: async () => createServiceAliasRegistry(await options.loadAccess()),
  })
}
