import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { createInboxDrain } from "../gateway/drain"
import { createLocalTransport } from "../gateway/local-transport"
import type { GatewayStore } from "../gateway/store"
import { createGatewayHarness, type GatewayHarness } from "../gateway/testing/harness"
import { FakeSessionRuntime } from "../gateway/testing/fake-runtime"
import { connectCarrierHost } from "./carrier-connection"
import type { CarrierWakeOutcome } from "./carrier"
import { processSameDeviceWake, startThreadWakeAtSession, type RunningThreadWake, type ThreadWakeLatch } from "./runtime"
import { startFakeEngineHost, type FakeEngineHost } from "./testing/fake-engine-host"
import { writeSessionFile } from "./testing/fake-wake-host"

// Fault injection for the held-session report: a host restart on THIS device parked a session (its file is on disk, no
// endpoint lists it), and the engine is a dev build whose version is a dev stamp on top of a release's CalVer. The send
// must answer waiting on the wake, the process's carrier must open the session on its host and send the engine's wake,
// and the session's own drain must then admit the delivery as a started turn. The fake engine host answers `wake`
// without running a drain, so the test runs the session's drain on that wake, as the engine's control endpoint does:
// the furthest real signal is the open_session + wake frames on the host and the row the drain admits as started.

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

describe("a delivery to a session a host restart parked on this device, under a dev engine", () => {
  test("#given the dev engine stamp 2026.11.19-2-1-omob... and a parked session no endpoint lists #when a session sends to it #then the carrier starts, the send answers queued waiting on the wake, the carrier opens and wakes the session, and its drain admits the delivery as started", async () => {
    const h = (harness = createGatewayHarness())
    const fake = (host = await startFakeEngineHost())
    const sessions = join(h.agentDir, "sessions")
    const parkedPath = writeSessionFile(sessions, PARKED)
    h.phantom(PARKED)
    const sender = h.session("sender")
    const store: GatewayStore = h.store()
    const settings = () => ({ sameDevice: true, wakeLimit: 0 })

    // The wake outcome is subscribed before anything can trigger it.
    let woken: (outcome: CarrierWakeOutcome) => void = () => undefined
    const wokenOutcome = new Promise<CarrierWakeOutcome>((resolve) => {
      woken = resolve
    })
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
            if (durableId === PARKED) woken(outcome)
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
    expect(running).toBeDefined()

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
    const answer = await transport.deliver({
      sender: { kind: "session", durable_id: "sender" },
      caller_id: "sender",
      target: { kind: "local", thread_id: PARKED },
      text: "resume and answer",
      mode: "auto",
      idempotency_key: "parked-1",
      args: {},
    })
    if (answer.kind !== "ok") throw new Error(`the send failed: ${JSON.stringify(answer)}`)
    expect(answer.delivery).toEqual({ kind: "queued", queue_position: 1, waiting_on: { kind: "wake" } })

    let timer: ReturnType<typeof setTimeout> | undefined
    const outcome = await Promise.race([
      wokenOutcome,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`waited 5s for the carrier's wake of ${PARKED}, never fired`)), 5_000)
      }),
    ]).finally(() => clearTimeout(timer))
    expect(outcome).toMatchObject({ kind: "open" })
    const [open] = fake.frames.filter((frame) => frame.type === "open_session")
    expect(open).toMatchObject({ sessionPath: parkedPath, retain_on_disconnect: true })
    expect(fake.frames.filter((frame) => frame.type === "wake")).toHaveLength(1)
    expect(await store.woken.list()).toMatchObject([{ durable_id: PARKED, state: "open" }])

    // The engine's wake runs the session's own drain (registration.ts), gated on the woken row as production gates it.
    const runtime = new FakeSessionRuntime(parkedPath, PARKED, "/work/project", { reopen: true })
    const drain = createInboxDrain({
      store,
      runtime,
      durableId: PARKED,
      sessionPath: () => parkedPath,
      wakeGated: () => store.woken.gated({ durable_id: PARKED }),
      admitIntake: async () => "admitted",
    })
    await drain.drain({ reason: "command", delivery_ids: [answer.delivery_id] })
    drain.stop()
    const view = await store.deliveryView(answer.delivery_id)
    expect(view?.row).toMatchObject({ state: "admitted", admission_kind: "started" })
  })
})
