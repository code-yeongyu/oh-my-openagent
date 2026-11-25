// The X1a proof's two-device world, from the thread-tools QA kit (packages/omo-senpi/scripts/qa/thread-tools/lib):
//   REAL: this checkout's build, installed into the kit (launcher, plugin, thread SDK, CLI), the released senpi engine the
//         kit pins, and one engine host per device, each with its own HOME and agent dir.
//   FAKE: the model (the kit's fake model on loopback: QA-ACK answers and QA:HOLD turns), the account (two signed-in
//         devices) and the relay (world/fake-relay.ts: device A's device service, forwarding to B's engine host).
// Nothing leaves loopback and no account or credential exists; every wait is bounded and event-driven.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  buildOmoInstall,
  cleanupAll,
  ENGINE_VERSION,
  installCleanupHooks,
  makeScratch,
  omo,
  openHostSession,
  startFakeModel,
  startShardHost,
  awaitToolResult,
  type FakeModel,
  type OmoInstall,
  type Scratch,
} from "../../../../packages/omo-senpi/scripts/qa/thread-tools/lib/gateway.mjs"
import type { ToolSession } from "../drivers/tools.ts"
import { SWITCH_TO } from "../scenario.ts"
import { enginePort } from "./engine-port.ts"
import { type Device, type FakeRelay, startFakeRelay } from "./fake-relay.ts"
import { type Observer, observeB } from "./observe.ts"

export const DEVICE_A: Device = { id: "x1a-device-a", name: "x1a-a" }
export const DEVICE_B: Device = { id: "x1a-device-b", name: "x1a-b" }

export type World = {
  readonly engine: string
  readonly install: OmoInstall
  readonly a: Scratch
  readonly relay: FakeRelay
  readonly observer: Observer
  readonly fake: FakeModel
  readonly toolSession: () => Promise<ToolSession>
  readonly roots: readonly string[]
  readonly close: () => Promise<void>
}

// B's catalog gains a model that reasons, so the switch with a thinking suffix has a level to apply (#14939).
const addThinkingModel = (agentDir: string): void => {
  const path = join(agentDir, "models.json")
  const models = JSON.parse(readFileSync(path, "utf8"))
  const mock = models.providers.mock
  mock.models.push({ ...mock.models[0], id: SWITCH_TO.id, reasoning: true })
  writeFileSync(path, `${JSON.stringify(models, null, 2)}\n`)
}

export async function startWorld(trace: (line: string) => void): Promise<World> {
  installCleanupHooks()
  const install = await buildOmoInstall("x1a-proof")
  const fake = await startFakeModel()
  const a = makeScratch("x1a-a", fake)
  const b = makeScratch("x1a-b", fake)
  addThinkingModel(b.agentDir)
  const hostB = await startShardHost(b, install, "x1a-b")
  const relay = await startFakeRelay({ here: DEVICE_A, peer: DEVICE_B, engine: await enginePort(hostB.socket), trace })
  a.env["OMO_DEVICE_SERVICE_STATE_DIR"] = relay.stateDir
  // Device A's own engine host (its operator endpoint, rpc.sock), as a signed-in device runs it: a create or a send
  // from A asks it first, whichever device the thread lands on.
  const daemonA = await omo(a, install, ["daemon", "run", "--json"])
  if (daemonA.code !== 0)
    throw new Error(`device A's daemon did not start (${daemonA.code}): ${daemonA.stderr.slice(-800)}`)
  const observer = await observeB(hostB.socket, () => fake.heldTags())
  let session: ToolSession | undefined
  const toolSession = async (): Promise<ToolSession> => {
    if (session !== undefined) return session
    const hostA = await startShardHost(a, install, "x1a-a")
    const opened = await openHostSession(hostA.client, a.work)
    session = {
      prompt: async (text, tool) => {
        const from = fake.requests.length
        await hostA.client.request({ type: "prompt", sessionId: opened.routingId, message: text })
        return JSON.stringify(await awaitToolResult(fake, tool, from, { timeoutMs: 120_000 }))
      },
    }
    return session
  }
  return {
    engine: ENGINE_VERSION,
    install,
    a,
    relay,
    observer,
    fake,
    toolSession,
    roots: [a.dir, b.dir, relay.stateDir, install.root],
    close: async () => {
      observer.close()
      await relay.stop()
      await cleanupAll()
    },
  }
}
