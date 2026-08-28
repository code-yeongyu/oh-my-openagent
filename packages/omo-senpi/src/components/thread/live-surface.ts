import { join } from "node:path"
import type { SenpiExtensionAPI } from "../../extension/types"
import type { ThreadHost, ThreadHostSession } from "./tools"

/**
 * Adapter for the host's existing extension RPC seam. The host owns the socket and supervisor;
 * this component only issues correlated commands through the runtime binding supplied by Senpi.
 */
export function createLiveThreadSurface(pi: SenpiExtensionAPI): ThreadHost | undefined {
  const request = pi.rpc?.request
  if (typeof request !== "function") return undefined
  const call = async <T>(type: string, data: Record<string, unknown> = {}): Promise<T> => {
    const result = await request(type, data)
    if (typeof result === "object" && result !== null && "data" in result) return (result as { data: T }).data
    return result as T
  }
  return {
    socket: "senpi-runtime",
    listSessions: async () => (await call<{ sessions: ThreadHostSession[] }>("list_sessions")).sessions,
    openSession: async (params) => {
      const result = await call<{ sessionId: string; state: ThreadHostSession }>("open_session", params as Record<string, unknown>)
      return { ...result.state, sessionId: result.sessionId }
    },
    getMessages: async (sessionId) => (await call<{ messages: any[] }>("get_messages", { sessionId })).messages,
    getState: (sessionId) => call("get_state", { sessionId }),
    prompt: (sessionId, message, options) => call("prompt", { sessionId, message, ...options }),
    interrupt: (sessionId, turnId) => call("interrupt", { sessionId, ...(turnId === undefined ? {} : { turnId }) }),
  }
}

export function defaultThreadStateDirectory(pi: SenpiExtensionAPI): string {
  return join(pi.cwd ?? process.cwd(), ".omo", "thread-tools")
}
