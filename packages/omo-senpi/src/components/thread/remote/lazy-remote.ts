import type { AliasRegistry, AliasResult, RemoteSessionsPort, RemoteThreadSurface } from "./ports"

type Runtime = Pick<typeof import("./device-service"), "createDeviceServiceSessions">

export type LazyRemoteOptions = {
  readonly version: string
  readonly loadRuntime: () => Promise<Runtime>
  /** The account's alias registry, loaded on its first use; absent, the surface has no registry and aliases are refused typed. */
  readonly loadAliasRegistry?: () => Promise<AliasRegistry>
}

/**
 * A remote surface whose device-service client loads on the first call that needs another device. A failed load is not
 * cached and surfaces as the tools' typed host_unavailable, so a device without the service keeps today's local behavior.
 * The alias registry loads the same way on its first use; a load that fails answers alias_registry_unavailable and is
 * retried on the next call. `sessions.close` ends the device-service connection a short-lived caller opened.
 */
export function createLazyRemoteSurface(options: LazyRemoteOptions): RemoteThreadSurface {
  let port: Promise<RemoteSessionsPort> | undefined
  const load = () => port ??= options.loadRuntime().then(
    ({ createDeviceServiceSessions }) => createDeviceServiceSessions({ version: options.version }),
    (error: unknown) => { port = undefined; throw error },
  )
  const sessions: RemoteSessionsPort = {
    status: async () => await (await load()).status(),
    thisDevice: async () => await (await load()).thisDevice(),
    devices: async () => await (await load()).devices(),
    sessions: async () => await (await load()).sessions(),
    endpointCommand: async (device, rpc, options) => await (await load()).endpointCommand(device, rpc, options),
    locate: async (device, engineId, knownKey) => await (await load()).locate(device, engineId, knownKey),
    sessionCommand: async (device, sessionId, rpc, options) => await (await load()).sessionCommand(device, sessionId, rpc, options),
    read: async (device, sessionId, tail) => await (await load()).read(device, sessionId, tail),
    watch: async (device, sessionId, listener) => await (await load()).watch(device, sessionId, listener),
    close: async () => {
      const loaded = port
      port = undefined
      if (loaded !== undefined) await (await loaded.catch(() => undefined))?.close?.()
    },
  }
  const loadAliasRegistry = options.loadAliasRegistry
  if (loadAliasRegistry === undefined) return { sessions, chain: { stamp: (record) => record } }
  let registry: Promise<AliasRegistry> | undefined
  const withRegistry = async <T>(use: (loaded: AliasRegistry) => Promise<AliasResult<T>>): Promise<AliasResult<T>> => {
    let loaded: AliasRegistry
    try {
      loaded = await (registry ??= loadAliasRegistry().catch((error: unknown) => { registry = undefined; throw error }))
    } catch (error) {
      return { kind: "error", error: { code: "alias_registry_unavailable", message: `The account's alias registry could not be loaded: ${error instanceof Error ? error.message : String(error)}.`, details: { reason: "registry_unavailable" } } }
    }
    return await use(loaded)
  }
  const aliases: AliasRegistry = {
    claim: async (input) => await withRegistry((loaded) => loaded.claim(input)),
    rename: async (input) => await withRegistry((loaded) => loaded.rename(input)),
    release: async (input) => await withRegistry((loaded) => loaded.release(input)),
    resolve: async (alias) => await withRegistry((loaded) => loaded.resolve(alias)),
    aliasesOf: async (sessionIds) => await withRegistry((loaded) => loaded.aliasesOf(sessionIds)),
  }
  return { sessions, aliases, chain: { stamp: (record) => record } }
}
