import { afterEach, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  startFakeOwner,
  type FakeOwner,
} from "../../../../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld } from "../../../../../device-service-core/test/local-api/conformance/world.ts"
import { FakeExtensionAPI } from "../../../../test-support/fake-extension-api"
import { createThreadComponent } from "../component"
import { createGatewayHarness, type GatewayHarness } from "../gateway/testing/harness"
import type { ThreadHost } from "../tools"
import type { CarrierWakeOutcome } from "../wake/carrier"
import { connectCarrierHost } from "../wake/carrier-connection"
import type { ThreadWakeLatch } from "../wake/runtime"
import { startFakeEngineHost, type FakeEngineHost } from "../wake/testing/fake-engine-host"
import { writeSessionFile } from "../wake/testing/fake-wake-host"

// #13037: the production delivery consumer reaches the device service only through device-service-core's client. With
// no port injected, an engine at the wake minimum declares to the device service in its state directory, takes the
// record it is handed into the store, answers it, and the carrier opens the session.

const TARGET = "dur-target"
const PEER = "dev-peer-1"
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function unusedHost(): ThreadHost {
  const unused = async (): Promise<never> => {
    throw new Error("not used")
  }
  return {
    socket: "/tmp/thread-consumer-port.sock",
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

test("#given an engine at the wake minimum and no delivery port injected #when its device service hands a record for a session that is not running #then the record is queued through device-service-core's client, answered, and the session opens", async () => {
  const h: GatewayHarness = createGatewayHarness()
  cleanups.push(() => h.dispose())
  const fake: FakeEngineHost = await startFakeEngineHost()
  cleanups.push(() => fake.close())
  const stateDir = mkdtempSync(join(tmpdir(), "consumer-port-"))
  chmodSync(stateDir, 0o700)
  cleanups.push(() => rmSync(stateDir, { recursive: true, force: true }))
  const path = writeSessionFile(join(h.agentDir, "sessions"), TARGET, { cwd: process.cwd() })
  const owner: FakeOwner = await startFakeOwner({
    stateDir,
    world: {
      ...defaultWorld(),
      deliveries: {
        agent_dirs: [h.agentDir],
        admitted: [PEER],
        handed: [
          {
            command_id: "Y29tbWFuZC1pZC0wMDAwMQ",
            sender_device: PEER,
            durable_id: TARGET,
            record: {
              type: "admit_external_message",
              sessionId: TARGET,
              deliveryId: "d-from-peer",
              text: "OMO_GATEWAY v=1\nsource=peer_agent\n\nhello",
              displayText: "hello",
              sender: { kind: "agent", session_id: "sender-on-peer" },
              deliverAs: "followUp",
              chainCount: 1,
            },
          },
        ],
      },
    },
  })
  cleanups.push(() => owner.stop())
  const store = h.store()
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
    wake: {
      env: {},
      latch,
      store,
      loadConfig: () => ({ config: {} }),
      deviceServiceStateDir: stateDir,
      engineVersion: "2026.12.1",
      minimumEngine: "2026.12.1",
      connect: () => connectCarrierHost({ socket: fake.socketPath, keyRoot: () => h.agentDir }),
      ensureHost: async () => undefined,
      schedule: () => () => undefined,
      onWake: (durableId, value) => {
        if (durableId === TARGET) woken(value)
      },
    },
  }).register(pi as never, { logger: { info() {}, error() {}, warn() {} }, config: { getFlag: () => undefined } } as never)
  await pi.dispatch("session_start", { type: "session_start" }, { mode: "rpc", agentDir: h.agentDir })
  await latch.running?.get(h.agentDir)?.ready

  expect(await outcome).toMatchObject({ kind: "open" })
  expect(owner.state.log.filter((type) => type.startsWith("deliver") || type === "peer.admitted")).toEqual(
    expect.arrayContaining(["deliveries.serve", "delivery.answer", "peer.admitted"]),
  )
  expect((await store.list({ target_durable_id: TARGET })).map((row) => row.ledger_id)).toEqual([
    `device:${PEER}/d-from-peer`,
  ])
  expect(fake.frames.filter((frame) => frame.type === "open_session")).toEqual([
    expect.objectContaining({ sessionPath: path }),
  ])
})
