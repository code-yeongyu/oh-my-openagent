import type { AliasRegistry, AliasResult, RemoteSessionsPort, RemoteThreadSurface } from "../../thread/remote/ports"
import type { RemoteClient } from "../client"
import type { R, RemoteFailure, RemoteSender } from "../types"

type Runtime = Pick<typeof import("./thread-runtime"), "remoteSessionsPort" | "remoteClient">

export type LazyRemoteOptions = {
  readonly version: string
  /** Who the surface's remote client acts as, fixed when it is built (design B2). */
  readonly sender: RemoteSender
  readonly loadRuntime: () => Promise<Runtime>
  /** The account's alias registry, loaded on its first use; absent, the surface has no registry and aliases are refused typed. */
  readonly loadAliasRegistry?: () => Promise<AliasRegistry>
  readonly permissionPreset?: () => string | undefined
}

/**
 * A remote surface whose device-service client loads on the first call that needs another device. A failed load is not
 * cached. A missing service, signed-out account or disabled relay leaves a local address miss as not_found; an explicit
 * device operation, a configured relay in any failing state (offline, connecting, keychain locked, authorization stale, degraded, update
 * required) or a failed account lookup surfaces typed unavailability.
 * The alias registry loads the same way on its first use; a load that fails answers alias_registry_unavailable and is
 * retried on the next call. `sessions.close` ends the device-service connection a short-lived caller opened.
 */
/**
 * The remote client, loaded with the runtime on its first member call. A failed load is not cached and settles as a typed
 * host_unavailable, since no member throws. The failure is written here, not through codes.ts, because codes.ts brings
 * the device-service code into omo.js.
 */
function createLazyRemoteClient(options: LazyRemoteOptions): RemoteClient {
  let client: Promise<RemoteClient> | undefined
  const load = () =>
    (client ??= options.loadRuntime().then(
      ({ remoteClient }) => remoteClient(options.version, options.sender),
      (error: unknown) => {
        client = undefined
        throw error
      },
    ))
  const unloaded = (error: unknown): RemoteFailure => ({
    kind: "error",
    code: "host_unavailable",
    message: `The remote client could not be loaded: ${error instanceof Error ? error.message : String(error)}.`,
    next_action: "Reinstall omo, then retry.",
    details: { reason: "client_unavailable" },
  })
  const call = async <T>(use: (loaded: RemoteClient) => R<T>): R<T> => {
    let loaded: RemoteClient
    try {
      loaded = await load()
    } catch (error) {
      return unloaded(error)
    }
    return await use(loaded)
  }
  // `follow` answers a stream at once, so the load happens on its first read; a stop before then ends it unread.
  const follow: RemoteClient["sessions"]["follow"] = (thread, opts) => {
    let stopped = false
    let inner: ReturnType<RemoteClient["sessions"]["follow"]> | undefined
    return {
      [Symbol.asyncIterator]: async function* () {
        let loaded: RemoteClient
        try {
          loaded = await load()
        } catch (error) {
          yield { kind: "failed" as const, failure: unloaded(error) }
          return
        }
        if (stopped) return
        inner = loaded.sessions.follow(thread, opts)
        yield* inner
      },
      stop: () => {
        stopped = true
        inner?.stop()
      },
    }
  }
  return {
    service: {
      info: (opts) => call((loaded) => loaded.service.info(opts)),
      status: (opts) => call((loaded) => loaded.service.status(opts)),
      setEnabled: (on, opts) => call((loaded) => loaded.service.setEnabled(on, opts)),
      control: (opts) => call((loaded) => loaded.service.control(opts)),
      setControl: (on, opts) => call((loaded) => loaded.service.setControl(on, opts)),
      bootstrap: (setup, opts) => call((loaded) => loaded.service.bootstrap(setup, opts)),
      wake: (opts) => call((loaded) => loaded.service.wake(opts)),
      setWake: (on, opts) => call((loaded) => loaded.service.setWake(on, opts)),
    },
    devices: {
      list: (opts) => call((loaded) => loaded.devices.list(opts)),
      resolve: (idOrName, opts) => call((loaded) => loaded.devices.resolve(idOrName, opts)),
    },
    sessions: {
      list: (filter, opts) => call((loaded) => loaded.sessions.list(filter, opts)),
      resolve: (address, scope, opts) => call((loaded) => loaded.sessions.resolve(address, scope, opts)),
      get: (thread, opts) => call((loaded) => loaded.sessions.get(thread, opts)),
      open: (request, opts) => call((loaded) => loaded.sessions.open(request, opts)),
      send: (thread, request, opts) => call((loaded) => loaded.sessions.send(thread, request, opts)),
      read: (thread, page, opts) => call((loaded) => loaded.sessions.read(thread, page, opts)),
      follow,
      wait: (thread, opts) => call((loaded) => loaded.sessions.wait(thread, opts)),
      interrupt: (thread, opts) => call((loaded) => loaded.sessions.interrupt(thread, opts)),
      setModel: (thread, model, opts) => call((loaded) => loaded.sessions.setModel(thread, model, opts)),
      setReasoning: (thread, level, opts) => call((loaded) => loaded.sessions.setReasoning(thread, level, opts)),
      close: (thread, opts) => call((loaded) => loaded.sessions.close(thread, opts)),
      archive: (thread, archived, opts) => call((loaded) => loaded.sessions.archive(thread, archived, opts)),
    },
    attach: (thread, opts) => call((loaded) => loaded.attach(thread, opts)),
    aliases: {
      resolve: (alias, opts) => call((loaded) => loaded.aliases.resolve(alias, opts)),
      set: (thread, alias, opts) => call((loaded) => loaded.aliases.set(thread, alias, opts)),
      clear: (thread, opts) => call((loaded) => loaded.aliases.clear(thread, opts)),
    },
    close: () => {
      const open = client
      client = undefined
      void open?.then(
        (loaded) => loaded.close(),
        () => undefined,
      )
    },
  }
}

