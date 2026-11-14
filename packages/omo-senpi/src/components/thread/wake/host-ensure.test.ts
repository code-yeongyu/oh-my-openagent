import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer, type Server } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../../test-support/fake-extension-api"
import { createThreadComponent } from "../component"
import { createInboxDrain } from "../gateway/drain"
import { FakeSessionRuntime } from "../gateway/testing/fake-runtime"
import { createGatewayHarness, type GatewayHarness } from "../gateway/testing/harness"
import { resolveThreadSocket } from "../live-surface-paths"
import type { ThreadHost } from "../tools"
import type { CarrierWakeOutcome } from "./carrier"
import { connectCarrierHost } from "./carrier-connection"
import type { ThreadWakeLatch } from "./runtime"
import { startFakeEngineHost, type FakeEngineHost } from "./testing/fake-engine-host"
import { writeSessionFile } from "./testing/fake-wake-host"

// Owner ruling 2026-11-14: the device's daemon being up is enough. With no operator host running, the carrier asks the
// engine's own `host ensure` for one (the engine CLI, as `host status --all` is asked), then opens the session on it.

const TARGET = "dur-target"
const FAKE_CLI = join(import.meta.dir, "testing", "fake-engine-cli.ts")
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function unusedHost(): ThreadHost {
  const unused = async (): Promise<never> => {
    throw new Error("not used")
  }
  return {
    socket: "/tmp/thread-wake-host-ensure.sock",
    listSessions: async () => [],
    openSession: unused,
    getMessages: unused,
    getState: unused,
    prompt: unused,
    interrupt: unused,
    setSessionName: unused,
    setModel: unused,
    getAvailableModels: unused,
    setThinkingLevel: unused,
    getAvailableThinkingLevels: unused,
  }
}

/** The engine CLI's side: each `host ensure` it is asked starts the operator host, which did not run before. */
async function engineCliControl(): Promise<{
  readonly path: string
  readonly calls: string[][]
  readonly host: () => FakeEngineHost | undefined
}> {
  const directory = mkdtempSync(join(tmpdir(), "engine-cli-"))
  const path = join(directory, "control.sock")
  const calls: string[][] = []
  let host: FakeEngineHost | undefined
  const server: Server = createServer((socket) => {
    socket.once("data", (chunk) => {
      calls.push(JSON.parse(chunk.toString("utf8").trim()) as string[])
      void (async () => {
        host ??= await startFakeEngineHost()
        socket.end(`${JSON.stringify({ line: { action: "start", reused: false }, exit: 0 })}\n`)
      })()
    })
  })
  await new Promise<void>((resolve) => server.listen(path, resolve))
  cleanups.push(async () => {
    await host?.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  })
  return { path, calls, host: () => host }
}

test("#given a pure-TUI engine and no operator host running #when its thread_send names a session that is not running #then the engine's host ensure starts the host, the session opens on it, and its drain admits the delivery once", async () => {
  const h: GatewayHarness = createGatewayHarness()
  cleanups.push(() => h.dispose())
  const control = await engineCliControl()
  const store = h.store()
  const path = writeSessionFile(join(h.agentDir, "sessions"), TARGET, { cwd: process.cwd() })
  const env = { HOME: h.agentDir, FAKE_ENGINE_CLI_CONTROL: control.path }
  const latch: ThreadWakeLatch = {}
  cleanups.push(async () => {
    for (const running of latch.running?.values() ?? []) await running.stop()
  })
  let woken: (outcome: CarrierWakeOutcome) => void = () => undefined
  const outcome = new Promise<CarrierWakeOutcome>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("waited 10s for the carrier to wake the session")), 10_000)
    woken = (value) => {
      clearTimeout(timer)
      resolve(value)
    }
  })
  const pi = new FakeExtensionAPI()
  pi.cwd = process.cwd()
  createThreadComponent({
    host: unusedHost(),
    stateDirectory: join(h.agentDir, "state"),
    agentDir: () => h.agentDir,
    store,
    callerSessionId: () => "dur-sender",
    wake: {
      env,
      latch,
      store,
      loadConfig: () => ({ config: {} }),
      engineLaunch: () => ({ command: process.execPath, prefixArgs: [FAKE_CLI] }),
      launchSpecPath: "/plugin/daemon-launch-spec.json",
      connect: () => {
        const running = control.host()
        if (running === undefined) return Promise.reject(new Error("no operator host is running"))
        return connectCarrierHost({ socket: running.socketPath, keyRoot: () => h.agentDir })
      },
      schedule: () => () => undefined,
      onWake: (durableId, value) => {
        if (durableId === TARGET) woken(value)
      },
    },
  }).register(pi as never, { logger: { info() {}, error() {}, warn() {} }, config: { getFlag: () => undefined } } as never)
  await pi.dispatch("session_start", { type: "session_start" }, { mode: "tui", agentDir: h.agentDir })
  expect(control.host()).toBeUndefined()

  const tool = pi.tools.find((entry) => entry.name === "thread_send") as {
    readonly execute: (...args: unknown[]) => Promise<{ readonly details: { readonly result: unknown } }>
  }
  const sent = await tool.execute("call-1", { thread: TARGET, message: "start the host" }, undefined, undefined, {})
  expect(sent.details.result).toMatchObject({ kind: "ok", delivery: { kind: "queued", waiting_on: { kind: "wake" } } })
  expect(await outcome).toMatchObject({ kind: "open" })

  expect(control.calls).toEqual([
    [
      "host",
      "ensure",
      "--launch-spec",
      "/plugin/daemon-launch-spec.json",
      "--socket",
      resolveThreadSocket(env),
      "--policy",
      "never",
      "--json",
    ],
  ])
  const fake = control.host()
  expect(fake?.frames.filter((frame) => frame.type === "open_session")).toEqual([
    expect.objectContaining({ sessionPath: path, retain_on_disconnect: true }),
  ])

  const runtime = new FakeSessionRuntime(path, TARGET, process.cwd(), { reopen: true })
  const drain = createInboxDrain({
    store,
    runtime,
    durableId: TARGET,
    sessionPath: () => path,
    wakeGated: () => store.woken.gated({ durable_id: TARGET }),
  })
  cleanups.push(() => drain.stop())
  const emitted = new Promise<void>((resolve) => runtime.onEmitted(() => resolve()))
  await drain.drain({ reason: "inbox" })
  await emitted
  await drain.drain({ reason: "emitted" })
  runtime.endTurn()
  await drain.drain({ reason: "idle" })
  await drain.drain({ reason: "inbox" })
  const [row] = await store.list({ target_durable_id: TARGET })
  expect(runtime.enqueueCalls.map((call) => call.delivery_id)).toEqual([row?.delivery_id])
})
