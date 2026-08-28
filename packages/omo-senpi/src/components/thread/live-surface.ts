import { createConnection } from "node:net"
import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { SenpiExtensionAPI } from "../../extension/types"
import type { ThreadTranscriptEntry, ThreadHost, ThreadHostSession } from "./tools"

const require = createRequire(import.meta.url)
function senpiAgentDir(): string { return (require("@code-yeongyu/senpi") as { getAgentDir: () => string }).getAgentDir() }

type RpcFrame = { readonly success?: boolean; readonly data?: unknown; readonly error?: unknown }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function dataRecord(frame: RpcFrame): Record<string, unknown> {
  if (!frame.success || !record(frame.data)) throw new Error(`thread RPC request failed: ${JSON.stringify(frame.error ?? frame)}`)
  return frame.data
}
async function request(socketPath: string, command: Record<string, unknown>): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ""
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("thread RPC request timed out")) }, 60_000)
    const finish = (error?: Error, value?: Record<string, unknown>) => { clearTimeout(timer); socket.destroy(); error === undefined ? resolve(value as Record<string, unknown>) : reject(error) }
    socket.once("error", (error) => finish(error))
    socket.once("connect", () => socket.write(`${JSON.stringify({ id: randomUUID(), ...command })}\n`))
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      const newline = buffer.indexOf("\n")
      if (newline < 0) return
      try { finish(undefined, dataRecord(JSON.parse(buffer.slice(0, newline)) as RpcFrame)) } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
    })
  })
}

/** Client for Senpi's existing supervisor-owned unix socket. It never starts or replaces a host. */
export function resolveThreadSocket(getDir: () => string = senpiAgentDir): string {
  return process.env.SENPI_RPC_SOCKET ?? join(getDir(), "rpc", "rpc.sock")
}

export function createLiveThreadSurface(_pi: SenpiExtensionAPI): ThreadHost | undefined {
  const socket = resolveThreadSocket()
  if (!existsSync(socket)) return undefined
  const call = async <T>(type: string, data: Record<string, unknown> = {}): Promise<T> => await request(socket, { type, ...data }) as T
  return {
    socket,
    listSessions: async () => (await call<{ sessions: ThreadHostSession[] }>("list_sessions")).sessions,
    openSession: async (params) => { const result = await call<{ sessionId: string; state: ThreadHostSession }>("open_session", params as Record<string, unknown>); return { ...result.state, sessionId: result.sessionId } },
    getMessages: async (sessionId) => (await call<{ messages: ThreadTranscriptEntry[] }>("get_messages", { sessionId })).messages,
    getState: (sessionId) => call("get_state", { sessionId }),
    prompt: (sessionId, message, options) => call("prompt", { sessionId, message, ...options }),
    interrupt: (sessionId, turnId) => call("interrupt", { sessionId, ...(turnId === undefined ? {} : { turnId }) }),
  }
}

export function defaultThreadStateDirectory(pi: SenpiExtensionAPI): string { return join(pi.cwd ?? process.cwd(), ".omo", "thread-tools") }
