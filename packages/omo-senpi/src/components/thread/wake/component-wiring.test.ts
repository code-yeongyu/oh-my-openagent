import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../../test-support/fake-extension-api"
import { createThreadComponent } from "../component"
import { createFakeDeliveryService, type FakeDeliveryService } from "../consumer/testing/fake-delivery-service"
import { createInboxDrain, type IntakeAdmission } from "../gateway/drain"
import type { GatewayStore } from "../gateway/store"
import { FakeSessionRuntime } from "../gateway/testing/fake-runtime"
import { createGatewayHarness, type GatewayHarness } from "../gateway/testing/harness"
import type { ThreadHost } from "../tools"
import type { CarrierWakeOutcome } from "./carrier"
import { connectCarrierHost } from "./carrier-connection"
import type { ThreadWakeLatch, ThreadWakeOptions } from "./runtime"
import { startFakeEngineHost, type FakeEngineHost } from "./testing/fake-engine-host"
import { writeSessionFile } from "./testing/fake-wake-host"

// #13037 wired into production: the thread component an engine process registers starts ONE carrier for its agent
// directory, gives the local transport the same-device wake, and (on an engine that drops a released session's retained
// record, A8.1) one delivery consumer. Driven through the real component, its real thread_send, a real store and an
// engine host on a real socket.

const TARGET = "dur-target"
let harness: GatewayHarness | undefined
let host: FakeEngineHost | undefined
const latches: ThreadWakeLatch[] = []
afterEach(async () => {
  for (const latch of latches.splice(0)) for (const running of latch.running?.values() ?? []) await running.stop()
  await host?.close()
  host = undefined
  await harness?.dispose()
  harness = undefined
})

