import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { createInboxDrain } from "../gateway/drain"
import { createLocalTransport } from "../gateway/local-transport"
import type { GatewayStore } from "../gateway/store"
import { createGatewayHarness, type GatewayHarness } from "../gateway/testing/harness"
import { FakeSessionRuntime } from "../gateway/testing/fake-runtime"
import type { DeliveryOutcome } from "../gateway/transport"
import { connectCarrierHost } from "./carrier-connection"
import type { CarrierWakeOutcome } from "./carrier"
import {
  processSameDeviceWake,
  startThreadWakeAtSession,
  type RunningThreadWake,
  type ThreadWakeLatch,
} from "./runtime"
import { HOST_STAMPED, FINISHED, startFakeEngineHost, type FakeEngineHost } from "./testing/fake-engine-host"
import { writeSessionFile } from "./testing/fake-wake-host"

// Fault injection for the held-session reports: a session on THIS device that no endpoint lists (a host restart parked
// it, or the carrier handed it back after a woken turn), under a dev engine whose version is a dev stamp on top of a
// release's CalVer. A send must answer waiting on the wake, the process's carrier must open the session on its host and
// send the engine's wake, and the session's own drain must then admit the delivery as a started turn. The fake engine
// host answers `wake` without running a drain, so the test runs the session's drain on that wake, as the engine's
// control endpoint does: the furthest real signal is the open_session + wake frames on the host and the row the drain
// admits as started.

const DEV_ENGINE = "2026.11.19-2-1-omob.6d05a3b.1975499+1795063675.1975499"
const PARKED = "0198b2c3-d4e5-7f60-8a1b-2c3d4e5f6a7b"
const GIB = 1024 ** 3
const directScope = { runInAsyncScope: <T>(fn: () => T): T => fn() }

let harness: GatewayHarness | undefined
let host: FakeEngineHost | undefined
let running: RunningThreadWake | undefined
afterEach(async () => {
  await running?.stop()
  running = undefined
  await host?.close()
  host = undefined
  await harness?.dispose()
  harness = undefined
})

/** Races `signal` against a 5 s circuit breaker that fails with `what`. */
async function within<T>(signal: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return await Promise.race([
    signal,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`waited 5s for ${what}, never fired`)), 5_000)
    }),
  ]).finally(() => clearTimeout(timer))
}

/** A one-shot signal armed before its trigger: `next()` returns the promise of the next value `fire` receives. */
function signals<T>(): { readonly next: () => Promise<T>; readonly fire: (value: T) => void } {
  const waiting: ((value: T) => void)[] = []
  return {
    next: () => new Promise<T>((resolve) => waiting.push(resolve)),
    fire: (value) => waiting.shift()?.(value),
  }
}

