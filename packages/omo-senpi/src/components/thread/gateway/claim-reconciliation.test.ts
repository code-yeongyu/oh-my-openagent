import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { join } from "node:path"

import { createInboxDrain } from "./drain"
import { processStartTime } from "./process-identity"
import { FakeSessionRuntime } from "./testing/fake-runtime"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import type { DeliveryRow, GatewayDeliveryResult, ProcessIdentity } from "./types"

let harness: GatewayHarness | undefined

afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

async function spawnHolder(): Promise<{ readonly identity: ProcessIdentity; readonly stop: () => Promise<void> }> {
  const child = Bun.spawn(["cat"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
  const startTime = await processStartTime(child.pid)
  if (startTime === null) throw new Error("could not read the start time of the holder process")
  let stopped: Promise<void> | undefined
  return {
    identity: { pid: child.pid, process_start_time: startTime, instance_id: randomUUID() },
    stop: () => {
      stopped ??= (async () => {
        child.stdin.end()
        await child.exited
      })()
      return stopped
    },
  }
}

async function deadIdentity(): Promise<ProcessIdentity> {
  const holder = await spawnHolder()
  await holder.stop()
  return holder.identity
}

function okId(result: GatewayDeliveryResult): string {
  if (result.kind !== "ok") throw new Error(`expected ok, got ${JSON.stringify(result)}`)
  return result.delivery_id
}

async function crashingPass(h: GatewayHarness, runtime: FakeSessionRuntime, identity: ProcessIdentity, stage: "afterClaim" | "afterAdmit"): Promise<void> {
  const crash = (): never => {
    throw new Error(`simulated crash ${stage}`)
  }
  const drain = createInboxDrain({
    store: h.store(),
    runtime,
    durableId: "B",
    sessionPath: () => runtime.sessionPath,
    _test: { identity, ...(stage === "afterClaim" ? { afterClaim: (_row: DeliveryRow) => crash() } : { afterAdmit: (_row: DeliveryRow, _kind: string) => crash() }) },
  })
  await expect(drain.drain({ reason: "start" })).rejects.toThrow(`simulated crash ${stage}`)
}

/**
 * The target B as a bare runtime: no drain is attached to its `emitted` edge, so after a simulated
 * crash nothing in this process can settle B's rows; only the fresh process's reconciliation does.
 */
function crashedTarget(h: GatewayHarness): { readonly runtime: FakeSessionRuntime; readonly view: (id: string) => Promise<DeliveryRow | undefined> } {
  h.phantom("B")
  const runtime = new FakeSessionRuntime(join(h.agentDir, "sessions", "B.jsonl"), "B", h.agentDir)
  const store = h.store()
  return { runtime, view: async (id) => (await store.deliveryView(id))?.row }
}

async function sendToB(h: GatewayHarness, text: string): Promise<string> {
  return okId(await h.get("A").engine.deliver({ sender: { kind: "session", durable_id: "A" }, target: "B", text }))
}

function freshProcess(h: GatewayHarness, sessionPath: string): { readonly runtime: FakeSessionRuntime; readonly drain: ReturnType<typeof createInboxDrain>; readonly log: string[] } {
  const runtime = new FakeSessionRuntime(sessionPath, "B", h.agentDir, { reopen: true })
  const log: string[] = []
  const drain = createInboxDrain({ store: h.store(), runtime, durableId: "B", sessionPath: () => sessionPath, log: (line) => log.push(line) })
  return { runtime, drain, log }
}

describe("claim_reconciliation", () => {
  test("#given a claimant died after T1 and before calling the runtime #when a fresh process drains #then the row is re-admitted exactly once", async () => {
    const h = (harness = createGatewayHarness())
    h.session("A")
    const b = crashedTarget(h)
    const id = await sendToB(h, "i")
    await crashingPass(h, b.runtime, await deadIdentity(), "afterClaim")
    expect((await b.view(id))?.state).toBe("admitting")
    expect(b.runtime.enqueueCalls).toEqual([])
    const next = freshProcess(h, b.runtime.sessionPath)
    const result = await next.drain.drain({ reason: "start" })
    expect(result.admitted).toEqual([{ delivery_id: id, kind: "started" }])
    expect(next.runtime.enqueueCount(id)).toBe(1)
  })

  test("#given a claimant died after the runtime wrote the entry and before T2 #when a fresh process drains #then the disk token makes the row applied and nothing is re-admitted", async () => {
    const h = (harness = createGatewayHarness())
    h.session("A")
    const b = crashedTarget(h)
    const id = await sendToB(h, "ii")
    await crashingPass(h, b.runtime, await deadIdentity(), "afterAdmit")
    expect({ state: (await b.view(id))?.state, entries: b.runtime.transcriptEntries(id) }).toEqual({ state: "admitting", entries: 1 })
    const next = freshProcess(h, b.runtime.sessionPath)
    await next.drain.drain({ reason: "start" })
    expect({ state: (await b.view(id))?.state, readmitted: next.runtime.enqueueCount(id), entries: next.runtime.transcriptEntries(id) }).toEqual({ state: "applied", readmitted: 0, entries: 1 })
  })

  test("#given a claimant died holding a mid-turn follow-up it never wrote #when a fresh process drains #then the row goes back to queued and is admitted once there", async () => {
    const h = (harness = createGatewayHarness())
    h.session("A")
    const b = crashedTarget(h)
    b.runtime.beginUserTurn()
    const id = await sendToB(h, "iv")
    await crashingPass(h, b.runtime, await deadIdentity(), "afterAdmit")
    expect({ state: (await b.view(id))?.state, entries: b.runtime.transcriptEntries(id) }).toEqual({ state: "admitting", entries: 0 })
    const next = freshProcess(h, b.runtime.sessionPath)
    next.runtime.beginUserTurn()
    const result = await next.drain.drain({ reason: "start" })
    expect(result.admitted).toEqual([{ delivery_id: id, kind: "queued" }])
    expect(next.runtime.enqueueCount(id)).toBe(1)
  })

  test("#given a row claimed by another live process #when this process drains #then it is left alone and logged dual_runtime until that process is gone", async () => {
    const h = (harness = createGatewayHarness())
    h.session("A")
    const b = crashedTarget(h)
    const id = await sendToB(h, "live")
    const holder = await spawnHolder()
    try {
      await crashingPass(h, b.runtime, holder.identity, "afterClaim")
      const next = freshProcess(h, b.runtime.sessionPath)
      const untouched = await next.drain.drain({ reason: "start" })
      expect({ admitted: untouched.admitted, state: (await b.view(id))?.state, logged: next.log.some((line) => line.startsWith(`dual_runtime: delivery ${id}`)) }).toEqual({ admitted: [], state: "admitting", logged: true })
      await holder.stop()
      const after = await next.drain.drain({ reason: "start" })
      expect(after.admitted).toEqual([{ delivery_id: id, kind: "started" }])
    } finally {
      await holder.stop()
    }
  })
})
