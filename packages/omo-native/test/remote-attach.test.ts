import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createConnection, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { connectDeviceService, type DeviceService } from "../../device-service-core/src/index.ts"
import { startFakeOwner, type FakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld, PEER, SESSION_ID } from "../../device-service-core/test/local-api/conformance/world.ts"
import { LOCAL_SESSION_ID, pipeAddress, REMOTE_INPUT_OFF, type RemoteAttachEndpoint, serveRemoteAttach } from "../remote-attach"

const owners: FakeOwner[] = []
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
    const id = randomUUID()
    const answered = new Promise<Line>(resolve => this.waiting.set(id, resolve))
    this.socket.write(`${JSON.stringify({ ...command, id })}\n`)
    return within(answered, `the ${String(command.type)} response`)
  }

  record(match: (line: Line) => boolean, what: string): Promise<Line> {
    const seen = this.records.find(match)
    if (seen) return Promise.resolve(seen)
    return within(new Promise<Line>(resolve => this.recordWaiters.push({ match, resolve })), what)
  }
}

async function endpointFor(world = defaultWorld()): Promise<RemoteAttachEndpoint> {
  const owner = await startFakeOwner({ stateDir: privateDir("ra-svc-"), world })
  owners.push(owner)
  const service = await connectDeviceService({ version: "5.1.52", stateDir: owner.stateDir })
  services.push(service)
  const attach = await service.attach(PEER, SESSION_ID)
  await attach.snapshot
  const endpoint = await serveRemoteAttach(attach, { label: `Studio/${SESSION_ID}`, parent: privateDir("ra-ep-") })
  endpoints.push(endpoint)
  return endpoint
}

describe.skipIf(process.platform === "win32")("omo remote attach endpoint", () => {
  test("answers the attach TUI's sequence from the device service's attach and refuses every input", async () => {
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
    expect(tui.records.find(line => line.method === "notify")).toMatchObject({ type: "extension_ui_request", method: "notify", message: `Observing Studio/${SESSION_ID}: ${REMOTE_INPUT_OFF}` })

    for (const type of ["prompt", "steer", "abort"]) {
      const refused = await tui.request({ type, sessionId: LOCAL_SESSION_ID, message: "hi" })
      expect([type, refused.success, refused.error]).toEqual([type, false, REMOTE_INPUT_OFF])
    }
    const answer = await tui.request({ type: "extension_ui_response", sessionId: LOCAL_SESSION_ID, confirmed: true })
    expect([answer.success, answer.error]).toEqual([false, REMOTE_INPUT_OFF])
    expect((await tui.request({ type: "release_attachment", sessionId: LOCAL_SESSION_ID })).success).toBe(true)
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
