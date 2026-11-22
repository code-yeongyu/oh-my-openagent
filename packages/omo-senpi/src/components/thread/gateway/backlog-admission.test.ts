import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"

import type { ThreadToolResult } from "../contracts"
import { withBacklog } from "../tools/read-ops"
import { QUEUED_TTL_MS, STEER_RESERVE_BYTES, STEER_RESERVE_MESSAGES, TARGET_MAX_MESSAGES } from "./constants"
import { gatewayDatabasePath } from "./paths"
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
 * Seeds `count` follow-ups from `sender` to "lead" in one transaction, three minutes apart. With a drain, "lead"'s
 * runtime holds them (claimed by a live process that is not this test's store, so reconcile leaves them as they are);
 * without one they wait in the gateway. Only the sends a test asserts on go through the engine.
 */
async function fillFollowUps(h: GatewayHarness, sender: HarnessSession, count: number): Promise<void> {
  const held = h.get("lead").drainRegistered
  await sender.store.list({ target_durable_id: "lead" })
  const claimant = JSON.stringify({
    pid: process.pid,
    process_start_time: null,
    instance_id: "seeded-runtime",
    runtime_instance: null,
  })
  const db = new Database(gatewayDatabasePath(h.agentDir))
  try {
    const insert = db.prepare(
      "INSERT INTO deliveries (delivery_id, target_durable_id, seq, sender, envelope, body, bytes, mode_requested, mode_effective, state, admitted_by, claimed_at, attempt, admission_kind, root_id, hop, created_at, updated_at, expires_at) VALUES (?, 'lead', ?, ?, ?, ?, ?, 'follow_up', ?, ?, ?, ?, ?, ?, 'root-seeded', 1, ?, ?, ?)",
    )
    db.transaction(() => {
      for (let index = 0; index < count; index++) {
        const id = `seeded-${index}`
        const body = `alert ${index}`
        const at = h.clock.now
        const envelope = {
          provenance: { workspace: "w", project: "p" },
          origin: { session: sender.id },
          actor: sender.id,
          via: [],
          root_id: "root-seeded",
          hop: 1,
          delivery_id: id,
        }
        insert.run(
          id,
          index + 1,
          `session:${sender.id}`,
          JSON.stringify(envelope),
          body,
          body.length,
          held ? "follow_up" : null,
          held ? "admitted" : "queued",
          held ? claimant : null,
          held ? at : null,
          held ? 1 : 0,
          held ? "queued" : null,
          at,
          at,
          at + QUEUED_TTL_MS,
        )
        h.clock.now += 3 * 60_000
      }
    })()
    // close() leaves the database open while a prepared statement is unfinalized; Windows then cannot delete it.
    insert.finalize()
  } finally {
    db.close()
  }
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
    const firstAt = h.clock.now
    await fillFollowUps(h, sender, TARGET_MAX_MESSAGES)

    expect(await send(sender, "one more")).toMatchObject({
      kind: "error",
      error: {
        code: "queue_full",
        details: {
          held_by_session: 0,
          waiting_in_gateway: TARGET_MAX_MESSAGES,
          reason: "session_not_draining",
          target_running: true,
          frees_at: firstAt + QUEUED_TTL_MS,
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

  test("#given a follow-up lane filled with rows that are now past their lifetime #when a follow-up is sent #then the expired rows do not count and it is accepted", async () => {
    const h = (harness = createGatewayHarness())
    h.session("lead", { drainRegistered: false })
    const sender = h.session("notifier")
    await fillFollowUps(h, sender, TARGET_MAX_MESSAGES)
    expect(await send(sender, "while the lane is full")).toMatchObject({ kind: "error", error: { code: "queue_full" } })

    h.clock.now += QUEUED_TTL_MS

    expect(await send(sender, "after every seeded row expired")).toMatchObject({ kind: "ok" })
  })

  test("#given a gateway store that cannot be read #when threads are listed #then the listing is returned without backlog details", async () => {
    const listing = {
      kind: "ok",
      scope: "workspace",
      threads: [
        {
          thread: "lead",
          name: "lead",
          status: "live",
          state: "running",
          cwd: "/",
          created_at: "",
          updated_at: null,
          link: "",
        },
      ],
    } as ThreadToolResult
    const broken = {
      backlogs: async () => Promise.reject(new Error("gateway schema 17 is newer than this binary's 16")),
    }

    const listed = await withBacklog(broken, listing)

    if (listed.kind !== "ok" || !("threads" in listed) || !("threads" in listing)) throw new Error("not a listing")
    expect(listed.threads).toEqual(listing.threads)
    expect(listed.backlog_error).toBe("gateway schema 17 is newer than this binary's 16")
  })

  test("#given an empty steer lane #when one steer larger than the steer byte reserve is sent #then it is admitted", async () => {
    const { lead, sender } = seat()

    const steer = await send(sender, "x".repeat(STEER_RESERVE_BYTES + 1024), {
      mode: "steer",
      expected_turn_id: lead.runtime.epoch,
    })

    expect(steer).toMatchObject({ kind: "ok", delivery: { kind: "steered" } })
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