function offlineHost(): ThreadHost {
  const unused = async (): Promise<never> => {
    throw new Error("not used")
  }
  return {
    socket: "/tmp/thread-wake-wiring.sock",
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

function context() {
  return { logger: { info() {}, error() {}, warn() {} }, config: { getFlag: () => undefined } }
}

type Wired = {
  readonly h: GatewayHarness
  readonly fake: FakeEngineHost
  readonly store: GatewayStore
  readonly path: string
  readonly latch: ThreadWakeLatch
  /** Resolves with the carrier's outcome for the target's next wake; armed before the trigger, fails after 5 s. */
  readonly woken: () => Promise<CarrierWakeOutcome>
  readonly start: (pi?: FakeExtensionAPI) => Promise<FakeExtensionAPI>
  readonly send: (pi: FakeExtensionAPI, text: string) => Promise<unknown>
}

async function wire(wake: Partial<ThreadWakeOptions> = {}): Promise<Wired> {
  const h = (harness = createGatewayHarness())
  const fake = (host = await startFakeEngineHost())
  const store = h.store()
  const path = writeSessionFile(join(h.agentDir, "sessions"), TARGET, { cwd: process.cwd() })
  const latch: ThreadWakeLatch = {}
  latches.push(latch)
  const outcomes: CarrierWakeOutcome[] = []
  let waiting: ((outcome: CarrierWakeOutcome) => void) | undefined
  const woken = (): Promise<CarrierWakeOutcome> =>
    new Promise((resolve, reject) => {
      const early = outcomes.shift()
      if (early !== undefined) return resolve(early)
      const timer = setTimeout(() => reject(new Error(`waited 5s for the carrier to wake ${TARGET}`)), 5_000)
      waiting = (outcome) => {
        clearTimeout(timer)
        resolve(outcome)
      }
    })
  const options: ThreadWakeOptions = {
    env: {},
    latch,
    store,
    connect: () => connectCarrierHost({ socket: fake.socketPath, keyRoot: () => h.agentDir }),
    schedule: () => () => undefined,
    onWake: (durableId, outcome) => {
      if (durableId !== TARGET) return
      const resolve = waiting
      waiting = undefined
      if (resolve === undefined) outcomes.push(outcome)
      else resolve(outcome)
    },
    ...wake,
  }
  const start = async (pi = new FakeExtensionAPI()): Promise<FakeExtensionAPI> => {
    pi.cwd = process.cwd()
    createThreadComponent({
      host: offlineHost(),
      stateDirectory: join(h.agentDir, "state"),
      agentDir: () => h.agentDir,
      store,
      callerSessionId: () => "dur-sender",
      wake: options,
    }).register(pi as never, context() as never)
    await pi.dispatch("session_start", { type: "session_start" }, { mode: "tui", agentDir: h.agentDir })
    await latch.running?.get(h.agentDir)?.ready
    return pi
  }
  const send = async (pi: FakeExtensionAPI, text: string): Promise<unknown> => {
    const tool = pi.tools.find((entry) => entry.name === "thread_send") as
      | { readonly execute: (...args: unknown[]) => Promise<{ readonly details: { readonly result: unknown } }> }
      | undefined
    if (tool === undefined) throw new Error("thread_send is not registered")
    return (await tool.execute("call-1", { thread: TARGET, message: text }, undefined, undefined, {})).details.result
  }
  return { h, fake, store, path, latch, woken, start, send }
}

async function drainWoken(
  store: GatewayStore,
  path: string,
  admitIntake?: (device: string) => Promise<IntakeAdmission>,
): Promise<readonly string[]> {
  const runtime = new FakeSessionRuntime(path, TARGET, process.cwd(), { reopen: true })
  const drain = createInboxDrain({
    store,
    runtime,
    durableId: TARGET,
    sessionPath: () => path,
    wakeGated: () => store.woken.gated({ durable_id: TARGET }),
    ...(admitIntake === undefined ? {} : { admitIntake }),
  })
  const emitted = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("waited 5s for the woken session to admit its delivery")), 5_000)
    runtime.onEmitted(() => {
      clearTimeout(timer)
      resolve()
    })
  })
  try {
    await drain.drain({ reason: "inbox" })
    await emitted
    await drain.drain({ reason: "emitted" })
    runtime.endTurn()
    await drain.drain({ reason: "idle" })
    await drain.drain({ reason: "inbox" })
  } finally {
    drain.stop()
  }
  return runtime.enqueueCalls.map((call) => call.delivery_id)
}

const opens = (fake: FakeEngineHost) => fake.frames.filter((frame) => frame.type === "open_session")

function inboundRecord(deliveryId: string): Record<string, unknown> {
  return {
    type: "admit_external_message",
    sessionId: TARGET,
    deliveryId,
    text: `OMO_GATEWAY v=1\nsource=peer_agent\n\n${deliveryId}`,
    displayText: deliveryId,
    sender: { kind: "agent", session_id: "sender-on-b" },
    deliverAs: "followUp",
    chainCount: 1,
  }
}

