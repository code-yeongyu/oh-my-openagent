import { chmodSync, rmSync } from "node:fs"
import { createConnection, createServer, type Socket } from "node:net"

import type { EnsureCaller, EnsureReply } from "./ensure.ts"
import type { HostLatch } from "./host-latch.ts"
import type { HostAddress } from "./paths.ts"
import { asReply, onLines, parseObject, type RpcReply } from "./rpc.ts"

/** `hand.status`: what a host-less engine reads at `session.open` (engine host/mod.rs). */
export interface HandStatus {
  readonly consentFingerprint: string
  readonly latch: HostLatch
}

export interface HostApiHandlers {
  status(): HandStatus
  ensure(caller: EnsureCaller): Promise<EnsureReply>
}

function socketPath(address: HostAddress): string {
  switch (address.kind) {
    case "abstract":
      return `\0${address.name}`
    case "socket":
      return address.path
    case "endpoint":
      throw new Error("the Windows host API (named pipe) is row 60's")
    default:
      return address satisfies never
  }
}

function caller(params: unknown): EnsureCaller | undefined {
  if (typeof params !== "object" || params === null) return undefined
  const pid: unknown = Reflect.get(params, "pid")
  const processStart: unknown = Reflect.get(params, "processStart")
  const valid = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0
  return valid(pid) && valid(processStart) ? { pid, processStart } : undefined
}

async function answer(message: Record<string, unknown>, handlers: HostApiHandlers): Promise<Record<string, unknown>> {
  const id = message.id ?? null
  const error = (code: number, text: string, data?: unknown) => ({
    jsonrpc: "2.0",
    id,
    error: { code, message: text, ...(data === undefined ? {} : { data }) },
  })
  switch (message.method) {
    case "hand.status":
      return { jsonrpc: "2.0", id, result: handlers.status() }
    case "hand.ensure": {
      const who = caller(message.params)
      if (who === undefined)
        return error(-32602, "Invalid params", { reason: "pid and processStart must be positive integers" })
      return { jsonrpc: "2.0", id, result: await handlers.ensure(who) }
    }
    default:
      return error(-32601, "Method not found", { reason: "unknown" })
  }
}

function serveConnection(socket: Socket, handlers: HostApiHandlers): void {
  socket.on("error", () => socket.destroy())
  onLines(socket, (line) => {
    const message = parseObject(line)
    if (message === undefined) {
      socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`)
      return
    }
    void answer(message, handlers).then(
      (reply) => socket.write(`${JSON.stringify(reply)}\n`),
      (failure: unknown) =>
        socket.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: message.id ?? null, error: { code: -32603, message: "Internal error", data: { detail: String(failure) } } })}\n`,
        ),
    )
  })
}

/**
 * The host's local API (NDJSON JSON-RPC 2.0) at the address the engine resolves: a Linux abstract
 * name (unlinkable, unsquattable once held) or an owner-only socket file. It answers `hand.status`
 * and `hand.ensure`; every other method is unknown.
 */
export async function serveHostApi(
  address: HostAddress,
  handlers: HostApiHandlers,
): Promise<{ close(): Promise<void> }> {
  const path = socketPath(address)
  const server = createServer((socket) => serveConnection(socket, handlers))
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(path, () => {
      server.off("error", reject)
      resolve()
    })
  })
  if (address.kind === "socket") chmodSync(address.path, 0o600)
  return {
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          if (address.kind === "socket") rmSync(address.path, { force: true })
          resolve()
        })
      }),
  }
}

/** One request to a host's local API: the client side every attach-only host uses for `hand.ensure`. */
export function callHostApi(
  address: HostAddress,
  method: string,
  params: unknown,
  timeoutMs = 10_000,
): Promise<RpcReply> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath(address))
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`no answer to ${method} from the host API within ${timeoutMs} ms`))
    }, timeoutMs)
    socket.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    onLines(socket, (line) => {
      const message = parseObject(line)
      const reply = message === undefined ? undefined : asReply(message)
      if (reply?.id !== 1) return
      clearTimeout(timer)
      socket.end()
      resolve(reply)
    })
    socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })}\n`)
  })
}
