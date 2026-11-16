import type { Socket } from "node:net"

/** One JSON-RPC 2.0 reply as read off the wire. */
export interface RpcReply {
  readonly id: number
  readonly result?: unknown
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown }
}

const MAX_LINE_BYTES = 4 * 1024 * 1024

/** Splits a socket's bytes into NDJSON lines; a line over the cap ends the connection. */
export function onLines(socket: Socket, handle: (line: string) => void): void {
  let buffer = ""
  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8")
    if (buffer.length > MAX_LINE_BYTES) {
      socket.destroy()
      return
    }
    for (let newline = buffer.indexOf("\n"); newline !== -1; newline = buffer.indexOf("\n")) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.trim() !== "") handle(line)
    }
  })
}

/** The JSON object of a line, or `undefined` for anything else. */
export function parseObject(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value))
      : undefined
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

export function asReply(message: Record<string, unknown>): RpcReply | undefined {
  const id = message.id
  if (typeof id !== "number") return undefined
  const error = message.error
  if (typeof error === "object" && error !== null) {
    const code: unknown = Reflect.get(error, "code")
    const text: unknown = Reflect.get(error, "message")
    return {
      id,
      error: {
        code: typeof code === "number" ? code : 0,
        message: typeof text === "string" ? text : "",
        data: Reflect.get(error, "data"),
      },
    }
  }
  return { id, result: message.result }
}