describe("the same-device wake through the registered thread component", () => {
  test("#given an engine process with the thread component and the same-device switch on #when its thread_send names a session that is not running #then the carrier opens that session by path on the operator host and its drain admits the delivery once", async () => {
    const w = await wire({ loadConfig: () => ({ config: { session_wake: { same_device: true } } }) })
    const pi = await w.start()
    const woken = w.woken()
    expect(await w.send(pi, "wake up and answer")).toMatchObject({
      kind: "ok",
      delivery: { kind: "queued", waiting_on: { kind: "wake" } },
    })
    expect(await woken).toMatchObject({ kind: "open" })
    expect(opens(w.fake)).toEqual([
      expect.objectContaining({ type: "open_session", sessionPath: w.path, retain_on_disconnect: true }),
    ])
    expect(w.fake.frames.filter((frame) => frame.type === "wake")).toHaveLength(1)
    const [row] = await w.store.list({ target_durable_id: TARGET })
    expect(await drainWoken(w.store, w.path)).toEqual([row?.delivery_id])
  })

  test("#given two sessions of one engine process register the thread component #when both start #then one carrier serves the agent directory", async () => {
    const w = await wire({ loadConfig: () => ({ config: { session_wake: { same_device: true } } }) })
    await w.start()
    const second = await w.start()
    expect(w.latch.running?.size).toBe(1)
    const woken = w.woken()
    await w.send(second, "from the second session")
    expect(await woken).toMatchObject({ kind: "open" })
    expect(opens(w.fake)).toHaveLength(1)
  })

  test.each([
    ["CI", { CI: "1" }],
    ["a task child", { OMO_SENPI_TASK_RPC_CHILD: "1" }],
  ])(
    "#given %s #when its thread_send names a session that is not running #then no carrier starts and the answer says the wake is unavailable",
    async (_what, env) => {
      const w = await wire({ env, loadConfig: () => ({ config: { session_wake: { same_device: true } } }) })
      const pi = await w.start()
      expect(w.latch.running?.size ?? 0).toBe(0)
      expect(await w.send(pi, "nobody carries this")).toMatchObject({
        kind: "ok",
        delivery: { kind: "queued_offline", reason: "wake_unavailable" },
      })
      expect(opens(w.fake)).toEqual([])
    },
  )
})

describe("the delivery consumer through the registered thread component", () => {
  const consumerWake = (service: FakeDeliveryService, engine: { readonly version: string; readonly minimum: string | null }) => ({
    deliveries: async () => service.port,
    engineVersion: engine.version,
    minimumEngine: engine.minimum,
  })

  test("#given an engine at the wake minimum and a device service that serves deliveries #when another device hands a delivery for a session that is not running #then the carrier opens it and its drain admits the delivery once", async () => {
    const service = createFakeDeliveryService({ admitted: true })
    service.ackServe({ wake: true })
    const w = await wire(consumerWake(service, { version: "2026.12.1", minimum: "2026.12.1" }))
    await w.start()
    expect(service.calls[0]).toEqual({ type: "deliveries.serve", agent_dir: w.h.agentDir, v: 1 })
    const woken = w.woken()
    const answer = await service.inbound({
      command_id: "c-1",
      sender_device: "device-b",
      durable_id: TARGET,
      record: inboundRecord("d-from-b"),
    })
    expect(answer.data).toMatchObject({ kind: "queued" })
    expect(await woken).toMatchObject({ kind: "open" })
    expect(opens(w.fake)).toEqual([expect.objectContaining({ sessionPath: w.path })])
    const running = w.latch.running?.get(w.h.agentDir)
    const [row] = await w.store.list({ target_durable_id: TARGET })
    const ledger = row?.ledger_id ?? ""
    expect(ledger).toBe("device:device-b/d-from-b")
    expect(await drainWoken(w.store, w.path, running?.admitIntake)).toEqual([ledger])
    expect(service.calls).toContainEqual({ type: "peer.admitted", device: "device-b" })
  })

  // A8.1: below the engine release that drops a released session's retained record (senpi#6449), the consumer makes no
  // wake registration with the device service. The minimum is null until that release exists, so nothing registers.
  test.each([
    ["the shipped minimum (none released)", { version: "2099.1.1", minimum: undefined }],
    ["an engine below the minimum", { version: "2026.11.13", minimum: "2026.12.1" }],
    ["an engine that reports no version", { version: undefined, minimum: "2026.12.1" }],
  ])("#given %s #when the component starts #then no consumer declares itself", async (_what, engine) => {
    const service = createFakeDeliveryService({ admitted: true })
    const w = await wire({
      deliveries: async () => service.port,
      ...(engine.version === undefined ? {} : { engineVersion: engine.version }),
      ...(engine.minimum === undefined ? {} : { minimumEngine: engine.minimum }),
    })
    await w.start()
    expect(w.latch.running?.size).toBe(1)
    expect(service.calls).toEqual([])
  })
})
