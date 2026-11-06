import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createConnection, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { connectDeviceService, type DeviceService } from "../../device-service-core/src/index.ts"
import { startFakeOwner, type FakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld, PEER, SESSION_ID, type World } from "../../device-service-core/test/local-api/conformance/world.ts"
import { LOCAL_SESSION_ID, pipeAddress, type RemoteAttachEndpoint, serveRemoteAttach } from "../remote-attach"

// Every inbound record type the pinned engine knows, from its own method table (senpi#4319), never a list kept here.
const engineDist = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))
const { RPC_METHOD_CLASS } = (await import(join(engineDist, "modes/rpc/method-classes.js"))) as { RPC_METHOD_CLASS: Record<string, unknown> }
const ENGINE_TYPES = Object.keys(RPC_METHOD_CLASS)
// The attach TUI's own handshake (senpi modes/interactive/attach.ts): the only records the endpoint answers itself.
const PLUMBING = new Set(["set_client_info", "list_sessions", "attach_session", "subscribe_sessions", "get_state", "get_entries", "release_attachment"])
// The hand list the endpoint used to keep (remote-attach.ts:24 at 72a6bae47e); the forwarded set must reach past it.
const OLD_INPUT_COMMANDS = new Set(["prompt", "steer", "follow_up", "abort", "bash", "compact", "new_session", "switch_session"])

const owners: FakeOwner[] = []
let lastOwner: FakeOwner | undefined
const ownerState = () => {
  if (lastOwner === undefined) throw new Error("no owner started")
  return lastOwner.state
}
const services: DeviceService[] = []
const endpoints: RemoteAttachEndpoint[] = []
const dirs: string[] = []

afterEach(async () => {
  for (const endpoint of endpoints.splice(0)) await endpoint.close()
  for (const service of services.splice(0)) service.close()
  for (const owner of owners.splice(0)) await owner.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const privateDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  chmodSync(dir, 0o700)
  dirs.push(dir)
  return dir
}

const within = <T>(promise: Promise<T>, what: string, ms = 5_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`waited ${ms} ms for ${what}, it never came`)), ms)
  })
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}

type Line = Record<string, unknown>

/** The attach TUI's side of the endpoint (senpi's AttachClient): the secret first, then JSONL requests and records. */
class TuiPeer {
  readonly records: Line[] = []
  private readonly waiting = new Map<string, (line: Line) => void>()
  private readonly recordWaiters: { readonly match: (line: Line) => boolean; readonly resolve: (line: Line) => void }[] = []
  readonly closed: Promise<void>

  constructor(readonly socket: Socket) {
    let buffer = ""
    socket.setEncoding("utf8")
    socket.on("data", (chunk: string) => {
      buffer += chunk
      let newline = buffer.indexOf("\n")
      while (newline !== -1) {
        const line = JSON.parse(buffer.slice(0, newline)) as Line
        buffer = buffer.slice(newline + 1)
        if (line.type === "response") this.waiting.get(String(line.id))?.(line)
        else {
          this.records.push(line)
          for (const waiter of [...this.recordWaiters]) if (waiter.match(line)) waiter.resolve(line)
        }
        newline = buffer.indexOf("\n")
      }
    })
    this.closed = new Promise(resolve => socket.once("close", () => resolve()))
  }

  static async connect(socketPath: string, secret = readFileSync(`${socketPath}.secret`)): Promise<TuiPeer> {
    const socket = createConnection(socketPath)
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve)
      socket.once("error", reject)
    })
    socket.write(secret)
    return new TuiPeer(socket)
  }

  request(command: Line): Promise<Line> {
    return this.answer({ ...command, id: randomUUID() })
  }

  /** Sends `record` exactly as given (its own id) and waits for the response on that id. */
  answer(record: Line): Promise<Line> {
    const id = String(record.id)
    const answered = new Promise<Line>(resolve => this.waiting.set(id, resolve))
    this.socket.write(`${JSON.stringify(record)}\n`)
    return within(answered, `the ${String(record.type)} response`)
  }

  record(match: (line: Line) => boolean, what: string): Promise<Line> {
    const seen = this.records.find(match)
    if (seen) return Promise.resolve(seen)
    return within(new Promise<Line>(resolve => this.recordWaiters.push({ match, resolve })), what)
  }
}

async function endpointFor(world: World = defaultWorld()): Promise<RemoteAttachEndpoint> {
  const owner = await startFakeOwner({ stateDir: privateDir("ra-svc-"), world })
  owners.push(owner)
  lastOwner = owner
  const service = await connectDeviceService({ version: "5.1.52", stateDir: owner.stateDir })
  services.push(service)
  const attach = await service.attach(PEER, SESSION_ID)
  await attach.snapshot
  const endpoint = await serveRemoteAttach(attach, { label: `Studio/${SESSION_ID}`, parent: privateDir("ra-ep-") })
  endpoints.push(endpoint)
  return endpoint
}

