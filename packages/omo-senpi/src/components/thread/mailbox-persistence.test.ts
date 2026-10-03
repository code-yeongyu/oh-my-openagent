import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { createOrderedDeliveryMailbox, type MailboxTargetPort } from "./mailbox"

const blocked: MailboxTargetPort = {
  snapshot: async () => ({ turn_id: "busy", active: true }),
  steer: async () => { await new Promise<void>(() => {}) },
  start: async () => ({ turn_id: "new" }),
}

describe("ordered delivery mailbox persistence", () => {
  test("migrates legacy whole-queue state without losing sequence or pending messages", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omo-mailbox-legacy-"))
    const legacyItems = ["legacy-1", "legacy-2"].map((message, index) => ({
      target: "target",
      message,
      message_seq: index + 1,
      delivery: "follow_up",
      operation_id: `target-${index + 1}`,
      accepted_at: "2026-09-27T00:00:00.000Z",
    }))
    writeFileSync(join(directory, "mailbox.json"), JSON.stringify({
      next_seq: 3,
      queues: { target: legacyItems },
    }))

    const mailbox = createOrderedDeliveryMailbox({ directory, portFor: () => blocked, max_messages: 3 })
    expect(mailbox.pending("target").map((item) => item.message)).toEqual(["legacy-1", "legacy-2"])
    expect(existsSync(join(directory, "mailbox.json"))).toBe(false)
    const accepted = await mailbox.accept("target", "new", { delivery: "follow_up" })
    expect(accepted).toMatchObject({ kind: "ok", delivery: "queued", message_seq: 3, queue_position: 3 })

    mailbox.close()
    rmSync(directory, { recursive: true, force: true })
  })

  test("compacts a drained journal without reusing the last sequence after restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omo-mailbox-compaction-"))
    const live: MailboxTargetPort = {
      snapshot: async () => ({ turn_id: "turn-1", active: true }),
      steer: async () => {},
      start: async () => ({ turn_id: "new" }),
    }
    const first = createOrderedDeliveryMailbox({ directory, portFor: () => live })
    expect(await first.accept("target", "delivered", { delivery: "steer", expected_turn_id: "turn-1" }))
      .toMatchObject({ kind: "ok", delivery: "steered", message_seq: 1 })
    first.close()
    const restarted = createOrderedDeliveryMailbox({ directory, portFor: () => blocked })
    expect(restarted.pending("target")).toHaveLength(0)
    expect(await restarted.accept("target", "queued", { delivery: "follow_up" }))
      .toMatchObject({ kind: "ok", delivery: "queued", message_seq: 2 })

    restarted.close()
    rmSync(directory, { recursive: true, force: true })
  })

  test("repairs a torn final journal record before accepting another message", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omo-mailbox-torn-tail-"))
    const first = createOrderedDeliveryMailbox({ directory, portFor: () => blocked })
    await first.accept("target", "first", { delivery: "follow_up" })
    first.close()
    appendFileSync(join(directory, "mailbox.jsonl"), '{"version":1,"kind":"enq')

    const recovered = createOrderedDeliveryMailbox({ directory, portFor: () => blocked })
    expect(recovered.pending("target").map((item) => item.message)).toEqual(["first"])
    await recovered.accept("target", "second", { delivery: "follow_up" })
    recovered.close()
    const reopened = createOrderedDeliveryMailbox({ directory, portFor: () => blocked })
    expect(reopened.pending("target").map((item) => item.message)).toEqual(["first", "second"])

    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  })

  test("replays a removal without dropping another target's pending message", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omo-mailbox-remove-replay-"))
    const live: MailboxTargetPort = {
      snapshot: async () => ({ turn_id: "turn-1", active: true }),
      steer: async () => {},
      start: async () => ({ turn_id: "new" }),
    }
    const mailbox = createOrderedDeliveryMailbox({
      directory,
      portFor: (target) => target === "pending" ? blocked : live,
    })
    await mailbox.accept("pending", "keep", { delivery: "follow_up" })
    await mailbox.accept("delivered", "remove", { delivery: "steer", expected_turn_id: "turn-1" })
    mailbox.close()

    const restarted = createOrderedDeliveryMailbox({ directory, portFor: () => blocked })
    expect(restarted.pending("pending").map((item) => item.message)).toEqual(["keep"])
    expect(restarted.pending("delivered")).toHaveLength(0)

    restarted.close()
    rmSync(directory, { recursive: true, force: true })
  })
})
