import { chmodSync, lstatSync, mkdirSync, rmSync } from "node:fs"
import { createConnection, createServer, type Socket } from "node:net"
import { dirname } from "node:path"

import type { EnsureCaller, EnsureReply } from "./ensure.ts"
import type { HostLatch } from "./host-latch.ts"
import { listening } from "./launcher.ts"
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

export type HostApiRefusal = "host_api_dir_not_owner_only" | "host_api_not_our_socket" | "host_api_in_use"

class HostApiRefused extends Error {
  readonly reason: HostApiRefusal

  constructor(reason: HostApiRefusal, detail: string) {
    super(`host API refused (${reason}): ${detail}`)
    this.name = "HostApiRefused"
    this.reason = reason
  }
}

function socketPath(address: HostAddress): string {
  switch (address.kind) {
    case "socket":
      return address.path
    case "endpoint":
      throw new Error("the Windows host API (named pipe) is row 60's")
    default:
      return address satisfies never
  }
}

function ownUid(): number {
  const uid = process.getuid?.()
  if (uid === undefined) throw new Error("a socket host API needs a Unix uid")
  return uid
}

/**
 * The socket's directory is what keeps every other uid out (Node has no SO_PEERCRED): it must be a
 * real directory (not a link) this uid owns with no group or other bits, so nobody else can connect
 * to the socket, bind its name or swap it.
 */
function requireOwnerOnlyDir(dir: string, uid: number): void {
  const stat = lstatSync(dir, { throwIfNoEntry: false })
  if (stat === undefined || !stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0) {
    throw new HostApiRefused("host_api_dir_not_owner_only", dir)
  }
}

/** The client's check before any connect: this uid's own socket (not a link) in an owner-only directory. */
function verifiedSocketPath(address: HostAddress): string {
  const path = socketPath(address)
  const uid = ownUid()
  requireOwnerOnlyDir(dirname(path), uid)
  const stat = lstatSync(path, { throwIfNoEntry: false })
  // Absent: nothing to verify, and the connect reports that no host is serving.
  if (stat !== undefined && (!stat.isSocket() || stat.uid !== uid))
    throw new HostApiRefused("host_api_not_our_socket", path)
  return path
}

/** The server's claim of its address: an owner-only directory, and no live host already there. */
async function claimSocketPath(address: HostAddress): Promise<string> {
  const path = socketPath(address)
  const uid = ownUid()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  requireOwnerOnlyDir(dirname(path), uid)
  if (lstatSync(path, { throwIfNoEntry: false }) !== undefined) {
    if (await listening(path)) throw new HostApiRefused("host_api_in_use", path)
    // A dead host's leftover: the owner-only directory admits no other uid, so it is this uid's own.
    rmSync(path, { force: true })
  }
  return path
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
 * The host's local API (NDJSON JSON-RPC 2.0) at the address the engine resolves: an owner-only
 * socket file in an owner-only directory, so no other uid can reach or squat it. It answers
 * `hand.status` and `hand.ensure`; every other method is unknown.
 */
export async function serveHostApi(
  address: HostAddress,
  handlers: HostApiHandlers,
): Promise<{ close(): Promise<void> }> {
  const path = await claimSocketPath(address)
  const server = createServer((socket) => serveConnection(socket, handlers))
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(path, () => {
      server.off("error", reject)
      resolve()
    })
  })
  chmodSync(path, 0o600)
  return {
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          rmSync(path, { force: true })
          resolve()
        })
      }),
  }
}

/**
 * One request to a host's local API: the client side every attach-only host uses for `hand.ensure`.
 * It never dials an address it cannot verify as this uid's own socket in an owner-only directory, so
 * a squatter can never answer it (and point it at an endpoint of its choosing).
 */
export function callHostApi(
  address: HostAddress,
  method: string,
  params: unknown,
  timeoutMs = 10_000,
): Promise<RpcReply> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(verifiedSocketPath(address))
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
