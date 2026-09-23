import { createConnection } from "node:net"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { resolveTaskHostSocket, TASK_HOST_SOCKET_ENV_NAMES } from "../../../../senpi-task/src/runners/rpc-host/daemon"
import type { SenpiExtensionAPI } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import type { ThreadTranscriptEntry, ThreadHost, ThreadHostSession } from "./tools"

type RpcFrame = { readonly success?: boolean; readonly data?: unknown; readonly error?: unknown }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function dataRecord(frame: RpcFrame, command: unknown): Record<string, unknown> {
  if (frame.success === false && command === "set_thinking_level" && typeof frame.error === "string" && /^Thinking level .+ is not supported by the active model\.$/.test(frame.error)) {
    throw new Error(`thinking_level_unsupported:${frame.error}`)
  }
  if (frame.success && frame.data === undefined && (command === "set_session_name" || command === "set_thinking_level")) return {}
  if (!frame.success || !record(frame.data)) throw new Error(`thread RPC request failed: ${JSON.stringify(frame.error ?? frame)}`)
  return frame.data
}
/**
 * One request, one correlated response. The multi-session host writes other lines on the same
 * connection before the reply: the `open_session` admission notice (`{type:"queued",
 * for_request:<our id>}`, deliberately NOT carrying the response id so a client that settles by
 * id never takes it for the reply) and connection-wide broadcasts (`agent_start`,
 * `session_opened`, ...). Only the frame whose `id` equals the request id settles the call;
 * every other line is skipped.
 */
async function request(socketPath: string, command: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = randomUUID()
  return await new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ""
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("thread RPC request timed out")) }, 60_000)
    const finish = (error?: Error, value?: Record<string, unknown>) => { clearTimeout(timer); socket.destroy(); error === undefined ? resolve(value as Record<string, unknown>) : reject(error) }
    socket.once("error", (error) => finish(error))
    socket.once("close", () => finish(new Error(`thread RPC connection closed before the ${String(command.type)} response arrived`)))
    socket.once("connect", () => socket.write(`${JSON.stringify({ id, ...command })}\n`))
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      let newline = buffer.indexOf("\n")
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf("\n")
        if (line.trim() === "") continue
        let frame: unknown
        try { frame = JSON.parse(line) } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); return }
        if (!record(frame) || frame.id !== id) continue
        try { finish(undefined, dataRecord(frame as RpcFrame, command.type)) } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
        return
      }
    })
  })
}

/**
 * Socket overrides, most specific first: the engine's own brand-prefixed `RPC_SOCKET` names
 * (`envValue("RPC_SOCKET")` in senpi), then `OMO_RPC_SOCKET_PATH`, which the desktop sets on the
 * host it spawns so that host binds beside the CLI host instead of replacing it. The list and the
 * precedence live ONCE, beside the task daemon that attaches to the same socket.
 */
export const THREAD_SOCKET_ENV_NAMES = TASK_HOST_SOCKET_ENV_NAMES

/** Client for Senpi's existing supervisor-owned unix socket. It never starts or replaces a host. */
export function resolveThreadSocket(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return resolveTaskHostSocket(env, resolveAgentHome({ env }))
}

export function createLiveThreadSurface(_pi: SenpiExtensionAPI, options: { readonly env?: Readonly<Record<string, string | undefined>>; readonly exists?: (path: string) => boolean } = {}): ThreadHost {
  const call = async <T>(type: string, data: Record<string, unknown> = {}): Promise<T> => {
    const socket = resolveThreadSocket(options.env)
    if (!(options.exists ?? existsSync)(socket)) throw new Error(`host_unavailable:${socket}`)
    return await request(socket, { type, ...data }) as T
  }
  const socket = resolveThreadSocket(options.env)
  return {
    socket,
    listSessions: async () => (await call<{ sessions: ThreadHostSession[] }>("list_sessions")).sessions,
    /**
     * `open_session` answers with the ROUTING id and a state that carries neither the durable id
     * nor a name, but the address book keys every entry by the durable id - so returning the wire
     * reply as-is hands the caller an address that resolves to not_found on its very next call.
     * The wire also has no name field on open, while the family's contract says a created thread
     * can be named. Both are settled here, in the adapter that owns the wire: apply the name when
     * one was asked for, then read the session list back and merge the entry the host now reports.
     */
    openSession: async (params) => {
      // `retain_on_disconnect` (host capability of the same name, wire default false) makes the
      // host DETACH instead of closing when a connection drops. This client is one-shot - the
      // connection that opens the session ends immediately - so without the flag the new session
      // goes straight to `closing` and every later call answers `session_closing`.
      const result = await call<{ sessionId: string; state: ThreadHostSession }>("open_session", { ...(params as Record<string, unknown>), retain_on_disconnect: true })
      const routingId = result.sessionId
      const name = (params as { readonly name?: string }).name
      if (name !== undefined && name.trim() !== "") await call("set_session_name", { sessionId: routingId, name })
      const { sessions } = await call<{ sessions: readonly ThreadHostSession[] }>("list_sessions")
      const listed = sessions.find((session) => session.sessionId === routingId)
      return { ...result.state, ...(listed ?? {}), sessionId: routingId }
    },
    getMessages: async (sessionId) => (await call<{ messages: ThreadTranscriptEntry[] }>("get_messages", { sessionId })).messages,
    getState: (sessionId) => call("get_state", { sessionId }),
    prompt: (sessionId, message, options) => call("prompt", { sessionId, message, ...options }),
    interrupt: (sessionId, turnId) => call("interrupt", { sessionId, ...(turnId === undefined ? {} : { turnId }) }),
    setSessionName: async (sessionId, name) => { await call("set_session_name", { sessionId, name }) },
    setModel: (sessionId, provider, modelId) => call("set_model", { sessionId, provider, modelId }),
    getAvailableModels: async (sessionId) => {
      const { models } = await call<{ models: Awaited<ReturnType<ThreadHost["getAvailableModels"]>> }>("get_available_models", { sessionId })
      return models.map(({ provider, id, name }) => ({ provider, id, ...(name === undefined ? {} : { name }) }))
    },
    setThinkingLevel: async (sessionId, level, scope) => { await call("set_thinking_level", { sessionId, level, ...(scope === "turn" ? { scope } : {}) }) },
    getAvailableThinkingLevels: async (sessionId) => (await call<{ levels: string[] }>("get_available_thinking_levels", { sessionId })).levels,
  }
}

export function defaultThreadStateDirectory(pi: SenpiExtensionAPI): string { return join(pi.cwd ?? process.cwd(), ".omo", "thread-tools") }