export function createLazyRemoteSurface(options: LazyRemoteOptions): RemoteThreadSurface {
  const client = createLazyRemoteClient(options)
  let port: Promise<RemoteSessionsPort> | undefined
  const load = () =>
    (port ??= options.loadRuntime().then(
      ({ remoteSessionsPort }) => remoteSessionsPort(options.version),
      (error: unknown) => {
        port = undefined
        throw error
      },
    ))
  const sessions: RemoteSessionsPort = {
    status: async () => await (await load()).status(),
    thisDevice: async () => await (await load()).thisDevice(),
    devices: async () => await (await load()).devices(),
    sessions: async () => await (await load()).sessions(),
    endpointCommand: async (device, rpc, options) => await (await load()).endpointCommand(device, rpc, options),
    locate: async (device, engineId, knownKey) => await (await load()).locate(device, engineId, knownKey),
    sessionCommand: async (device, sessionId, rpc, options) =>
      await (await load()).sessionCommand(device, sessionId, rpc, options),
    read: async (device, sessionId, tail) => await (await load()).read(device, sessionId, tail),
    watch: async (device, sessionId, listener) => await (await load()).watch(device, sessionId, listener),
    close: async () => {
      client.close()
      const loaded = port
      port = undefined
      if (loaded !== undefined) await (await loaded.catch(() => undefined))?.close?.()
    },
  }
  const preset = options.permissionPreset === undefined ? {} : { permissionPreset: options.permissionPreset }
  const loadAliasRegistry = options.loadAliasRegistry
  if (loadAliasRegistry === undefined) return { sessions, client, chain: { stamp: (record) => record }, ...preset }
  let registry: Promise<AliasRegistry> | undefined
  const withRegistry = async <T>(use: (loaded: AliasRegistry) => Promise<AliasResult<T>>): Promise<AliasResult<T>> => {
    let loaded: AliasRegistry
    try {
      loaded = await (registry ??= loadAliasRegistry().catch((error: unknown) => {
        registry = undefined
        throw error
      }))
    } catch (error) {
      return {
        kind: "error",
        error: {
          code: "alias_registry_unavailable",
          message: `The account's alias registry could not be loaded: ${error instanceof Error ? error.message : String(error)}.`,
          details: { reason: "registry_unavailable" },
        },
      }
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
  return { sessions, client, aliases, chain: { stamp: (record) => record }, ...preset }
}
