import type { AliasRegistry, AliasResult, RemoteSessionsPort, RemoteThreadSurface } from "../../thread/remote/ports"
import type { RemoteClient } from "../client"
import type { RemoteFailure, RemoteSender } from "../types"

type Runtime = Pick<typeof import("./thread-runtime"), "remoteSessionsPort" | "remoteClient">

export type LazyRemoteOptions = {
  readonly version: string
  /** Who the surface's remote client acts as, fixed when it is built (design B2). */
  readonly sender: RemoteSender
  readonly loadRuntime: () => Promise<Runtime>
  /** The account's alias registry, loaded on its first use; absent, the surface has no registry and aliases are refused typed. */
  readonly loadAliasRegistry?: () => Promise<AliasRegistry>
  readonly permissionPreset?: () => string | undefined
  readonly loadProjector?: RemoteThreadSurface["loadProjector"]
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
 * host_unavailable, since no member throws. Every member forwards by name, so this stays small inside omo.js (its byte
 * budget) and needs no change when the client gains a member; `sessions.follow` answers a stream at once and starts the load
 * when called, even if the stream is never read.
 */
function createLazyRemoteClient(options: LazyRemoteOptions): {
  readonly client: RemoteClient
  readonly loaded: () => Promise<RemoteClient>
} {
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
  type Member = (...args: unknown[]) => unknown
  const forward =
    (pick: (loaded: RemoteClient) => Member) =>
    (...args: unknown[]) =>
      load().then((loaded) => pick(loaded)(...args), unloaded)
  // A group is not a thenable and has no symbol members, so awaiting or inspecting one never reaches the loader.
  const group = (name: "service" | "devices" | "sessions" | "aliases") =>
    new Proxy(
      {},
      {
        get: (_, member) =>
          typeof member !== "string" || member === "then"
            ? undefined
            : name === "sessions" && member === "follow"
              ? follow
              : forward((loaded) => (loaded[name] as unknown as Record<string, Member>)[member] as Member),
      },
    )
  const follow: RemoteClient["sessions"]["follow"] = (thread, opts) => {
    const opened = load().then((loaded) => loaded.sessions.follow(thread, opts))
    // Read or not, a failed load is answered on the stream, never as an unhandled rejection.
    opened.catch(() => undefined)
    return {
      [Symbol.asyncIterator]: async function* () {
        let stream: ReturnType<RemoteClient["sessions"]["follow"]>
        try {
          stream = await opened
        } catch (error) {
          yield { kind: "failed" as const, failure: unloaded(error) }
          return
        }
        yield* stream
      },
      stop: () =>
        void opened.then(
          (stream) => stream.stop(),
          () => undefined,
        ),
    }
  }
  const lazy = {
    service: group("service"),
    devices: group("devices"),
    sessions: group("sessions"),
    attach: forward((loaded) => loaded.attach as Member),
    aliases: group("aliases"),
    close: () => {
      const open = client
      client = undefined
      void open?.then(
        (loaded) => loaded.close(),
        () => undefined,
      )
    },
  } as unknown as RemoteClient
  return { client: lazy, loaded: load }
}

export function createLazyRemoteSurface(options: LazyRemoteOptions): RemoteThreadSurface {
  // One runtime load serves the client and the port (the port rides the client's connection); a failed load is not kept.
  let runtime: ReturnType<LazyRemoteOptions["loadRuntime"]> | undefined
  const loadRuntime: LazyRemoteOptions["loadRuntime"] = () =>
    (runtime ??= options.loadRuntime().catch((error: unknown) => {
      runtime = undefined
      throw error
    }))
  const { client, loaded } = createLazyRemoteClient({ ...options, loadRuntime })
  let port: Promise<RemoteSessionsPort> | undefined
  const load = () =>
    (port ??= loadRuntime()
      .then(async ({ remoteSessionsPort }) => remoteSessionsPort(options.version, await loaded()))
      .catch((error: unknown) => {
        // Any failed load, the client's or the port factory's included, is not kept.
        port = undefined
        throw error
      }))
  const sessions: RemoteSessionsPort = {
    status: async () => await (await load()).status(),
    thisDevice: async () => await (await load()).thisDevice(),
    thisDeviceName: async () => (await (await load()).thisDeviceName?.()) ?? null,
    devices: async () => await (await load()).devices(),
    sessions: async (filter) => await (await load()).sessions(filter),
    listing: async () => {
      const loaded = await load()
      return loaded.listing === undefined ? { rows: await loaded.sessions(), incomplete: [] } : await loaded.listing()
    },
    endpointCommand: async (device, rpc, options) => await (await load()).endpointCommand(device, rpc, options),
    locate: async (device, engineId, knownKey) => await (await load()).locate(device, engineId, knownKey),
    sessionCommand: async (device, sessionId, rpc, options) =>
      await (await load()).sessionCommand(device, sessionId, rpc, options),
    read: async (device, sessionId, tail) => await (await load()).read(device, sessionId, tail),
    watch: async (device, sessionId, handlers, watchOptions) =>
      await (await load()).watch(device, sessionId, handlers, watchOptions),
    // A loaded port without the omo#13037 lookup or wake answers as the port contract reads an absent member.
    lookup: async (device, durableId) => (await (await load()).lookup?.(device, durableId)) ?? { kind: "unavailable" },
    canLookup: async () => (await (await load()).canLookup?.()) === true,
    wake: async (device, durableId, rpc) =>
      (await (await load()).wake?.(device, durableId, rpc)) ?? { kind: "unavailable" },
    canWake: async () => (await (await load()).canWake?.()) === true,
    close: async () => {
      client.close()
      const loaded = port
      port = undefined
      if (loaded !== undefined) await (await loaded.catch(() => undefined))?.close?.()
    },
  }
  const preset = {
    ...(options.permissionPreset === undefined ? {} : { permissionPreset: options.permissionPreset }),
    ...(options.loadProjector === undefined ? {} : { loadProjector: options.loadProjector }),
  }
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
