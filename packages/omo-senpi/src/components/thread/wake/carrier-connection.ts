import { randomUUID } from "node:crypto"
import { createConnection, type Socket } from "node:net"
import { StringDecoder } from "node:string_decoder"

import {
  authenticateRpcHost,
  resolveRpcSocketTransport,
  type RpcObject,
} from "@oh-my-opencode/senpi-task/rpc-socket-client"

const REQUEST_TIMEOUT_MS = 30_000

/** One kept connection to the engine host: the carrier's own attachment to a woken session lives on it (A3.1.3). */
export type CarrierHostConnection = {
  readonly request: (frame: Record<string, unknown>) => Promise<RpcObject>
  /** Every line that answers no request (`session_lifecycle`, broadcasts). */
  readonly onEvent: (listener: (frame: RpcObject) => void) => () => void
  readonly closed: Promise<void>
  readonly close: () => void
}

export async function connectCarrierHost(options: {
  readonly socket: string
  readonly keyRoot: () => string
}): Promise<CarrierHostConnection> {
  const transport = await resolveRpcSocketTransport(options.socket)
  if (transport === undefined) throw new Error(`host_unavailable:${options.socket}`)
  const socket: Socket = createConnection(transport.address)
  const decoder = new StringDecoder("utf8")
  const pending = new Map<string, { resolve: (frame: RpcObject) => void; reject: (error: Error) => void }>()
  const listeners = new Set<(frame: RpcObject) => void>()
  let buffer = ""
  let failure: Error | undefined
  let markClosed: () => void = () => undefined
  const closed = new Promise<void>((resolve) => {
    markClosed = resolve
  })
  const fail = (error: Error): void => {
    failure ??= error
    for (const entry of pending.values()) entry.reject(failure)
    pending.clear()
    markClosed()
  }
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve)
    socket.once("error", reject)
  })
  socket.on("error", (error) => fail(error))
  socket.on("close", () => fail(new Error("the engine host closed the carrier's connection")))
  socket.on("data", (chunk: Buffer) => {
    buffer += decoder.write(chunk)
    for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.trim().length === 0) continue
      const frame = JSON.parse(line) as RpcObject
      const waiting = typeof frame.id === "string" && frame.type === "response" ? pending.get(frame.id) : undefined
      if (waiting !== undefined && typeof frame.id === "string") {
        pending.delete(frame.id)
        waiting.resolve(frame)
      } else for (const listener of listeners) listener(frame)
    }
  })
  if (transport.secret !== undefined) socket.write(transport.secret)

  const request = (frame: Record<string, unknown>): Promise<RpcObject> => {
    if (failure !== undefined) return Promise.reject(failure)
    const id = randomUUID()
    return new Promise<RpcObject>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`the engine host did not answer ${String(frame.type)} in time`))
      }, REQUEST_TIMEOUT_MS)
      timer.unref?.()
      pending.set(id, {
        resolve: (reply) => {
          clearTimeout(timer)
          resolve(reply)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      socket.write(`${JSON.stringify({ ...frame, id })}\n`)
    })
  }

  await authenticateRpcHost(request, options.socket, options.keyRoot)
  return {
    request,
    onEvent: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    closed,
    close: () => {
      socket.destroy()
    },
  }
}
