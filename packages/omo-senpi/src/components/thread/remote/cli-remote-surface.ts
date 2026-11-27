import { remoteClient, remoteSessionsPort } from "../../remote/index"
import { createLazyRemoteSurface } from "../../remote/lazy"
import { createServiceAliasRegistry, type ServiceAccess } from "./alias-registry"
import type { RemoteThreadSurface } from "./ports"

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
    // The `omo thread` CLI's principal is `cli:<uid>` (sdk.ts), the uid omo-native's thread.js names.
    sender: { kind: "cli", uid: String(process.getuid?.() ?? 0) },
    loadRuntime: async () => ({ remoteSessionsPort, remoteClient }),
    loadAliasRegistry: async () => createServiceAliasRegistry(await options.loadAccess()),
  })
}
