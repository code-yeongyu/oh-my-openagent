import { readFile } from "node:fs/promises"
import { createConnection } from "node:net"

export interface LspDaemonOwnerEndpoint {
  readonly dev: number
  readonly ino: number
  readonly kind: "unix"
  readonly path: string
}

export interface LspDaemonOwnerIdentity {
  readonly endpoint: LspDaemonOwnerEndpoint
  readonly nonce: string
  readonly pid: number
  readonly startedAt: string
}

export interface LspDaemonOwnerTarget {
  readonly authPath: string
  readonly owner: LspDaemonOwnerIdentity
  readonly ownerPath: string
  readonly pid: number
}

const OWNER_PING_REQUEST_ID = "process-sweep-owner-attestation"
const OMO_DAEMON_PROTOCOL_VERSION = 1

export interface LspDaemonOwnerAttestationDeps {
  readonly pingOwner?: (endpoint: LspDaemonOwnerEndpoint, authToken: string) => Promise<LspDaemonOwnerIdentity | null>
  readonly readText?: (path: string) => Promise<string>
}

export async function attestLspDaemonOwner(
  target: LspDaemonOwnerTarget,
  deps: LspDaemonOwnerAttestationDeps = {},
): Promise<boolean> {
  try {
    const readText = deps.readText ?? ((path: string) => readFile(path, "utf8"))
    const currentOwner = parseLspDaemonOwner(JSON.parse(await readText(target.ownerPath)))
    if (currentOwner === null || !sameOwner(currentOwner, target.owner)) return false
    const authToken = (await readText(target.authPath)).trim()
    if (authToken.length === 0) return false
    const pingOwner = deps.pingOwner ?? pingLspDaemonOwner
    const liveOwner = await pingOwner(target.owner.endpoint, authToken)
    return liveOwner !== null && sameOwner(liveOwner, target.owner)
  } catch {
    return false
  }
}

export function parseLspDaemonOwner(value: unknown): LspDaemonOwnerIdentity | null {
  if (!isRecord(value)) return null
  const pid = value["pid"]
  const nonce = value["nonce"]
  const startedAt = value["startedAt"]
  const endpoint = value["endpoint"]
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return null
  if (typeof nonce !== "string" || nonce.length === 0) return null
  if (typeof startedAt !== "string" || startedAt.length === 0) return null
  if (!isRecord(endpoint)) return null
  const kind = endpoint["kind"]
  const path = endpoint["path"]
  const dev = endpoint["dev"]
  const ino = endpoint["ino"]
  if (kind !== "unix" || typeof path !== "string" || path.length === 0) return null
  if (typeof dev !== "number" || !Number.isSafeInteger(dev)) return null
  if (typeof ino !== "number" || !Number.isSafeInteger(ino)) return null
  return { endpoint: { dev, ino, kind: "unix", path }, nonce, pid, startedAt }
}

export function createLspDaemonOwnerPingRequest(authToken: string): Record<string, unknown> {
  return {
    id: OWNER_PING_REQUEST_ID,
    jsonrpc: "2.0",
    method: "omo/ping",
    params: { _omo: { protocolVersion: OMO_DAEMON_PROTOCOL_VERSION, token: authToken } },
  }
}

async function pingLspDaemonOwner(
  endpoint: LspDaemonOwnerEndpoint,
  authToken: string,
): Promise<LspDaemonOwnerIdentity | null> {
  return new Promise((resolvePromise) => {
    let buffer = ""
    let settled = false
    const socket = createConnection(endpoint.path)
    const finish = (owner: LspDaemonOwnerIdentity | null): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolvePromise(owner)
    }
    socket.setEncoding("utf8")
    socket.setTimeout(500, () => finish(null))
    socket.once("error", () => finish(null))
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(createLspDaemonOwnerPingRequest(authToken))}\n`)
    })
    socket.on("data", (chunk: string) => {
      buffer += chunk
      const lineEnd = buffer.indexOf("\n")
      if (lineEnd < 0) return
      const line = buffer.slice(0, lineEnd).trim()
      if (line.length === 0) return finish(null)
      try {
        const response: unknown = JSON.parse(line)
        if (!isRecord(response) || response["id"] !== OWNER_PING_REQUEST_ID || "error" in response) {
          return finish(null)
        }
        finish(parseLspDaemonOwner(response["result"]))
      } catch {
        finish(null)
      }
    })
  })
}

function sameOwner(left: LspDaemonOwnerIdentity, right: LspDaemonOwnerIdentity): boolean {
  return left.pid === right.pid
    && left.nonce === right.nonce
    && left.startedAt === right.startedAt
    && left.endpoint.kind === right.endpoint.kind
    && left.endpoint.path === right.endpoint.path
    && left.endpoint.dev === right.endpoint.dev
    && left.endpoint.ino === right.endpoint.ino
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
