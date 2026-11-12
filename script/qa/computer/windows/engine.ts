// The engine under test over stdio NDJSON JSON-RPC, opened with the scenario's admission, plus
// the teardown that proves no engine process is left.
import { type Subprocess, spawn } from "bun"

import type { Admission } from "./scenario.ts"

const REPLY_TIMEOUT_MS = 15_000
const HEARTBEAT_MS = 500
const EXIT_TIMEOUT_MS = 5_000

type RpcError = { readonly code: number; readonly message: string; readonly data?: Record<string, unknown> }
type Reply = { readonly result?: unknown; readonly error?: RpcError }

export type Engine = {
  readonly call: (method: string, params?: Record<string, unknown>) => Promise<Reply>
  readonly close: () => Promise<string[]>
}

type Pending = (reply: Reply) => void

function connect(binary: string): { child: Subprocess<"pipe", "pipe", "inherit">; call: Engine["call"] } {
  const child = spawn([binary, "--stdio"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env, OMO_COMPUTER_BACKEND: "win32" },
  })
  const pending = new Map<number, Pending>()
  let next = 1
  void (async () => {
    let buffer = ""
    const decoder = new TextDecoder()
    for await (const chunk of child.stdout) {
      buffer += decoder.decode(chunk, { stream: true })
      for (let end = buffer.indexOf("\n"); end !== -1; end = buffer.indexOf("\n")) {
        const line = buffer.slice(0, end).trim()
        buffer = buffer.slice(end + 1)
        if (line === "") continue
        const message: { id?: number; result?: unknown; error?: RpcError } = JSON.parse(line)
        if (typeof message.id !== "number") continue
        pending.get(message.id)?.({ result: message.result, error: message.error })
        pending.delete(message.id)
      }
    }
  })()
  const call: Engine["call"] = (method, params = {}) => {
    const id = next++
    const reply = new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} gave no reply in ${REPLY_TIMEOUT_MS} ms`)), REPLY_TIMEOUT_MS)
      pending.set(id, (value) => {
        clearTimeout(timer)
        resolve(value)
      })
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
    child.stdin.flush()
    return reply
  }
  return { child, call }
}

async function stop(child: Subprocess<"pipe", "pipe", "inherit">): Promise<string> {
  child.stdin.end()
  const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(EXIT_TIMEOUT_MS).then(() => false)])
  if (!exited) {
    child.kill()
    await child.exited
  }
  return `procs ${child.exitCode === null ? 1 : 0}`
}

/** Opens a session with `admit`: host-relay adds the relay-only stop policy and its heartbeat. */
export async function openEngine(binary: string, admit: Admission): Promise<Engine> {
  const { child, call } = connect(binary)
  const params: Record<string, unknown> = { reportMode: "object" }
  if (admit === "host-relay") params.allowHostRelayOnlyStop = true
  const opened = await call("session.open", params)
  if (opened.error !== undefined) throw new Error(`session.open refused: ${JSON.stringify(opened.error)}`)
  let relay: ReturnType<typeof setInterval> | undefined
  if (admit === "host-relay") {
    const host = connect(binary)
    await host.call("stopPath.start", {})
    relay = setInterval(() => void host.call("stopPath.heartbeat", {}), HEARTBEAT_MS)
    const close = async (): Promise<string[]> => {
      clearInterval(relay)
      return [await stop(child), await stop(host.child)]
    }
    return { call, close }
  }
  return { call, close: async () => [await stop(child)] }
}
