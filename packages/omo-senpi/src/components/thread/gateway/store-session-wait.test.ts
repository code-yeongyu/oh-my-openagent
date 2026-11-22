import { afterEach, describe, expect, test } from "bun:test"

import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import type { IntakeRequest } from "./types"

// Storage the carrier and the consumer read (#13037 A2.6, A3.2.8, A3.5.3, and the delivery.pending / delivery.drained
// shapes): a session's wait state, its count of consecutive wakes, its open work, and the intake marks per sender.

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

function intake(h: GatewayHarness, deliveryId: string, device = "dev-a", sessionId = "t"): IntakeRequest {
  return {
    now: h.clock.now,
    attested_device: device,
    record: {
      sessionId,
      deliveryId,
      text: `OMO_GATEWAY v=1\nsource=peer_agent\n\n${deliveryId}`,
      displayText: deliveryId,
      sender: { kind: "agent", session_id: "sender-s" },
      deliverAs: "followUp",
      chainCount: 1,
    },
    provenance: { workspace: "remote", project: "remote" },
    target_session_kind: "interactive",
  }
}

describe("the wait state of a session", () => {
  test("#given a held session #when its state is written, read and cleared #then the read returns the kinds and the file size until it is cleared", async () => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
    expect(await store.sessionWait.read({ durable_id: "s1" })).toBeNull()
    await store.sessionWait.write({ durable_id: "s1", wait: "held", hold_kinds: ["session_hold"], file_size: 812 })
    expect(await store.sessionWait.read({ durable_id: "s1" })).toEqual({
      durable_id: "s1",
      wait: "held",
      hold_kinds: ["session_hold"],
      file_size: 812,
      written_at: h.clock.now,
    })
    await store.sessionWait.clear({ durable_id: "s1" })
    expect(await store.sessionWait.read({ durable_id: "s1" })).toBeNull()
  })
})

describe("the count of consecutive wakes (A3.5.3)", () => {
  test("#given wakes at one input revision #when a person's input moves the revision #then the count starts again at one, and a reset clears it", async () => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
    expect(await store.woken.countWake({ durable_id: "s1", human_input_revision: 3 })).toEqual({ count: 1 })
    expect(await store.woken.countWake({ durable_id: "s1", human_input_revision: 3 })).toEqual({ count: 2 })
    expect(await store.woken.countWake({ durable_id: "s1", human_input_revision: 4 })).toEqual({ count: 1 })
    expect(await store.woken.wakeCount({ durable_id: "s1" })).toBe(1)
    await store.woken.resetCount({ durable_id: "s1" })
    expect(await store.woken.wakeCount({ durable_id: "s1" })).toBe(0)
  })
})

describe("intake marks (delivery.pending / delivery.drained)", () => {
  test("#given two deliveries from one device queued in turn #when the first is applied #then the pair is still pending with the newest command, and it drains with that command once both are applied", async () => {
    const h = (harness = createGatewayHarness())
    const target = h.session("t")
    expect(await target.store.intake(intake(h, "d-1"))).toMatchObject({ kind: "queued" })
    await target.store.intakeMarks.record({ sender_device: "dev-a", session_id: "t", command_id: "c-1" })
    expect(await target.store.intakeMarks.pending()).toEqual([
      { sender_device: "dev-a", session_id: "t", last_command_id: "c-1" },
    ])
    expect(await target.store.woken.sessionWork({ durable_id: "t" })).toEqual({ queued: 1, claimed: 0, unapplied: 0 })

    await target.drain.drain({ reason: "command" })
    await h.quiesce()
    expect(await target.store.intake(intake(h, "d-2"))).toMatchObject({ kind: "queued" })
    await target.store.intakeMarks.record({ sender_device: "dev-a", session_id: "t", command_id: "c-2" })
    expect(await target.store.intakeMarks.drained({ sender_device: "dev-a", session_id: "t" })).toEqual({
      drained: false,
    })
    expect(await target.store.intakeMarks.pending()).toEqual([
      { sender_device: "dev-a", session_id: "t", last_command_id: "c-2" },
    ])

    await target.drain.drain({ reason: "command" })
    target.runtime.endTurn()
    await h.quiesce()
    expect(await target.store.intakeMarks.pending()).toEqual([])
    expect(await target.store.intakeMarks.drained({ sender_device: "dev-a", session_id: "t" })).toEqual({
      drained: true,
      last_command_id: "c-2",
    })
  })

  test("#given intake rows of two devices for two sessions #when the open sessions are listed #then each session names the devices whose rows are still open", async () => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
    await store.intake(intake(h, "d-1", "dev-a", "t1"))
    await store.intake(intake(h, "d-2", "dev-b", "t1"))
    await store.intake(intake(h, "d-3", "dev-a", "t2"))
    const open = await store.intakeMarks.openSessions()
    expect(open.map((entry) => ({ ...entry, devices: [...entry.devices].sort() }))).toEqual([
      { durable_id: "t1", devices: ["dev-a", "dev-b"], local: false },
      { durable_id: "t2", devices: ["dev-a"], local: false },
    ])
  })
})
