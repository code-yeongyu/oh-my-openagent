import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
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
  /** Every delay the carrier asked its schedule seam to arm. */
  readonly scheduled: readonly number[]
  /** Resolves with the carrier's outcome for the target's next wake; armed before the trigger, fails after 5 s. */
  readonly woken: () => Promise<CarrierWakeOutcome>
  readonly start: (pi?: FakeExtensionAPI) => Promise<FakeExtensionAPI>
  readonly send: (pi: FakeExtensionAPI, text: string) => Promise<unknown>
}

/** An engine at the wake minimum (A8.1): the least version at which a carrier may open a woken session. */
const ENGINE_AT_MINIMUM: Pick<ThreadWakeOptions, "engineVersion" | "minimumEngine"> = {
  engineVersion: "2026.12.1",
  minimumEngine: "2026.12.1",
}

async function wire(wake: Partial<ThreadWakeOptions> = {}, targetCwd: string = process.cwd()): Promise<Wired> {
  const h = (harness = createGatewayHarness())
  const fake = (host = await startFakeEngineHost())
  const store = h.store()
  const path = writeSessionFile(join(h.agentDir, "sessions"), TARGET, { cwd: targetCwd })
  const latch: ThreadWakeLatch = {}
  latches.push(latch)
  const scheduled: number[] = []
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
    ensureHost: async () => undefined,
    schedule: (_run, ms) => {
      scheduled.push(ms)
      return () => undefined
    },
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
    // The wake runtime is a lazy sidecar: awaiting the same (cached) module lets the component's start callback run
    // first, so the latch below is settled, never a race with the import.
    await import("#omo-wake-runtime")
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
  return { h, fake, store, path, latch, scheduled, woken, start, send }
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
    const w = await wire({ ...ENGINE_AT_MINIMUM, loadConfig: () => ({ config: { session_wake: { same_device: true } } }) })
    const pi = await w.start()
    const woken = w.woken()
    expect(await w.send(pi, "wake up and answer")).toMatchObject({
      kind: "ok",
      delivery: { kind: "queued", waiting_on: { kind: "wake" } },
    })
    expect(await woken).toMatchObject({ kind: "open" })
    // The exact frame: the wake open carries its path, the target session's cwd and retain_on_disconnect, and
    // nothing else (no permission preset, no attended field) beside the transport's request id.
    const [first] = opens(w.fake)
    const { id, ...frame } = (first ?? {}) as { readonly id?: unknown } & Record<string, unknown>
    expect(typeof id).toBe("string")
    expect(frame).toEqual({ type: "open_session", sessionPath: w.path, cwd: process.cwd(), retain_on_disconnect: true })
    expect(w.fake.frames.filter((frame) => frame.type === "wake")).toHaveLength(1)
    const [row] = await w.store.list({ target_durable_id: TARGET })
    expect(await drainWoken(w.store, w.path)).toEqual([row?.delivery_id])
  })

  // The default answer with no configuration override: nothing is set, so the schema default decides and the send
  // wakes its target exactly as an explicit opt-in would.
  test("#given an omo configuration with no session_wake setting at all #when thread_send names a session that is not running #then the carrier opens it and its drain admits the delivery once", async () => {
    const noConfigHome = mkdtempSync("/tmp/omo-wake-no-config-")
    const w = await wire({ ...ENGINE_AT_MINIMUM, env: { HOME: noConfigHome } })
    const pi = await w.start()
    const woken = w.woken()
    expect(await w.send(pi, "no setting needed")).toMatchObject({
      kind: "ok",
      delivery: { kind: "queued", waiting_on: { kind: "wake" } },
    })
    expect(await woken).toMatchObject({ kind: "open" })
    expect(opens(w.fake)).toEqual([expect.objectContaining({ sessionPath: w.path })])
    const [row] = await w.store.list({ target_durable_id: TARGET })
    expect(await drainWoken(w.store, w.path)).toEqual([row?.delivery_id])
  })

  test("#given two sessions of one engine process register the thread component #when both start #then one carrier serves the agent directory", async () => {
    const w = await wire({ ...ENGINE_AT_MINIMUM, loadConfig: () => ({ config: { session_wake: { same_device: true } } }) })
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
      const w = await wire({ ...ENGINE_AT_MINIMUM, env, loadConfig: () => ({ config: { session_wake: { same_device: true } } }) })
      const pi = await w.start()
      expect(w.latch.running?.size ?? 0).toBe(0)
      expect(await w.send(pi, "nobody carries this")).toMatchObject({
        kind: "ok",
        delivery: { kind: "queued_offline", reason: "wake_unavailable" },
      })
      expect(opens(w.fake)).toEqual([])
    },
  )

  // The MEDIUM of the #13455 review: the same engine minimum the delivery consumer reads (A8.1) gates the carrier's
  // opens too. Below it a wake never opens a session, so the sender's answer is the pre-wake one.
  test("#given an engine below the wake minimum #when its thread_send names a session that is not running #then no carrier starts and the answer says the wake is unavailable", async () => {
    const w = await wire({
      engineVersion: "2026.11.13",
      minimumEngine: "2026.12.1",
      loadConfig: () => ({ config: { session_wake: { same_device: true } } }),
    })
    const pi = await w.start()
    expect(w.latch.running?.size ?? 0).toBe(0)
    expect(await w.send(pi, "an older engine carries no wake")).toMatchObject({
      kind: "ok",
      delivery: { kind: "queued_offline", reason: "wake_unavailable" },
    })
    expect(opens(w.fake)).toEqual([])
  })

  test("#given a session_start whose engine mode is neither tui nor rpc #when the component registers #then no carrier starts", async () => {
    const w = await wire(ENGINE_AT_MINIMUM)
    const pi = new FakeExtensionAPI()
    pi.cwd = process.cwd()
    createThreadComponent({
      host: offlineHost(),
      stateDirectory: join(w.h.agentDir, "state"),
      agentDir: () => w.h.agentDir,
      store: w.store,
      callerSessionId: () => "dur-sender",
      wake: {
        env: {},
        latch: w.latch,
        store: w.store,
        ...ENGINE_AT_MINIMUM,
        connect: () => Promise.reject(new Error("no carrier may open a session")),
        schedule: () => () => undefined,
      },
    }).register(pi as never, context() as never)
    await pi.dispatch("session_start", { type: "session_start" }, { mode: "child", agentDir: w.h.agentDir })
    expect(w.latch.running?.size ?? 0).toBe(0)
  })

  // The LOW of the #13455 review: `session_wake.same_device` is read for the TARGET session's cwd (its project's
  // configuration), never the first registering session's workspace root.
  test("#given the target session's project turns same_device on and the sender's project does not #when a send names it #then the wake is read for the target session's cwd and the carrier opens it", async () => {
    // A different directory of the caller's own worktree, so the send stays inside the caller's workspace scope while
    // naming a cwd whose omo configuration differs from the sender's.
    const targetCwd = join(process.cwd(), "test-support")
    const w = await wire(
      {
        ...ENGINE_AT_MINIMUM,
        loadConfig: ({ cwd }) => ({ config: cwd === targetCwd ? { session_wake: { same_device: true } } : {} }),
      },
      targetCwd,
    )
    const pi = await w.start()
    const woken = w.woken()
    expect(await w.send(pi, "your project asked for this")).toMatchObject({
      kind: "ok",
      delivery: { kind: "queued", waiting_on: { kind: "wake" } },
    })
    expect(await woken).toMatchObject({ kind: "open" })
    expect(opens(w.fake)).toHaveLength(1)
  })

  test("#given an empty wake table #when the component starts on an engine at the minimum #then the carrier arms no sweep timer and opens no session", async () => {
    const w = await wire(ENGINE_AT_MINIMUM)
    await w.start()
    expect(w.latch.running?.size).toBe(1)
    expect(w.scheduled).toEqual([])
    expect(opens(w.fake)).toEqual([])
  })
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

  test("#given a serving consumer whose device service names no wake switch #when another device hands a delivery for a session that is not running #then the carrier opens it all the same", async () => {
    const service = createFakeDeliveryService({ admitted: true })
    service.ackServe({})
    const w = await wire(consumerWake(service, { version: "2026.12.1", minimum: "2026.12.1" }))
    await w.start()
    const woken = w.woken()
    const answer = await service.inbound({
      command_id: "c-2",
      sender_device: "device-b",
      durable_id: TARGET,
      record: inboundRecord("d-no-switch"),
    })
    expect(answer.data).toMatchObject({ kind: "queued" })
    expect(await woken).toMatchObject({ kind: "open" })
    expect(opens(w.fake)).toEqual([expect.objectContaining({ sessionPath: w.path })])
  })

  // #13456's LOW 1: a remote row the consumer's own STARTUP pending sweep wakes must read the carrier's gate as on.
  test("#given a queued row from another device waiting before the engine starts #when the consumer's startup pending sweep wakes it #then the carrier opens it at once", async () => {
    const service = createFakeDeliveryService({ admitted: true })
    service.ackServe({ wake: true })
    const w = await wire(consumerWake(service, { version: "2026.12.1", minimum: "2026.12.1" }))
    expect(
      (
        await w.store.intake({
          now: w.h.clock.now,
          attested_device: "device-b",
          record: {
            sessionId: TARGET,
            deliveryId: "d-early",
            text: "OMO_GATEWAY v=1\nsource=peer_agent\nd-early",
            displayText: "d-early",
            sender: { kind: "agent", session_id: "sender-on-b" },
            deliverAs: "followUp",
            chainCount: 1,
          },
          provenance: { workspace: "remote", project: "remote" },
          target_session_kind: "interactive",
        })
      ).kind,
    ).toBe("queued")
    const woken = w.woken()
    await w.start()
    expect(await woken).toMatchObject({ kind: "open" })
    expect(opens(w.fake)).toHaveLength(1)
  })

  // A8.1: below the engine release that drops a released session's retained record (senpi#6449), the consumer makes no
  // wake registration with the device service, and no carrier starts at all. The minimum is null until that release
  // exists, so nothing registers.
  test.each([
    ["the shipped minimum (none released)", { version: "2099.1.1", minimum: undefined }],
    ["an engine below the minimum", { version: "2026.11.13", minimum: "2026.12.1" }],
    ["an engine that reports no version", { version: undefined, minimum: "2026.12.1" }],
  ])("#given %s #when the component starts #then no carrier starts and no consumer declares itself", async (_what, engine) => {
    const service = createFakeDeliveryService({ admitted: true })
    const w = await wire({
      deliveries: async () => service.port,
      ...(engine.version === undefined ? {} : { engineVersion: engine.version }),
      ...(engine.minimum === undefined ? {} : { minimumEngine: engine.minimum }),
    })
    await w.start()
    expect(w.latch.running?.size ?? 0).toBe(0)
    expect(service.calls).toEqual([])
  })
})
