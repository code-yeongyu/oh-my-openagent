import { afterEach, describe, expect, test } from "bun:test"

import type { IntakeAdmission } from "../gateway/drain"
import { createGatewayHarness, type GatewayHarness } from "../gateway/testing/harness"
import type { IntakeRequest } from "../gateway/types"
import { runPendingSweep } from "./pending-sweep"

// The pending sweep (#13037 design 5.4 step 6, 5.6 at wake): on connect and when an engine endpoint appears, every
// session holding open intake rows is woken once its senders pass the admission check; a refused sender's rows settle
// refused, and same-device rows wake nothing while the same-device switch is off.

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

function intake(h: GatewayHarness, deliveryId: string, device: string, sessionId: string): IntakeRequest {
  return {
    now: h.clock.now,
    attested_device: device,
    record: {
      sessionId,
      deliveryId,
      text: deliveryId,
      displayText: deliveryId,
      sender: { kind: "agent", session_id: "sender-s" },
      deliverAs: "followUp",
      chainCount: 1,
    },
    provenance: { workspace: "remote", project: "remote" },
    target_session_kind: "interactive",
  }
}

async function sweep(
  h: GatewayHarness,
  admit: (device: string) => IntakeAdmission,
  sameDevice: (durableId: string) => boolean = () => false,
): Promise<string[]> {
  const woken: string[] = []
  await runPendingSweep({
    store: h.store(),
    admitIntake: async (device) => admit(device),
    wake: async (durableId) => {
      woken.push(durableId)
    },
    sameDevice,
  })
  return woken.sort()
}

describe("the pending sweep", () => {
  test("#given sessions with intake rows #when the sweep runs #then a session whose sender is admitted is woken, a refused sender's rows settle refused, and an unanswered sender's session waits", async () => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
    await store.intake(intake(h, "d-1", "dev-ok", "t-ok"))
    await store.intake(intake(h, "d-2", "dev-no", "t-no"))
    await store.intake(intake(h, "d-3", "dev-silent", "t-silent"))
    const decide = (device: string): IntakeAdmission =>
      device === "dev-ok" ? "admitted" : device === "dev-no" ? "refused" : "unknown"
    expect(await sweep(h, decide)).toEqual(["t-ok"])
    expect(await store.list({ target_durable_id: "t-no" })).toMatchObject([
      { state: "refused", reason: "sender_not_admitted" },
    ])
    expect(await store.list({ target_durable_id: "t-silent" })).toMatchObject([{ state: "queued" }])
  })

  test("#given a session whose only row is from another device #when the sweep runs #then it wakes on admission without ever reading its project's same_device setting", async () => {
    const h = (harness = createGatewayHarness())
    const outcome = await h.store().intake({
      now: h.clock.now,
      attested_device: "dev-b",
      record: {
        sessionId: "t-remote",
        deliveryId: "d-remote",
        text: "d-remote",
        displayText: "d-remote",
        sender: { kind: "agent", session_id: "sender-s" },
        deliverAs: "followUp",
        chainCount: 1,
      },
      provenance: { workspace: "remote", project: "remote" },
      target_session_kind: "interactive",
    })
    expect(outcome.kind).toBe("queued")
    let asked = 0
    const woken = await sweep(h, () => "admitted", () => {
      asked += 1
      return true
    })
    expect(woken).toEqual(["t-remote"])
    expect(asked).toBe(0)
  })

  test("#given a session with same-device rows only #when the sweep runs #then it is woken only with the same-device switch on", async () => {
    const h = (harness = createGatewayHarness())
    const sender = h.session("a")
    h.phantom("t")
    const sent = await sender.engine.deliver({ sender: { kind: "session", durable_id: "a" }, target: "t", text: "hi" })
    expect(sent).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" } })
    expect(await sweep(h, () => "admitted")).toEqual([])
    expect(await sweep(h, () => "admitted", () => true)).toEqual(["t"])
  })
})
