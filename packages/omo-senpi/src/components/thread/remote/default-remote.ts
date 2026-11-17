import { createLazyRemoteSurface } from "../../remote/port/lazy-remote"
import type { RemoteSender } from "../../remote/types"
import type { SessionEntry } from "@code-yeongyu/senpi"
import type { RemoteThreadSurface } from "./ports"

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
}): RemoteThreadSurface {
  return createLazyRemoteSurface({
    version: options.version,
    sender: options.sender,
    loadRuntime: () => import("#omo-thread-client-runtime"),
    loadAliasRegistry: async () => {
      const [{ createServiceAliasRegistry }, { cliServiceAccess }] = await Promise.all([
        import("#omo-thread-client-runtime"),
        import("#omo-device-account-runtime"),
      ])
      return createServiceAliasRegistry(
        cliServiceAccess({
          env: process.env,
          cwd: process.cwd(),
          ...(options.log === undefined ? {} : { log: options.log }),
        }),
      )
    },
    ...(options.permissionPreset === undefined ? {} : { permissionPreset: options.permissionPreset }),
    // The engine this extension runs in projects the entries a paged thread_read fetched from another device the way that
    // device's engine answers get_messages; entries are senpi's own session records, as get_entries hands them over.
    loadProjector: async () => {
      const { buildSessionProjection } = await import("@code-yeongyu/senpi")
      return (entries, leafId) => buildSessionProjection(entries as unknown as SessionEntry[], leafId).entries
    },
  })
}
