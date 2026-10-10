import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createConnection } from "node:net"
import { win32 } from "node:path"

const WINDOWS_PIPE_PREFIX = "\\\\.\\pipe\\senpi-rpc-"
const WINDOWS_SECRET_BYTES = 32

export type HostReply = Readonly<Record<string, unknown>>

/**
 * One short-lived connection, one command, the reply carrying its id - success or refusal. A daemon
 * broadcasts lifecycle records to every connection, so the first line is not necessarily the answer.
 * Undefined when the host could not be reached or did not answer within `timeoutMs`. The daemon
 * runner uses the logical socket path directly on POSIX and its authenticated named-pipe transport
 * on Windows.
 */
export async function askHost(socket: string, request: HostReply, timeoutMs: number): Promise<HostReply | undefined> {
  const transport = await resolveTransport(socket)
  if (transport === undefined) return undefined
  return new Promise((resolve) => {
    const connection = createConnection(transport.address)
    let buffer = ""
    let settled = false
    const finish = (reply: HostReply | undefined): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      connection.destroy()
      resolve(reply)
    }
    const timeout = setTimeout(() => finish(undefined), timeoutMs)
    connection.setEncoding("utf8")
    connection.once("connect", () => {
      if (transport.secret !== undefined) connection.write(transport.secret)
      connection.write(`${JSON.stringify(request)}\n`)
    })
    connection.on("data", (chunk: string) => {
      buffer += chunk
      for (let newline = buffer.indexOf("\n"); newline !== -1; newline = buffer.indexOf("\n")) {
        const reply = replyTo(buffer.slice(0, newline), request.id)
        buffer = buffer.slice(newline + 1)
        if (reply !== undefined) return finish(reply)
      }
    })
    connection.once("error", () => finish(undefined))
    connection.once("close", () => finish(undefined))
  })
}

export function isRecord(value: unknown): value is HostReply {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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

function replyTo(line: string, id: unknown): HostReply | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }
  return isRecord(parsed) && parsed.id === id ? parsed : undefined
}
