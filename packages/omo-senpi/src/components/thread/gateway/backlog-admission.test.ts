import { afterEach, describe, expect, test } from "bun:test"

import type { ThreadToolResult } from "../contracts"
import { withBacklog } from "../tools/read-ops"
import { STEER_RESERVE_MESSAGES, TARGET_MAX_MESSAGES } from "./constants"
import { createGatewayHarness, type GatewayHarness, type HarnessSession } from "./testing/harness"
import type { GatewayDeliveryResult } from "./types"

// omo#14428: a busy seat's runtime held 128 follow-ups it had taken but not written; the target backlog cap counted them,
// so every later send (a steer too) answered queue_full with nothing about why. A fake busy session on the virtual clock.

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

function seat(): { h: GatewayHarness; lead: HarnessSession; sender: HarnessSession } {
  const h = (harness = createGatewayHarness())
  const lead = h.session("lead")
  const sender = h.session("notifier")
  lead.runtime.beginUserTurn()
  return { h, lead, sender }
}

async function send(
  sender: HarnessSession,
  text: string,
  extra: {
    readonly mode?: "follow_up" | "steer"
    readonly expected_turn_id?: number
    readonly collapse_key?: string
  } = {},
): Promise<GatewayDeliveryResult> {
  return await sender.engine.deliver({
    sender: { kind: "session", durable_id: sender.id },
    target: "lead",
    text,
    mode: extra.mode ?? "follow_up",
    ...(extra.expected_turn_id === undefined ? {} : { expected_turn_id: extra.expected_turn_id }),
    ...(extra.collapse_key === undefined ? {} : { collapse_key: extra.collapse_key }),
  })
}

/**
 * Writes `count` follow-ups for "lead" the way another device's relay leg does (`store.intake`: one store call each,
 * the same per-lane cap), then lets one drain pass take them when "lead" has a drain. Only the sends a test asserts on
 * go through the engine.
 */
async function fillFollowUps(h: GatewayHarness, sender: HarnessSession, count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    const taken = await sender.store.intake({
      now: h.clock.now,
      attested_device: "dev-remote",
      record: {
        sessionId: "lead",
        deliveryId: `alert-${index}`,
        text: `OMO_GATEWAY v=1\nsource=peer_agent\n\nalert ${index}`,
        displayText: `alert ${index}`,
        sender: { kind: "agent", session_id: sender.id },
        deliverAs: "followUp",
        chainCount: 1,
      },
      provenance: { workspace: "remote", project: "remote" },
      target_session_kind: "interactive",
    })
    if (taken.kind !== "queued") throw new Error(`follow-up ${index} refused: ${JSON.stringify(taken)}`)
    h.clock.now += 3 * 60_000
  }
  const lead = h.get("lead")
  if (lead.drainRegistered) await lead.drain.drain({ reason: "command" })
  await h.quiesce()
}

