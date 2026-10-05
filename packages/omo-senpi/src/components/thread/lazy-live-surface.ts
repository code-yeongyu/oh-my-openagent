import type { SenpiExtensionAPI } from "../../extension/types"
import type { LiveThreadSurface, LiveThreadSurfaceOptions } from "./live-surface"
import { resolveThreadSocket } from "./live-surface-paths"
import type { ThreadSessionPort } from "./tools/ports"

export type LazyLiveThreadSurfaceOptions = LiveThreadSurfaceOptions & {
  readonly loadRuntime?: () => Promise<Pick<typeof import("./live-surface"), "createLiveThreadSurface">>
}

/** Registration stays synchronous; the RPC client is constructed on the first async operation. */
export function createLazyLiveThreadSurface(pi: SenpiExtensionAPI | undefined, options: LazyLiveThreadSurfaceOptions = {}): LiveThreadSurface {
  const socket = options.socket ?? resolveThreadSocket(options.env)
  let runtime: Promise<LiveThreadSurface> | undefined
  const loadRuntime = options.loadRuntime ?? (() => import("#omo-thread-client-runtime"))
  const load = () => runtime ??= loadRuntime().then(({ createLiveThreadSurface }) => createLiveThreadSurface(pi, { ...options, socket }))
  const sessionPort = (endpoint?: string): ThreadSessionPort => {
    const target = async () => {
      const host = await load()
      return endpoint === undefined ? host : host.endpoint(endpoint)
    }
    return {
      getMessages: async (sessionId) => { const port = await target(); return await port.getMessages(sessionId) },
      getState: async (sessionId) => { const port = await target(); return await port.getState(sessionId) },
      prompt: async (sessionId, message, options) => { const port = await target(); return await port.prompt(sessionId, message, options) },
      interrupt: async (sessionId, turnId) => { const port = await target(); return await port.interrupt(sessionId, turnId) },
      setSessionName: async (sessionId, name) => { const port = await target(); return await port.setSessionName(sessionId, name) },
      setModel: async (sessionId, provider, modelId) => { const port = await target(); return await port.setModel(sessionId, provider, modelId) },
      getAvailableModels: async (sessionId) => { const port = await target(); return await port.getAvailableModels(sessionId) },
      setThinkingLevel: async (sessionId, level, scope) => { const port = await target(); return await port.setThinkingLevel(sessionId, level, scope) },
      getAvailableThinkingLevels: async (sessionId) => { const port = await target(); return await port.getAvailableThinkingLevels(sessionId) },
      wake: async (sessionId, deliveryIds) => { const port = await target(); if (port.wake === undefined) throw new Error("unsupported:wake"); return await port.wake(sessionId, deliveryIds) },
      releaseSession: async (sessionId, request) => { const port = await target(); if (port.releaseSession === undefined) throw new Error("unsupported:release_session"); return await port.releaseSession(sessionId, request) },
    }
  }
  return {
    socket,
    ...sessionPort(),
    listSessions: async () => (await load()).listSessions(),
    openSession: async (params) => (await load()).openSession(params),
    listView: async (request) => (await load()).listView(request),
    listTarget: async (durableId, endpoint) => (await load()).listTarget(durableId, endpoint),
    endpoint: (socket) => sessionPort(socket),
    gateway: {
      wake: async (endpoint, deliveryIds) => (await load()).gateway.wake(endpoint, deliveryIds),
      releaseSession: async (endpoint, request) => { const gateway = (await load()).gateway; if (gateway.releaseSession === undefined) throw new Error("unsupported:releaseSession"); return await gateway.releaseSession(endpoint, request) },
      classifyLiveness: async (endpoint) => { const gateway = (await load()).gateway; if (gateway.classifyLiveness === undefined) throw new Error("unsupported:classifyLiveness"); return await gateway.classifyLiveness(endpoint) },
      respondUi: async (endpoint, answer) => { const gateway = (await load()).gateway; if (gateway.respondUi === undefined) throw new Error("unsupported:respondUi"); return await gateway.respondUi(endpoint, answer) },
    },
  }
}
