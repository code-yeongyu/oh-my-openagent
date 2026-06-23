import { spawn, type ChildProcessByStdio } from "node:child_process"
import type { Readable, Writable } from "node:stream"
import type { ReasoningCoreTransport, TransportConfig } from "./transport-interface"
import type { JsonRpcRequest } from "./json-rpc-message"
import { ReasoningCoreInfrastructureError } from "./infrastructure-error"
import { sendJsonRpcOverStdio } from "./stdio-json-rpc"

type SpawnedChild = ChildProcessByStdio<Writable, Readable, Readable>

export interface StdioTransportConfig extends TransportConfig {
  binaryPath: string
}

const MCP_PROTOCOL_VERSION = "2025-03-26"

export function createStdioTransport(config: StdioTransportConfig): ReasoningCoreTransport {
  const state = { child: undefined as SpawnedChild | undefined, nextId: 1, initialized: false }

  async function ensureReady(): Promise<SpawnedChild> {
    if (state.child && state.child.exitCode === null && state.child.signalCode === null && state.initialized) {
      return state.child
    }
    await initialize()
    if (!state.child) {
      throw new ReasoningCoreInfrastructureError("spawn", "reasoning-core child not available after initialize")
    }
    return state.child
  }

  async function initialize(): Promise<void> {
    const child = spawnChild(config.binaryPath)
    state.child = child
    state.nextId = 1
    state.initialized = false
    child.once("exit", () => {
      if (state.child === child) {
        state.child = undefined
        state.initialized = false
      }
    })
    try {
      const response = await sendJsonRpcOverStdio(
        child,
        { jsonrpc: "2.0", id: state.nextId++, method: "initialize", params: { protocolVersion: MCP_PROTOCOL_VERSION } },
        config.timeoutMs,
      )
      throwIfJsonRpcError(response, "init")
      state.initialized = true
    } catch (error) {
      terminateChild(child)
      state.child = undefined
      state.initialized = false
      if (error instanceof ReasoningCoreInfrastructureError) throw error
      throw new ReasoningCoreInfrastructureError("init", describeError(error), error)
    }
  }

  async function sendRequest(message: JsonRpcRequest): Promise<unknown> {
    const child = await ensureReady()
    const renumbered: JsonRpcRequest = { ...message, id: state.nextId++ }
    const response = await sendJsonRpcOverStdio(child, renumbered, config.timeoutMs)
    throwIfJsonRpcError(response, "rpc")
    return response
  }

  function dispose(): void {
    const current = state.child
    if (!current) return
    state.child = undefined
    state.initialized = false
    terminateChild(current)
  }

  return { sendRequest, dispose }
}

function spawnChild(binaryPath: string): SpawnedChild {
  try {
    return spawn(binaryPath, [], { stdio: ["pipe", "pipe", "pipe"] }) as SpawnedChild
  } catch (error) {
    throw new ReasoningCoreInfrastructureError("spawn", describeError(error), error)
  }
}

function terminateChild(child: SpawnedChild): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  try {
    child.kill("SIGTERM")
  } catch {
    return
  }
  const killTimer = setTimeout(() => {
    try {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL")
      }
    } catch {}
  }, 1000)
  if (typeof killTimer.unref === "function") killTimer.unref()
  child.once("exit", () => clearTimeout(killTimer))
  child.once("close", () => clearTimeout(killTimer))
}

function throwIfJsonRpcError(response: unknown, kind: "init" | "rpc"): void {
  if (typeof response !== "object" || response === null) return
  const error = (response as Record<string, unknown>).error
  if (typeof error !== "object" || error === null) return
  const errRec = error as Record<string, unknown>
  const code = typeof errRec.code === "number" ? errRec.code : undefined
  const message = typeof errRec.message === "string" ? errRec.message : "unknown error"
  const reason = code == null ? message : `${code}: ${message}`
  throw new ReasoningCoreInfrastructureError(kind, `reasoning-core ${kind} failed: ${reason}`)
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
