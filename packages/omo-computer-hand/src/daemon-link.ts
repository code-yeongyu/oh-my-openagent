import { createConnection, type Socket } from "node:net"

import { asReply, onLines, parseObject, type RpcReply } from "./rpc.ts"

/** A connection to the engine daemon admitted by its capability. */
export interface DaemonLink {
  call(method: string, params: unknown): Promise<RpcReply>
  onNotification(handler: (message: Record<string, unknown>) => void): () => void
  /** Settles when the daemon closed the connection (or `close` was called). */
  readonly closed: Promise<void>
  close(): void
}

/** A link that closed while calls were pending, or was refused before any frame. */
class DaemonLinkClosed extends Error {
  constructor(method: string) {
    super(`the engine daemon closed the connection before answering ${method}`)
    this.name = "DaemonLinkClosed"
  }
}

function connect(endpoint: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint, () => {
      socket.off("error", reject)
      resolve(socket)
    })
    socket.once("error", reject)
  })
}

/**
 * Dials the daemon, sends the raw 32-byte capability preamble (bytes, never JSON) and returns a
 * link whose every request also carries the capability as its top-level `capability` member
 * (row 29, lead decision Q2 C).
 */
export async function connectDaemon(endpoint: string, capability: Buffer): Promise<DaemonLink> {
  const socket = await connect(endpoint)
  socket.write(capability)
  const hex = capability.toString("hex")
  const pending = new Map<
    number,
    { readonly method: string; readonly resolve: (reply: RpcReply) => void; readonly reject: (error: Error) => void }
  >()
  const listeners = new Set<(message: Record<string, unknown>) => void>()
  let nextId = 0
  const closed = new Promise<void>((resolve) => {
    socket.once("close", () => {
      for (const [, call] of pending) call.reject(new DaemonLinkClosed(call.method))
      pending.clear()
      resolve()
    })
  })
  socket.on("error", () => socket.destroy())
  onLines(socket, (line) => {
    const message = parseObject(line)
    if (message === undefined) return
    const reply = asReply(message)
    const call = reply === undefined ? undefined : pending.get(reply.id)
    if (reply !== undefined && call !== undefined) {
      pending.delete(reply.id)
      call.resolve(reply)
      return
    }
    for (const listener of listeners) listener(message)
  })
  return {
    closed,
    close: () => socket.destroy(),
    onNotification: (handler) => {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
    call: (method, params) =>
      new Promise((resolve, reject) => {
        if (socket.destroyed) {
          reject(new DaemonLinkClosed(method))
          return
        }
        nextId += 1
        pending.set(nextId, { method, resolve, reject })
        socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: nextId, method, params, capability: hex })}\n`)
      }),
  }
}
