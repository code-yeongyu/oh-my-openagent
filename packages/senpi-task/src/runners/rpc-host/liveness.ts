import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createConnection } from "node:net"
import { win32 } from "node:path"

import { log } from "@oh-my-opencode/utils"

import { probeWithEngine } from "./session-transport"

/**
 * The two questions the lifecycle asks a daemon once per pass: "are you there?" (`get_protocol_info`
 * through the engine's own `probeHost`) and "which session paths do you still hold?"
 * (`list_sessions { include_workers: true }` - worker rows are hidden by default, and every task
 * child is a worker). Both answer conservatively on failure: an unreachable daemon holds nothing,
 * which makes the lifecycle reopen from JSONL rather than attach, and close nothing.
 */

const LIST_REQUEST_ID = "omo-task-liveness"
const LIST_TIMEOUT_MS = 10_000
const WINDOWS_PIPE_PREFIX = "\\\\.\\pipe\\senpi-rpc-"
const WINDOWS_SECRET_BYTES = 32

export async function daemonReachable(socket: string): Promise<boolean> {
  try {
    return (await probeWithEngine(socket)) !== undefined
  } catch (error) {
    log("senpi-task daemon probe failed", { socket, error: String(error) })
    return false
  }
}

/**
 * Asked on the wire, never through the engine's `RpcClient.listSessions()`: that client sends a bare
 * `list_sessions` and drops `include_workers`, so every task child would read as gone - and a live
 * child that reads as gone is claimed by the next omo session that reconciles the store (#8932).
 */
export async function liveSessionPaths(socket: string): Promise<readonly string[]> {
  const reply = await askDaemon(socket, { id: LIST_REQUEST_ID, type: "list_sessions", include_workers: true })
  if (reply === undefined) {
    log("senpi-task daemon session list failed", { socket })
    return []
  }
  const sessions = reply.sessions
  if (!Array.isArray(sessions)) return []
  return sessions.flatMap((row: unknown) => (isRecord(row) && typeof row.sessionPath === "string" ? [row.sessionPath] : []))
}

// One short-lived connection, one command, the reply carrying its id. A daemon broadcasts lifecycle
// records to every connection, so the first line is not necessarily the answer. The daemon runner
// uses the logical socket path directly on POSIX and its authenticated named-pipe transport on Windows.
async function askDaemon(
  socket: string,
  request: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  const transport = await resolveTransport(socket)
  if (transport === undefined) return undefined
  return new Promise((resolve) => {
    const connection = createConnection(transport.address)
    let buffer = ""
    let settled = false
    const finish = (data: Readonly<Record<string, unknown>> | undefined): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      connection.destroy()
      resolve(data)
    }
    const timeout = setTimeout(() => finish(undefined), LIST_TIMEOUT_MS)
    connection.setEncoding("utf8")
    connection.once("connect", () => {
      if (transport.secret !== undefined) connection.write(transport.secret)
      connection.write(`${JSON.stringify(request)}\n`)
    })
    connection.on("data", (chunk: string) => {
      buffer += chunk
      for (let newline = buffer.indexOf("\n"); newline !== -1; newline = buffer.indexOf("\n")) {
        const answer = answerFor(buffer.slice(0, newline), request.id)
        buffer = buffer.slice(newline + 1)
        if (answer !== undefined) return finish(answer)
      }
    })
    connection.once("error", () => finish(undefined))
    connection.once("close", () => finish(undefined))
  })
}

async function resolveTransport(
  socket: string,
): Promise<{ readonly address: string; readonly secret?: Buffer } | undefined> {
  if (process.platform !== "win32") return { address: socket }
  let secret: Buffer
  try {
    secret = await readFile(`${socket}.secret`)
  } catch {
    return undefined
  }
  if (secret.length !== WINDOWS_SECRET_BYTES) return undefined
  const canonical = win32.normalize(socket).toLowerCase()
  const name = createHash("sha256")
    .update(Buffer.concat([Buffer.from(canonical, "utf8"), secret]))
    .digest("hex")
    .slice(0, 32)
  return { address: `${WINDOWS_PIPE_PREFIX}${name}`, secret }
}

function answerFor(line: string, id: unknown): Readonly<Record<string, unknown>> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!isRecord(parsed) || parsed.id !== id || parsed.success !== true) return undefined
  return isRecord(parsed.data) ? parsed.data : {}
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
