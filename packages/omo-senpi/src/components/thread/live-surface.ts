import { createConnection } from "node:net"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { CONFIG_DIR_NAME, CONFIG_FLAT_LAYOUT, resolveAgentDir } from "@code-yeongyu/senpi"
import type { SenpiExtensionAPI } from "../../extension/types"
import type { ThreadTranscriptEntry, ThreadHost, ThreadHostSession } from "./tools"

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
export function createLiveThreadSurface(pi: SenpiExtensionAPI): ThreadHost | undefined {
  const explicitDir = process.env.CODING_AGENT_DIR ?? process.env.SENPI_CODING_AGENT_DIR ?? process.env.OMO_CODING_AGENT_DIR
  const agentDir = resolveAgentDir(pi.cwd ?? process.cwd(), homedir(), explicitDir)
  const configDir = CONFIG_FLAT_LAYOUT ? agentDir : join(agentDir, "..")
  const socket = process.env.SENPI_RPC_SOCKET ?? join(configDir, CONFIG_FLAT_LAYOUT ? "rpc" : "rpc", "rpc.sock")
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
