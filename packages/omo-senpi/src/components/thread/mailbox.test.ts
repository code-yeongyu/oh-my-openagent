import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import {
  createOrderedDeliveryMailbox,
  type MailboxTargetPort,
  type MailboxTurnSnapshot,
} from "./mailbox"

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "omo-mailbox-"))
  const delivered: string[] = []
  let active: MailboxTurnSnapshot = { turn_id: "turn-1", active: true }
  let nextTurn = 2
  const port: MailboxTargetPort = {
    snapshot: async () => active,
    steer: async (message, expected) => {
      if (!active.active || active.turn_id !== expected) throw new Error("turn_conflict")
      delivered.push(message)
    },
    start: async (message) => {
      const turn = `turn-${nextTurn++}`
      active = { turn_id: turn, active: true }
      delivered.push(message)
      return { turn_id: turn }
    },
  }
  const mailbox = createOrderedDeliveryMailbox({ directory, portFor: () => port })
  return { directory, mailbox, delivered, port, setActive: (value: MailboxTurnSnapshot) => { active = value } }
}

describe("ordered delivery mailbox", () => {
  test("serializes concurrent sends and returns monotonic sequence order", async () => {
    const h = setup()
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => h.mailbox.accept("target", `m-${i}`, { delivery: "steer", expected_turn_id: "turn-1" })))
    expect(results.every((result) => result.kind === "ok")).toBe(true)
    expect(results.map((result) => result.kind === "ok" ? result.message_seq : 0)).toEqual([1, 2, 3, 4, 5])
    expect(h.delivered).toEqual(["m-0", "m-1", "m-2", "m-3", "m-4"])
    h.mailbox.close()
    rmSync(h.directory, { recursive: true, force: true })
  })

  test("requires an active expected turn for steer and reports a stale turn without delivery", async () => {
    const h = setup()
    h.setActive({ turn_id: "turn-2", active: true })
    const result = await h.mailbox.accept("target", "stale", { delivery: "steer", expected_turn_id: "turn-1" })
    expect(result).toMatchObject({ kind: "error", error: { code: "turn_conflict" } })
    expect(h.delivered).toEqual([])
    h.setActive({ active: false })
    const idle = await h.mailbox.accept("target", "nope", { delivery: "steer", expected_turn_id: "turn-2" })
    expect(idle).toMatchObject({ kind: "error", error: { code: "no_active_turn" } })
    h.mailbox.close()
    rmSync(h.directory, { recursive: true, force: true })
  })

  test("retains retryable host pushback on disk and redelivers in order when the host accepts", async () => {
    // The head is a steer delivery against an ACTIVE turn with a matching expected_turn_id,
    // so pump() actually calls port.steer and the host rejection path genuinely fires
    // (a follow_up head would short-circuit at pump's busy-turn return instead).
    const directory = mkdtempSync(join(tmpdir(), "omo-mailbox-"))
    const delivered: string[] = []
    let rejections = 0
    const pendingAtRejection: number[] = []
    let mailbox: ReturnType<typeof createOrderedDeliveryMailbox> | undefined
    const rejecting: MailboxTargetPort = {
      snapshot: async () => ({ turn_id: "turn-1", active: true }),
      steer: async (message) => {
        if (rejections >= 2) {
          delivered.push(message)
          return
        }
        rejections++
        pendingAtRejection.push(mailbox?.pending("target").length ?? -1)
        throw new Error("Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.")
      },
      start: async () => ({ turn_id: "turn-new" }),
    }
    mailbox = createOrderedDeliveryMailbox({ directory, portFor: () => rejecting })
    const head = await mailbox.accept("target", "steer-head", { delivery: "steer", expected_turn_id: "turn-1" })
    expect(head).toMatchObject({ kind: "ok", delivery: "queued", queue_position: 1 })
    expect(rejections).toBe(1)
    expect(pendingAtRejection).toEqual([1])
    expect(mailbox.pending("target").map((item) => item.message)).toEqual(["steer-head"])
    const tail = await mailbox.accept("target", "steer-tail", { delivery: "steer", expected_turn_id: "turn-1" })
    expect(tail).toMatchObject({ kind: "ok", delivery: "steered", message_seq: 2 })
    expect(rejections).toBe(2)
    expect(pendingAtRejection).toEqual([1, 2])
    expect(delivered).toEqual(["steer-head", "steer-tail"])
    expect(mailbox.pending("target")).toHaveLength(0)
    mailbox.close()
    rmSync(directory, { recursive: true, force: true })
  })

  test("settles behind-queue sends as queued and drains via the armed retry timer once the turn ends", async () => {
    const h = setup()
    const follow = await h.mailbox.accept("target", "head-follow", { delivery: "follow_up" })
    const auto = await h.mailbox.accept("target", "mid-auto", { delivery: "auto" })
    const steer = await h.mailbox.accept("target", "tail-steer", { delivery: "steer", expected_turn_id: "turn-1" })
    expect(follow).toMatchObject({ kind: "ok", delivery: "queued", queue_position: 1 })
    expect(auto).toMatchObject({ kind: "ok", delivery: "queued", queue_position: 2 })
    expect(steer).toMatchObject({ kind: "ok", delivery: "queued", queue_position: 3 })
    expect(h.mailbox.pending("target").map((item) => item.message)).toEqual(["head-follow", "mid-auto", "tail-steer"])
    h.setActive({ active: false })
    // No notify() call: the retry timer armed at pump's busy-turn return must find the idle
    // transition on its own, deliver the head, and keep draining the queue in order. The
    // probe accept is registered before the timer fires, so it resolves only after the whole
    // queue ahead of it has drained (the stale tail-steer settles as turn_conflict).
    const probe = await h.mailbox.accept("target", "probe", { delivery: "auto" })
    expect(probe).toMatchObject({ kind: "ok", delivery: "steered", message_seq: 4 })
    expect(h.delivered).toEqual(["head-follow", "mid-auto", "probe"])
    expect(h.mailbox.pending("target")).toHaveLength(0)
    h.mailbox.close()
    rmSync(h.directory, { recursive: true, force: true })
  })

  test("does not wedge a follow_up accept when the turn settles between pump's and accept's snapshot reads", async () => {
    // P2 TOCTOU regression (verify-fix.json, verify-fix2-harness/p2-race.ts): pump's snapshot
    // read returns ACTIVE (busy-turn early return, previously with no settle, no retry timer,
    // no worker) while accept's own snapshot read returns INACTIVE, so accept's behind-queue
    // early return never fires and it awaits a waiter nothing settles. Reproduced against the
    // pre-fix code as HUNG after 10003ms and 10020ms with the message durably stuck on disk.
    // The guard here is 2s; the armed 50ms retry timer resolves this in ~50ms.
    const script: MailboxTurnSnapshot[] = [{ turn_id: "t1", active: true }, { active: false }]
    let calls = 0
    const port: MailboxTargetPort = {
      snapshot: async () => script[Math.min(calls++, script.length - 1)],
      steer: async () => { throw new Error("turn_conflict") },
      start: async () => ({ turn_id: "started" }),
    }
    const directory = mkdtempSync(join(tmpdir(), "omo-mailbox-race-"))
    const mailbox = createOrderedDeliveryMailbox({ directory, portFor: () => port })
    const outcome = await Promise.race([
      mailbox.accept("target", "flip-follow", { delivery: "follow_up" }),
      new Promise((resolve) => setTimeout(() => resolve("HUNG"), 2_000)),
    ])
    expect(outcome).toMatchObject({ kind: "ok", delivery: "started", message_seq: 1 })
    expect(mailbox.pending("target")).toHaveLength(0)
    mailbox.close()
    rmSync(directory, { recursive: true, force: true })
  })

  test("does not wedge a follow_up accept when the port's snapshot read rejects once then recovers", async () => {
    // ROUND-4 defect regression (verify-final.json, repro HUNG at 5016ms/5005ms): pump()'s
    // snapshot read (mailbox.ts:131) rejecting used to kill the worker via unhandled
    // rejection with no settle and no retry timer, while accept()'s own read succeeded
    // inactive - so the behind-queue early return never fired and the caller wedged forever
    // with the message durably stuck on disk. The guard treats the rejection as transient-busy:
    // head retained, bounded retry timer armed, delivery lands on the retry.
    const directory = mkdtempSync(join(tmpdir(), "omo-mailbox-snapthrow-"))
    const delivered: string[] = []
    let rejections = 0
    let pendingAtRejection = -1
    let mailbox: ReturnType<typeof createOrderedDeliveryMailbox> | undefined
    const flaky: MailboxTargetPort = {
      snapshot: async () => {
        if (rejections++ === 0) {
          pendingAtRejection = mailbox?.pending("target").length ?? -1
          throw new Error("transient rpc failure at snapshot")
        }
        return { active: false }
      },
      steer: async () => { throw new Error("turn_conflict") },
      start: async (message) => { delivered.push(message); return { turn_id: "turn-started" } },
    }
    mailbox = createOrderedDeliveryMailbox({ directory, portFor: () => flaky })
    const outcome = await Promise.race([
      mailbox.accept("target", "flaky-snapshot", { delivery: "follow_up" }),
      new Promise((resolve) => setTimeout(() => resolve("HUNG"), 2_000)),
    ])
    expect(outcome).toMatchObject({ kind: "ok", delivery: "started", message_seq: 1 })
    expect(pendingAtRejection).toBe(1)
    expect(delivered).toEqual(["flaky-snapshot"])
    expect(mailbox.pending("target")).toHaveLength(0)
    mailbox.close()
    rmSync(directory, { recursive: true, force: true })
  })

  test("returns message_too_large for one message over the byte budget", async () => {
    const h = setup()
    const result = await h.mailbox.accept("target", "x".repeat(1024 * 1024 + 1), { delivery: "follow_up" })
    expect(result).toMatchObject({ kind: "error", error: { code: "message_too_large" } })
    expect(h.mailbox.pending("target")).toHaveLength(0)
    h.mailbox.close()
    rmSync(h.directory, { recursive: true, force: true })
  })

  test("persists pending messages and enforces count and byte caps", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omo-mailbox-"))
    mkdirSync(directory, { recursive: true })
    const blocked: MailboxTargetPort = {
      snapshot: async () => ({ turn_id: "busy", active: true }),
      steer: async () => { await new Promise<void>(() => {}) },
      start: async () => ({ turn_id: "new" }),
    }
    const mailbox = createOrderedDeliveryMailbox({ directory, portFor: () => blocked })
    for (let i = 0; i < 128; i++) await mailbox.accept("target", `m-${i}`, { delivery: "follow_up" })
    const full = await mailbox.accept("target", "overflow", { delivery: "follow_up" })
    expect(full).toMatchObject({ kind: "error", error: { code: "queue_full" } })
    expect(mailbox.pending("target")).toHaveLength(128)
    const byteDirectory = mkdtempSync(join(tmpdir(), "omo-mailbox-bytes-"))
    const byteMailbox = createOrderedDeliveryMailbox({ directory: byteDirectory, portFor: () => blocked })
    for (let i = 0; i < 5; i++) await byteMailbox.accept("target", "x".repeat(200 * 1024), { delivery: "follow_up" })
    const byteFull = await byteMailbox.accept("target", "x".repeat(200 * 1024), { delivery: "follow_up" })
    expect(byteFull).toMatchObject({ kind: "error", error: { code: "queue_full" } })
    expect(byteMailbox.pending("target")).toHaveLength(5)
    const restarted = createOrderedDeliveryMailbox({ directory, portFor: () => blocked })
    expect(restarted.pending("target").map((item) => item.message)).toHaveLength(128)
    mailbox.close()
    restarted.close()
    byteMailbox.close()
    rmSync(directory, { recursive: true, force: true })
    rmSync(byteDirectory, { recursive: true, force: true })
  }, { timeout: 15_000 })
})