describe("omo#14428 target backlog admission", () => {
  test("#given a busy session whose runtime holds a full follow-up backlog #when a steer is sent #then it is admitted and written at the next tool boundary", async () => {
    const { h, lead, sender } = seat()
    await fillFollowUps(h, sender, TARGET_MAX_MESSAGES)

    const steer = await send(sender, "stop and read this", {
      mode: "steer",
      expected_turn_id: lead.runtime.epoch,
    })
    expect(steer).toMatchObject({ kind: "ok", delivery: { kind: "steered" } })
    lead.runtime.toolBoundary()
    await h.quiesce()

    if (steer.kind !== "ok") throw new Error("unreachable")
    expect(lead.runtime.transcriptEntries(steer.delivery_id)).toBe(1)
  })

  test("#given steers fill their own reserve #when one more steer is sent #then it is refused queue_full while follow-ups are unaffected", async () => {
    const { h, lead, sender } = seat()
    for (let index = 0; index < STEER_RESERVE_MESSAGES; index++) {
      const steer = await send(sender, `steer ${index}`, {
        mode: "steer",
        expected_turn_id: lead.runtime.epoch,
      })
      expect(steer.kind).toBe("ok")
      h.clock.now += 60_000
    }
    await h.quiesce()

    expect(await send(sender, "one too many", { mode: "steer", expected_turn_id: lead.runtime.epoch })).toMatchObject({
      kind: "error",
      error: { code: "queue_full", details: { lane: "steer", held: STEER_RESERVE_MESSAGES } },
    })
    expect(await send(sender, "a follow-up still fits")).toMatchObject({ kind: "ok" })
  })

  test("#given a full follow-up backlog the session has taken but not written #when a follow-up is refused #then queue_full names the held count, the oldest age and why it is not draining", async () => {
    const { h, sender } = seat()
    const firstAt = h.clock.now
    await fillFollowUps(h, sender, TARGET_MAX_MESSAGES)

    const refused = await send(sender, "one more")

    expect(refused).toMatchObject({
      kind: "error",
      error: {
        code: "queue_full",
        details: {
          lane: "follow_up",
          max_messages: TARGET_MAX_MESSAGES,
          held: TARGET_MAX_MESSAGES,
          held_by_session: TARGET_MAX_MESSAGES,
          waiting_in_gateway: 0,
          oldest_age_ms: h.clock.now - firstAt,
          reason: "session_not_writing",
        },
      },
    })
  })

  test("#given a target whose drain never runs #when its backlog fills #then queue_full says the rows wait in the gateway", async () => {
    const h = (harness = createGatewayHarness())
    h.session("lead", { drainRegistered: false })
    const sender = h.session("notifier")
    await fillFollowUps(h, sender, TARGET_MAX_MESSAGES)

    expect(await send(sender, "one more")).toMatchObject({
      kind: "error",
      error: {
        code: "queue_full",
        details: {
          held_by_session: 0,
          waiting_in_gateway: TARGET_MAX_MESSAGES,
          reason: "session_not_draining",
        },
      },
    })
  })

  test("#given one sender repeats an alert under one collapse key 100 times while the session is busy #then at most one of them is undelivered", async () => {
    const { h, lead, sender } = seat()
    const results: GatewayDeliveryResult[] = []
    for (let index = 0; index < 100; index++) {
      results.push(
        await send(sender, `Q unanswered for ${index * 3} min`, {
          collapse_key: "slack:C1:1700000000.1",
        }),
      )
      h.clock.now += 3 * 60_000
    }
    await h.quiesce()

    expect(results.every((result) => result.kind === "ok")).toBe(true)
    const open = (await lead.store.list({ target_durable_id: "lead" })).filter((row) =>
      ["queued", "admitting", "admitted"].includes(row.state),
    )
    expect(open.length).toBeLessThanOrEqual(1)
  })

  test("#given a busy session holding undelivered follow-ups #when its thread is listed #then the row names the backlog and an empty thread names none", async () => {
    const { h, lead, sender } = seat()
    h.session("quiet")
    const firstAt = h.clock.now
    await fillFollowUps(h, sender, 3)
    const row = (thread: string) => ({
      thread,
      name: thread,
      status: "live",
      state: "running",
      cwd: "/",
      created_at: "",
      updated_at: null,
      link: "",
    })

    const listed = await withBacklog(lead.store, {
      kind: "ok",
      scope: "workspace",
      threads: [row("lead"), row("quiet")],
    } as ThreadToolResult)

    if (listed.kind !== "ok" || !("threads" in listed)) throw new Error("not a listing")
    expect(listed.threads[0]?.backlog).toEqual({
      held: 3,
      held_by_session: 3,
      waiting_in_gateway: 0,
      oldest_at: new Date(firstAt).toISOString(),
    })
    expect(listed.threads[1]).not.toHaveProperty("backlog")
  })

  test("#given a collapse key whose earlier row still waits in the gateway #when the sender repeats it #then the newer text replaces it and the older is refused superseded", async () => {
    const h = (harness = createGatewayHarness())
    h.session("lead", { drainRegistered: false })
    const sender = h.session("notifier")

    const first = await send(sender, "for 3 min", { collapse_key: "alert-1" })
    const second = await send(sender, "for 6 min", { collapse_key: "alert-1" })
    const other = await send(sender, "unrelated", { collapse_key: "alert-2" })

    if (first.kind !== "ok" || second.kind !== "ok" || other.kind !== "ok") throw new Error("send refused")
    const rows = await sender.store.list({ target_durable_id: "lead" })
    expect(rows.map((row) => [row.body, row.state, row.reason])).toEqual([
      ["for 3 min", "refused", "superseded"],
      ["for 6 min", "queued", null],
      ["unrelated", "queued", null],
    ])
  })
})
