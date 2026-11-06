import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { type ChildProcess, spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"

import { connectDeviceService, type DeviceService } from "../../device-service-core/src/index.ts"
import type { LocalRequest } from "../../device-service-core/src/local-api/protocol.ts"
import { startFakeOwner, type FakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld } from "../../device-service-core/test/local-api/conformance/world.ts"
import { deviceKeys } from "../../device-service-core/test/local-api/support.ts"
import { resolveSenpi } from "../bin/lib/package-paths.js"

// #12379 against a REAL engine started the way the desktop starts it:
// the pinned senpi CLI with `--mode rpc --multi-session` and the tracked omo plugin, from a clean environment with an
// explicit agent dir. The device service is the in-repo owner (a real local socket with the mutual proof) at the
// engine's own `~/.omo/device-service`; a multi-session engine runs no session_start until a session opens.

const PLUGIN = resolve(import.meta.dir, "..", "..", "omo-senpi", "plugin")
const TEST_BUDGET_MS = 60_000
setDefaultTimeout(TEST_BUDGET_MS)

const roots: string[] = []
const engines = new Set<ChildProcess>()
const owners: FakeOwner[] = []
const clients: DeviceService[] = []

afterEach(async () => {
  for (const engine of engines) engine.kill("SIGKILL")
  engines.clear()
  for (const client of clients.splice(0)) client.close()
  for (const owner of owners.splice(0)) await owner.stop()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const within = <T>(promise: Promise<T>, what: string, ms = 30_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`waited ${ms} ms for ${what}, it never came`)), ms)
  })
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}

function sandbox() {
  const home = mkdtempSync("/tmp/dsr-e.")
  roots.push(home)
  const agentDir = join(home, "agents", "desktop-engine")
  const stateDir = join(home, ".omo", "device-service")
  mkdirSync(agentDir, { recursive: true, mode: 0o700 })
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  return { home, agentDir, stateDir }
}

type Owner = { readonly owner: FakeOwner; readonly next: (type: LocalRequest["type"], what: string) => Promise<void> }

async function ownerAt(stateDir: string): Promise<Owner> {
  const waiters: { readonly type: LocalRequest["type"]; readonly resolve: () => void }[] = []
  const owner = await startFakeOwner({
    stateDir,
    world: defaultWorld(),
    onRequest: type => {
      for (const waiter of waiters.filter(entry => entry.type === type)) {
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.resolve()
      }
    },
  })
  owners.push(owner)
  const next = (type: LocalRequest["type"], what: string) => within(new Promise<void>(resolve => waiters.push({ type, resolve })), what)
  return { owner, next }
}

function startEngine(home: string, agentDir: string) {
  const engine = spawn(process.execPath, [resolveSenpi().cliPath, "--mode", "rpc", "--multi-session", "-e", PLUGIN], {
    env: {
      HOME: home,
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      TMPDIR: home,
      OMO_CODING_AGENT_DIR: agentDir,
      SENPI_CODING_AGENT_DIR: agentDir,
      PI_CODING_AGENT_DIR: agentDir,
    },
    stdio: ["pipe", "pipe", "inherit"],
  })
  engines.add(engine)
  let buffered = ""
  const replies: { readonly id: string; readonly resolve: (line: unknown) => void }[] = []
  engine.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
    buffered += chunk
    for (let newline = buffered.indexOf("\n"); newline !== -1; newline = buffered.indexOf("\n")) {
      const line = buffered.slice(0, newline)
      buffered = buffered.slice(newline + 1)
      let message: unknown
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      const id = typeof message === "object" && message !== null && "id" in message ? message.id : undefined
      const waiter = replies.find(entry => entry.id === id)
      if (waiter !== undefined) {
        replies.splice(replies.indexOf(waiter), 1)
        waiter.resolve(message)
      }
    }
  })
  const request = (command: Record<string, unknown> & { readonly id: string }, what: string) => {
    const reply = within(new Promise<unknown>(resolveReply => replies.push({ id: command.id, resolve: resolveReply })), what)
    engine.stdin?.write(`${JSON.stringify(command)}\n`)
    return reply
  }
  const openSession = async (id: string): Promise<string> => {
    const reply = await request({ id, type: "open_session", cwd: home }, `the reply to ${id}`)
    const data = typeof reply === "object" && reply !== null && "data" in reply ? reply.data : undefined
    const sessionId = typeof data === "object" && data !== null && "sessionId" in data ? data.sessionId : undefined
    if (typeof sessionId !== "string") throw new Error(`open_session answered no session: ${JSON.stringify(reply)}`)
    return sessionId
  }
  return { request, openSession }
}

async function clientAt(stateDir: string): Promise<DeviceService> {
  const client = await connectDeviceService({ version: "5.1.60", stateDir })
  clients.push(client)
  return client
}

const credential = (id: string) => {
  const keys = deviceKeys()
  return { device: { id, name: id }, signingPrivateKey: keys.signing, sealingPrivateKey: keys.sealing }
}

describe.skipIf(process.platform === "win32")("a real RPC engine registers its own agent dir with the device service (#12379)", () => {
  test("the engine registers the agent dir it runs with, and nothing else, with no manual register", async () => {
    const { home, agentDir, stateDir } = sandbox()
    const { owner, next } = await ownerAt(stateDir)
    const registered = next("endpoints.register", "the engine's register")

    await startEngine(home, agentDir).openSession("open-1")

    await registered
    expect([...owner.state.endpoints]).toEqual([agentDir])
  })

  test("a fresh service on the same state dir gets the register again while the engine stays up", async () => {
    const { home, agentDir, stateDir } = sandbox()
    const first = await ownerAt(stateDir)
    const registered = first.next("endpoints.register", "the first register")
    await startEngine(home, agentDir).openSession("open-1")
    await registered

    owners.splice(owners.indexOf(first.owner), 1)
    await first.owner.stop()
    const second = await ownerAt(stateDir)
    await second.next("endpoints.register", "the register on the restarted service")

    expect([...second.owner.state.endpoints]).toEqual([agentDir])
  })

  test("after the session that started the registrant closes, the registrant still answers a device change", async () => {
    const { home, agentDir, stateDir } = sandbox()
    const { owner, next } = await ownerAt(stateDir)
    const registered = next("endpoints.register", "the first register")
    const engine = startEngine(home, agentDir)
    const first = await engine.openSession("open-1")
    await registered
    await engine.openSession("open-2")

    await engine.request({ id: "close-1", type: "close_session", sessionId: first }, "the first session closing")
    const other = await clientAt(stateDir)
    const reRegistered = next("endpoints.register", "the register for the newly adopted device")
    await other.forget()
    await other.adopt(credential("dev-new"))

    await reRegistered
    expect([...owner.state.endpoints]).toEqual([agentDir])
  })
})
