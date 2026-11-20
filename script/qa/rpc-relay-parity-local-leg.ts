// The local leg of the relay parity sweep (#13478), run ON the target device: sends each record to this device's
// engine host over its own authenticated RPC socket, as any local client does, and answers the driver
// (script/qa/rpc-relay-parity-drive.ts) over stdin/stdout. It also creates the two fixture sessions (one per leg) and
// closes every session the sweep made.
//   bun script/qa/rpc-relay-parity-live.ts leg local      (env: OMO_CODING_AGENT_DIR, default ~/.omo/agent)
import type { Socket } from "node:net"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Answer } from "../rpc-relay-parity-compare"
import { type JsonRecord, serveLeg } from "./rpc-relay-parity-lines"

const agentDir = process.env["OMO_CODING_AGENT_DIR"] ?? join(homedir(), ".omo", "agent")
const socketPath = join(agentDir, "rpc", "rpc.sock")
const engineDist = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))
const { connectAuthenticatedRpcSocket } = (await import(join(engineDist, "modes/rpc/rpc-auth-client.js"))) as {
  connectAuthenticatedRpcSocket: (
    path: string,
    first?: undefined,
    options?: { keyRoot: string },
  ) => Promise<{ socket: Socket }>
}
const REPLY_WAIT_MS = Number(process.env["RPCPAR_REPLY_WAIT_MS"] ?? 20_000)
const FIXTURE_MODEL = {
  provider: process.env["RPCPAR_PROVIDER"] ?? "w4mock",
  modelId: process.env["RPCPAR_MODEL"] ?? "fixed",
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

class Connection {
  private readonly waiting = new Map<string, (reply: JsonRecord) => void>()
  private serial = 0
  private constructor(private readonly socket: Socket) {
    let buffer = ""
    socket.setEncoding("utf8")
    socket.on("data", (chunk: string) => {
      buffer += chunk
      let newline = buffer.indexOf("\n")
      while (newline !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf("\n")
        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }
        if (!isRecord(parsed) || parsed["type"] !== "response" || typeof parsed["id"] !== "string") continue
        this.waiting.get(parsed["id"])?.(parsed)
      }
    })
  }

  static async open(): Promise<Connection> {
    return new Connection((await connectAuthenticatedRpcSocket(socketPath, undefined, { keyRoot: agentDir })).socket)
  }

  /** Sends `record` and waits for the response that carries its id, or REPLY_WAIT_MS. */
  send(record: JsonRecord): Promise<Answer> {
    const id = typeof record["id"] === "string" ? record["id"] : `rpcpar-local-${++this.serial}`
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        resolve({ kind: "no_reply" })
      }, REPLY_WAIT_MS)
      this.waiting.set(id, (reply) => {
        clearTimeout(timer)
        this.waiting.delete(id)
        resolve({ kind: "reply", reply })
      })
      this.socket.write(`${JSON.stringify({ ...record, id })}\n`)
    })
  }

  async request(record: JsonRecord): Promise<JsonRecord> {
    const answer = await this.send(record)
    if (answer.kind !== "reply" || answer.reply["success"] !== true)
      throw new Error(`${String(record["type"])} failed: ${JSON.stringify(answer).slice(0, 300)}`)
    const data = answer.reply["data"]
    return isRecord(data) ? data : {}
  }

  close(): void {
    this.socket.end()
  }
}

let session: Connection | undefined
let endpoint: Connection | undefined
let fixture: { readonly local: string; readonly relay: string } | undefined

async function rowsOf(connection: Connection): Promise<JsonRecord[]> {
  const data = await connection.request({ type: "list_sessions", include_workers: true })
  return Array.isArray(data["sessions"]) ? data["sessions"].filter(isRecord) : []
}

async function setup(): Promise<JsonRecord> {
  session = await Connection.open()
  endpoint = await Connection.open()
  const opener = await Connection.open()
  const open = { type: "open_session", retain_on_disconnect: true, ...FIXTURE_MODEL }
  const local = String((await session.request(open))["sessionId"])
  const relay = String((await opener.request(open))["sessionId"])
  const rows = await rowsOf(session)
  opener.close()
  fixture = { local, relay }
  const row = (id: string) => rows.find((entry) => entry["sessionId"] === id) ?? {}
  const aliases: Record<string, string> = {}
  for (const [id, leg] of [
    [local, "local"],
    [relay, "relay"],
  ] as const) {
    aliases[id] = "<session>"
    for (const field of ["durableSessionId", "sessionPath"]) {
      const value = row(id)[field]
      if (typeof value === "string") aliases[value] = `<${field}>`
    }
    aliases[`${leg}:durable`] = String(row(id)["durableSessionId"] ?? "")
  }
  return { context: { sessionId: local }, relayDurable: aliases["relay:durable"], aliases }
}

/** Closes the fixtures and every other session in `ids` (sessions the sweep's records made, on either leg). */
async function teardown(ids: readonly string[]): Promise<JsonRecord> {
  const closer = await Connection.open()
  const rows = await rowsOf(closer)
  const wanted = new Set([...ids, ...(fixture === undefined ? [] : [fixture.local, fixture.relay])])
  const closed: string[] = []
  for (const row of rows) {
    const id = String(row["sessionId"])
    if (!wanted.has(id)) continue
    await closer.send({ type: "attach_session", sessionId: id, durableSessionId: row["durableSessionId"] })
    const answer = await closer.send({ type: "close_session", sessionId: id })
    if (answer.kind === "reply" && answer.reply["success"] === true) closed.push(id)
  }
  for (const connection of [closer, session, endpoint]) connection?.close()
  return { closed, wanted: wanted.size }
}

await serveLeg(async (request) => {
  switch (request["op"]) {
    case "setup":
      return await setup()
    case "send": {
      const connection = request["route"] === "session" ? session : endpoint
      if (connection === undefined || !isRecord(request["record"])) throw new Error("send before setup")
      return { answer: await connection.send(request["record"]) }
    }
    case "list": {
      const lister = await Connection.open()
      const sessions = await rowsOf(lister)
      lister.close()
      return { sessions }
    }
    case "teardown":
      return await teardown(Array.isArray(request["sessions"]) ? request["sessions"].map(String) : [])
    default:
      throw new Error(`unknown op ${String(request["op"])}`)
  }
})