describe.skipIf(process.platform === "win32")("omo remote attach endpoint", () => {
  test("answers the attach TUI's handshake itself and sends none of it to the host", async () => {
    const endpoint = await endpointFor()
    const tui = await TuiPeer.connect(endpoint.socketPath)
    expect((await tui.request({ type: "set_client_info", width: 80, capabilities: ["interactive_user"] })).success).toBe(true)

    const listing = await tui.request({ type: "list_sessions", observe: true })
    const rows = (listing.data as { sessions: Line[] }).sessions
    expect(rows).toEqual([expect.objectContaining({ sessionId: LOCAL_SESSION_ID, durableSessionId: endpoint.sessionRef, retain_on_disconnect: true })])
    expect(endpoint.sessionRef).toBe(SESSION_ID)
    expect((await tui.request({ type: "attach_session", sessionId: LOCAL_SESSION_ID, durableSessionId: SESSION_ID })).success).toBe(true)
    expect(tui.records).toEqual([])
    expect((await tui.request({ type: "subscribe_sessions", sessions: { ids: [LOCAL_SESSION_ID] }, mirror: "all" })).data).toMatchObject({ snapshot: [] })

    const state = await tui.request({ type: "get_state", sessionId: LOCAL_SESSION_ID, observe: true })
    expect(state.data).toMatchObject({ sessionId: LOCAL_SESSION_ID, isStreaming: false })

    const tail = await tui.request({ type: "get_entries", sessionId: LOCAL_SESSION_ID, tail: 100, observe: true })
    expect(tail.data).toEqual({ entries: [{ id: "e-3", type: "message", text: "hello" }], leafId: null, next_before: "e-3" })
    const older = await tui.request({ type: "get_entries", sessionId: LOCAL_SESSION_ID, tail: 100, before: "e-3", observe: true })
    expect(older.data).toEqual({ entries: [{ id: "e-1", type: "message", text: "first" }], leafId: null })
    await tui.record(line => line.method === "notify" && String(line.message).includes("too large"), "the too-large notice")

    expect(await tui.record(line => line.type === "message_update", "the forwarded record")).toEqual({ type: "message_update", text: "hi", sessionId: LOCAL_SESSION_ID })
    expect(tui.records.find(line => line.method === "notify")).toMatchObject({ type: "extension_ui_request", method: "notify", message: `Attached to Studio/${SESSION_ID}` })
    expect((await tui.request({ type: "release_attachment", sessionId: LOCAL_SESSION_ID })).success).toBe(true)
    expect(ownerState().commands).toEqual([])
    expect(ownerState().log).not.toContain("session.command")
  })

  test("forwards every other engine record to the host unchanged and answers it on the same request id", async () => {
    const forwarded = ENGINE_TYPES.filter(type => !PLUMBING.has(type))
    expect(forwarded.filter(type => !OLD_INPUT_COMMANDS.has(type)).length).toBeGreaterThan(0)
    const endpoint = await endpointFor()
    const tui = await TuiPeer.connect(endpoint.socketPath)
    const sent: Line[] = []
    for (const type of forwarded) {
      const id = randomUUID()
      const record = { id, type, sessionId: LOCAL_SESSION_ID, probe: type }
      sent.push(record)
      const answer = await tui.answer(record)
      expect([type, answer.id, answer.command, answer.success, answer.error]).toEqual([type, id, type, true, undefined])
    }
    // LOCAL_SESSION_ID names the attached session, so it reaches the host as the route's session id (H1).
    expect(ownerState().commands).toEqual(sent.map(record => ({ ...record, sessionId: SESSION_ID })))
  })

  test("forwards a session-less record without a sessionId, and another session's id as it is, for the host to decide", async () => {
    const endpoint = await endpointFor()
    const tui = await TuiPeer.connect(endpoint.socketPath)
    const bare = { id: randomUUID(), type: "get_protocol_info" }
    const foreign = { id: randomUUID(), type: "get_commands", sessionId: "another-session" }
    expect((await tui.answer(bare)).success).toBe(true)
    expect((await tui.answer(foreign)).success).toBe(true)
    expect(ownerState().commands).toEqual([bare, foreign])
  })

  test("returns a delegated host's engine reply verbatim, with its data, on the request's own id", async () => {
    const base = defaultWorld()
    const [session] = base.sessions
    if (session === undefined) throw new Error("the default world has a session")
    const data = { commands: [{ name: "review", source: "extension" }] }
    const endpoint = await endpointFor({ ...base, sessions: [{ ...session, delegated: { data, frames: [] } }] })
    const tui = await TuiPeer.connect(endpoint.socketPath)
    const id = randomUUID()
    const answer = await tui.answer({ id, type: "get_commands", sessionId: LOCAL_SESSION_ID })
    expect(answer).toEqual({ type: "response", id, command: "get_commands", success: true, data })
  })

  test("reassembles a delegated reply too large for one line from its blob", async () => {
    const base = defaultWorld()
    const [session] = base.sessions
    if (session === undefined) throw new Error("the default world has a session")
    const data = { text: "x".repeat(700_000) }
    const endpoint = await endpointFor({ ...base, sessions: [{ ...session, delegated: { data, frames: [] } }] })
    const tui = await TuiPeer.connect(endpoint.socketPath)
    const answer = await tui.request({ type: "get_last_assistant_text", sessionId: LOCAL_SESSION_ID })
    expect([answer.success, answer.data]).toEqual([true, data])
  })

  test("relays the frames the engine writes on the delegated connection, as the presented session", async () => {
    const base = defaultWorld()
    const [session] = base.sessions
    if (session === undefined) throw new Error("the default world has a session")
    const dialog = { type: "extension_ui_request", id: "dialog-1", method: "confirm", title: "Run it?", sessionId: "rpc-1" }
    const endpoint = await endpointFor({ ...base, sessions: [{ ...session, delegated: { data: {}, frames: [dialog] } }] })
    const tui = await TuiPeer.connect(endpoint.socketPath)
    // Like the attach's records, frames reach the TUI once it subscribed, as the attach TUI does in its handshake.
    await tui.request({ type: "subscribe_sessions", sessions: { ids: [LOCAL_SESSION_ID] }, mirror: "all" })
    expect((await tui.request({ type: "prompt", sessionId: LOCAL_SESSION_ID, message: "go" })).success).toBe(true)
    expect(await tui.record(line => line.id === "dialog-1", "the relayed dialog frame")).toEqual({ ...dialog, sessionId: LOCAL_SESSION_ID })
  })

  test("shows the host's refusal verbatim", async () => {
    const base = defaultWorld()
    const [session] = base.sessions
    if (session === undefined) throw new Error("the default world has a session")
    const world: World = {
      ...base,
      sessions: [{ ...session, outcome: [{ state: "queued", retryable: false }, { state: "engine_refused", reason: "capability_missing", retryable: false }] }],
    }
    const endpoint = await endpointFor(world)
    const tui = await TuiPeer.connect(endpoint.socketPath)
    const answer = await tui.request({ type: "bash", sessionId: LOCAL_SESSION_ID, command: "ls" })
    expect([answer.command, answer.success, answer.error]).toEqual(["bash", false, "engine_refused: capability_missing"])
  })

  test("closes a connection that does not prove the secret before answering anything", async () => {
    const endpoint = await endpointFor()
    const tui = await TuiPeer.connect(endpoint.socketPath, Buffer.alloc(32, 7))
    tui.socket.write(`${JSON.stringify({ id: "x", type: "list_sessions" })}\n`)
    await within(tui.closed, "the refused connection to close")
    expect(tui.records).toEqual([])
  })

  test("keeps the endpoint private and removes it on close", async () => {
    const endpoint = await endpointFor()
    const dir = join(endpoint.socketPath, "..")
    expect(endpoint.socketPath).toMatch(/[\\/]t-[0-9a-f]{16}\.sock$/)
    expect((await Bun.file(`${endpoint.socketPath}.secret`).bytes()).length).toBe(32)
    const { statSync } = await import("node:fs")
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(`${endpoint.socketPath}.secret`).mode & 0o777).toBe(0o600)
    await endpoint.close()
    expect(existsSync(dir)).toBe(false)
  })
})

describe("pipeAddress", () => {
  test("derives the Windows pipe the attach TUI connects to from the canonical path and the secret", () => {
    const secret = Buffer.alloc(32, 1)
    const address = pipeAddress("C:\\Users\\A\\AppData\\Local\\Temp\\omo-ra-x\\t-0011223344556677.sock", secret)
    expect(address).toMatch(/^\\\\\.\\pipe\\senpi-rpc-[0-9a-f]{32}$/)
    expect(pipeAddress("c:/users/a/appdata/local/temp/omo-ra-x/t-0011223344556677.sock", secret)).toBe(address)
    expect(pipeAddress("C:\\Users\\A\\AppData\\Local\\Temp\\omo-ra-x\\t-0011223344556677.sock", Buffer.alloc(32, 2))).not.toBe(address)
  })
})
