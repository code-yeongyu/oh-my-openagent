import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
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
import { engineHostEnsure } from "./host-ensure"

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
  readonly calls: { readonly argv: string[]; readonly env: Record<string, string> }[]
  readonly host: () => FakeEngineHost | undefined
}> {
  const directory = mkdtempSync(join(tmpdir(), "engine-cli-"))
  const path = join(directory, "control.sock")
  const calls: { readonly argv: string[]; readonly env: Record<string, string> }[] = []
  let host: FakeEngineHost | undefined
  const server: Server = createServer((socket) => {
    socket.once("data", (chunk) => {
      calls.push(JSON.parse(chunk.toString("utf8").trim()) as { readonly argv: string[]; readonly env: Record<string, string> })
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
      engineVersion: "2026.12.1",
      minimumEngine: "2026.12.1",
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

  expect(control.calls.map((call) => call.argv)).toEqual([
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

// #13456's LOW 3: from the source tree the packaged spec path is an unbuilt location; the ensure hands the CLI a spec
// that exists (the plugin's tracked spec), as the sibling packaged-asset components resolve theirs.
test("#given no launchSpecPath #when the carrier's ensure runs from the source tree #then the CLI is asked with a launch spec that exists on disk", async () => {
  const control = await engineCliControl()
  cleanups.push(async () => {
    await control.host()?.close()
  })
  const ensure = engineHostEnsure({
    env: { HOME: process.env.HOME, FAKE_ENGINE_CLI_CONTROL: control.path },
    socket: "/tmp/omo-wake-ensure-spec.sock",
    agentDir: "/tmp/omo-wake-ensure-agent",
    launch: () => ({ command: process.execPath, prefixArgs: [FAKE_CLI] }),
    warn: () => undefined,
  })
  await ensure()
  const [call] = control.calls
  expect(call).toBeDefined()
  const spec = call?.argv[3]
  expect(typeof spec).toBe("string")
  expect(existsSync(spec ?? "")).toBe(true)
})

// #13456's LOW 4: a host the carrier ensures runs with `omo daemon`'s own host env: the agent dir is named, and the
// user's configured host idle exit rides along instead of the launch spec's default.
test("#given a configured task.host_idle_exit_ms #when the carrier's ensure starts a host #then the CLI runs with the agent dir and the configured idle exit", async () => {
  const control = await engineCliControl()
  cleanups.push(async () => {
    await control.host()?.close()
  })
  const agentDir = mkdtempSync(join(tmpdir(), "omo-wake-ensure-agent-"))
  cleanups.push(() => rmSync(agentDir, { recursive: true, force: true }))
  const ensure = engineHostEnsure({
    env: { HOME: process.env.HOME, FAKE_ENGINE_CLI_CONTROL: control.path },
    socket: "/tmp/omo-wake-ensure-env.sock",
    agentDir,
    idleExitMs: () => 120_000,
    launch: () => ({ command: process.execPath, prefixArgs: [FAKE_CLI] }),
    warn: () => undefined,
  })
  await ensure()
  expect(control.calls[0]?.env).toEqual({ OMO_AGENT_DIR: agentDir, SENPI_RPC_HOST_IDLE_EXIT_MS: "120000" })
})

test("#given no configured idle exit #when the carrier's ensure starts a host #then the CLI runs with the agent dir and the spec's own default idle exit", async () => {
  const control = await engineCliControl()
  cleanups.push(async () => {
    await control.host()?.close()
  })
  const ensure = engineHostEnsure({
    env: { HOME: process.env.HOME, FAKE_ENGINE_CLI_CONTROL: control.path },
    socket: "/tmp/omo-wake-ensure-env.sock",
    agentDir: "/tmp/omo-wake-ensure-agent",
    launch: () => ({ command: process.execPath, prefixArgs: [FAKE_CLI] }),
    warn: () => undefined,
  })
  await ensure()
  expect(control.calls[0]?.env).toEqual({ OMO_AGENT_DIR: "/tmp/omo-wake-ensure-agent" })
})
