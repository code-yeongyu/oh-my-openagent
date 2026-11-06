import type { RemoteSessionsPort, RemoteThreadSurface } from "./ports"

type Runtime = Pick<typeof import("./device-service"), "createDeviceServiceSessions">

export type LazyRemoteOptions = {
  readonly version: string
  readonly loadRuntime?: () => Promise<Runtime>
}

/**
 * The default remote surface (on in every launch): the device-service client loads with the thread client sidecar on
 * the first call that needs another device. A failed load is not cached and surfaces as the tools' typed
 * host_unavailable, so a device without the service keeps today's local behavior.
 */
export function createLazyRemoteSurface(options: LazyRemoteOptions): RemoteThreadSurface {
  let port: Promise<RemoteSessionsPort> | undefined
  const loadRuntime = options.loadRuntime ?? (() => import("#omo-thread-client-runtime"))
  const load = () => port ??= loadRuntime().then(
    ({ createDeviceServiceSessions }) => createDeviceServiceSessions({ version: options.version }),
    (error: unknown) => { port = undefined; throw error },
  )
  const sessions: RemoteSessionsPort = {
    status: async () => await (await load()).status(),
    thisDevice: async () => await (await load()).thisDevice(),
    devices: async () => await (await load()).devices(),
    sessions: async () => await (await load()).sessions(),
    endpointCommand: async (device, rpc) => await (await load()).endpointCommand(device, rpc),
    locate: async (device, engineId) => await (await load()).locate(device, engineId),
    sessionCommand: async (device, sessionId, rpc) => await (await load()).sessionCommand(device, sessionId, rpc),
    read: async (device, sessionId, tail) => await (await load()).read(device, sessionId, tail),
  }
  return { sessions, chain: { stamp: (record) => record } }
}