async function parkedSession() {
  const h = (harness = createGatewayHarness())
  const fake = (host = await startFakeEngineHost())
  const sessions = join(h.agentDir, "sessions")
  const parkedPath = writeSessionFile(sessions, PARKED)
  h.phantom(PARKED)
  const sender = h.session("sender")
  const base = h.store()
  const ends = signals<unknown>()
  // The carrier's hand-back ends the woken row; the test waits on that write instead of on time.
  const store: GatewayStore = {
    ...base,
    woken: {
      ...base.woken,
      end: async (fence) => {
        const ended = await base.woken.end(fence)
        if (fence.durable_id === PARKED) ends.fire(ended)
        return ended
      },
    },
  }
  const settings = () => ({ sameDevice: true, wakeLimit: 0 })
  const wakes = signals<CarrierWakeOutcome>()
  const latch: ThreadWakeLatch = {}
  startThreadWakeAtSession(
    { mode: "tui" },
    {
      options: {
        env: { HOME: h.agentDir },
        latch,
        store,
        engineVersion: DEV_ENGINE,
        connect: () => connectCarrierHost({ socket: fake.socketPath, keyRoot: () => h.agentDir }),
        ensureHost: async () => undefined,
        deliveries: async () => undefined,
        memoryHeadroom: () => 64 * GIB,
        schedule: () => () => undefined,
        onWake: (durableId, outcome) => {
          if (durableId === PARKED) wakes.fire(outcome)
        },
      },
      agentDir: () => h.agentDir,
      sessionsDirectory: () => sessions,
      settings,
      engineVersion: DEV_ENGINE,
      ensureHost: undefined,
      warn: () => undefined,
      scope: directScope,
    },
  )
  running = latch.running?.get(h.agentDir)
  const transport = createLocalTransport(
    sender.engine,
    processSameDeviceWake({
      options: { latch },
      store,
      agentDir: () => h.agentDir,
      sessionsDirectory: () => sessions,
      settings,
    }),
  )
  const send = (key: string): Promise<DeliveryOutcome> =>
    transport.deliver({
      sender: { kind: "session", durable_id: "sender" },
      caller_id: "sender",
      target: { kind: "local", thread_id: PARKED },
      text: `message ${key}`,
      mode: "auto",
      idempotency_key: key,
      args: {},
    })
  /** The engine's wake runs the session's own drain (registration.ts), gated on the woken row as production gates it. */
  const drainOnWake = async (deliveryId: string) => {
    const runtime = new FakeSessionRuntime(parkedPath, PARKED, "/work/project", { reopen: true })
    const drain = createInboxDrain({
      store,
      runtime,
      durableId: PARKED,
      sessionPath: () => parkedPath,
      wakeGated: () => store.woken.gated({ durable_id: PARKED }),
      admitIntake: async () => "admitted",
    })
    const emitted = new Promise<void>((resolve) => {
      runtime.onEmitted((id) => {
        if (id === deliveryId) resolve()
      })
    })
    await drain.drain({ reason: "command", delivery_ids: [deliveryId] })
    const admitted = (await store.deliveryView(deliveryId))?.row
    // The started turn emits the delivery's entry and ends cleanly; the emitted pass settles the row applied.
    await within(emitted, `the engine's entry for ${deliveryId}`)
    runtime.endTurn()
    await drain.drain({ reason: "emitted" })
    drain.stop()
    return { admitted, settled: (await store.deliveryView(deliveryId))?.row }
  }
  /** One delivery, start to finish: answered waiting on the wake, the session opened and woken, the delivery started. */
  const deliverAndResume = async (key: string) => {
    const woken = wakes.next()
    const answer = await send(key)
    if (answer.kind !== "ok" || answer.delivery_id === undefined)
      throw new Error(`the send failed: ${JSON.stringify(answer)}`)
    expect(answer.delivery).toEqual({ kind: "queued", queue_position: 1, waiting_on: { kind: "wake" } })
    expect(await within(woken, `the carrier's wake of ${PARKED} for ${key}`)).toMatchObject({ kind: "open" })
    expect(await store.woken.list()).toMatchObject([{ durable_id: PARKED, state: "open" }])
    const { admitted, settled } = await drainOnWake(answer.delivery_id)
    expect(admitted).toMatchObject({ state: "admitted", admission_kind: "started" })
    expect(settled).toMatchObject({ state: "applied", admission_kind: "started" })
  }
  /** The turn ended: the engine's lifecycle event makes the carrier look, and it hands the session back. */
  const handBack = async () => {
    const ended = ends.next()
    fake.emitLifecycle(parkedPath)
    expect(await within(ended, `the carrier's hand-back of ${PARKED}`)).toEqual({ kind: "ended" })
    expect(await store.woken.list()).toEqual([])
  }
  return { fake, store, parkedPath, running, deliverAndResume, handBack }
}

const framesOf = (fake: FakeEngineHost, type: string) => fake.frames.filter((frame) => frame.type === type)

describe("a delivery to a session a host restart parked on this device, under a dev engine", () => {
  test("#given the dev engine stamp 2026.11.19-2-1-omob... and a parked session no endpoint lists #when a session sends to it #then the carrier starts, the send answers queued waiting on the wake, the carrier opens and wakes the session, and its drain admits the delivery as started", async () => {
    const parked = await parkedSession()
    expect(parked.running).toBeDefined()
    await parked.deliverAndResume("parked-1")
    const [open] = framesOf(parked.fake, "open_session")
    expect(open).toMatchObject({ sessionPath: parked.parkedPath, retain_on_disconnect: true })
    expect(framesOf(parked.fake, "wake")).toHaveLength(1)
  })
})

describe("a session the carrier woke, ran and handed back, then sent to again", () => {
  test("#given a woken session whose turn ended cleanly and that the carrier released #when a later delivery arrives #then it is woken again: queued waiting on the wake, opened, and started", async () => {
    const parked = await parkedSession()
    await parked.deliverAndResume("first")
    await parked.handBack()
    expect(framesOf(parked.fake, "release_session")).toHaveLength(1)

    await parked.deliverAndResume("second")
    expect(framesOf(parked.fake, "open_session")).toHaveLength(2)
    expect(framesOf(parked.fake, "wake")).toHaveLength(2)
  })

  test("#given a woken session the engine held unattended when the carrier handed it back #when a later delivery arrives #then the stored hold does not block it: it is woken again and started", async () => {
    const parked = await parkedSession()
    await parked.deliverAndResume("first")
    parked.fake.setSnapshot(parked.parkedPath, HOST_STAMPED)
    await parked.handBack()
    expect(await parked.store.sessionWait.read({ durable_id: PARKED })).toMatchObject({ wait: "held" })

    // The carrier's own open adds no unattended hold (legacy-open.ts), and a delivery releases one in the engine.
    parked.fake.setSnapshot(parked.parkedPath, FINISHED)
    await parked.deliverAndResume("second")
    expect(framesOf(parked.fake, "open_session")).toHaveLength(2)
    expect(framesOf(parked.fake, "wake")).toHaveLength(2)
  })
})
