import { randomUUID } from "node:crypto"
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createConnection, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { connectDeviceService, type DeviceService } from "../../device-service-core/src/index.ts"
import { startFakeOwner, type FakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import {
  defaultWorld,
  PEER,
  SESSION_ID,
  type World,
} from "../../device-service-core/test/local-api/conformance/world.ts"
import { type RemoteAttachEndpoint, serveRemoteAttach } from "../remote-attach"

// The attach endpoint's test rig, shared by the endpoint's test files: a fake device-service owner, a connected service
// attached to its session, the endpoint serving that attach, and the attach TUI's side of it.
const owners: FakeOwner[] = []
let lastOwner: FakeOwner | undefined
export const ownerState = () => {
  if (lastOwner === undefined) throw new Error("no owner started")
  return lastOwner.state
}
const services: DeviceService[] = []
const endpoints: RemoteAttachEndpoint[] = []
const dirs: string[] = []

export const cleanupAttachFixtures = async (): Promise<void> => {
  for (const endpoint of endpoints.splice(0)) await endpoint.close()
  for (const service of services.splice(0)) service.close()
  for (const owner of owners.splice(0)) await owner.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}

const privateDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  chmodSync(dir, 0o700)
  dirs.push(dir)
  return dir
}

export const within = <T>(promise: Promise<T>, what: string, ms = 5_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`waited ${ms} ms for ${what}, it never came`)), ms)
  })
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}

export type Line = Record<string, unknown>

/** The attach TUI's side of the endpoint (senpi's AttachClient): the secret first, then JSONL requests and records. */
export class TuiPeer {
  readonly records: Line[] = []
  private readonly waiting = new Map<string, (line: Line) => void>()
  private readonly recordWaiters: {
    readonly match: (line: Line) => boolean
    readonly resolve: (line: Line) => void
  }[] = []
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
    this.closed = new Promise((resolve) => socket.once("close", () => resolve()))
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
    const answered = new Promise<Line>((resolve) => this.waiting.set(id, resolve))
    this.socket.write(`${JSON.stringify(record)}\n`)
    return within(answered, `the ${String(record.type)} response`)
  }

  record(match: (line: Line) => boolean, what: string): Promise<Line> {
    const seen = this.records.find(match)
    if (seen) return Promise.resolve(seen)
    return within(new Promise<Line>((resolve) => this.recordWaiters.push({ match, resolve })), what)
  }
}

export async function endpointFor(world: World = defaultWorld()): Promise<RemoteAttachEndpoint> {
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
