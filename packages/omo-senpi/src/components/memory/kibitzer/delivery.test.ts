import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PendingNudges, RecallLedger, buildIdentityPaths, type RecallNudge } from "@oh-my-opencode/memory-core"

import { IdleInjectionCoordinator } from "../../../extension/idle-injection-coordinator"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "../context"
import { createMemoryBinding } from "../binding"
import { createKibitzerDelivery } from "./delivery"

const SESSION_ID = "delivery-session"
const NUDGE: RecallNudge = { path: "reference/rollouts.md", hint: "Drain nodes before rollout." }
const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await Bun.$`rm -rf ${dir}`
})

async function fixture(): Promise<{ context: MemoryIdentityContext; ledger: RecallLedger; pending: PendingNudges; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "kibitzer-delivery-"))
  tempDirs.push(dir)
  const context = createMemoryIdentityContext({
    identity: "delivery-agent",
    identityPaths: buildIdentityPaths(join(dir, "memory"), "delivery-agent"),
    binding: createMemoryBinding({ identity: "delivery-agent", repoPath: join(dir, "repo"), boundAt: 0 }),
  })
  return {
    context,
    ledger: new RecallLedger(context.identityPaths.recallLedger),
    pending: new PendingNudges(context.identityPaths.recallPending),
    dir,
  }
}

function logger(logs: string[]): { warn(message: string, details?: unknown): void; info(): void; error(): void } {
  return { warn: (message) => logs.push(message), info: () => undefined, error: () => undefined }
}

function pendingPath(context: MemoryIdentityContext): string {
  return join(context.identityPaths.recallPending, `${SESSION_ID}.json`)
}

describe("createKibitzerDelivery", () => {
  test("#given accepted nudges #when accepted #then ledger is surfaced and pending lists every path", async () => {
    const f = await fixture()
    const delivery = createKibitzerDelivery({ ledgerFor: () => f.ledger, pendingFor: () => f.pending, sendMessage: () => undefined, appendEntry: () => undefined })
    await delivery.accept(SESSION_ID, f.context, [NUDGE, { path: "notes/checklist.md", hint: "Check the deployment." }])
    expect(await f.ledger.surfacedPaths(SESSION_ID)).toEqual(new Set([NUDGE.path, "notes/checklist.md"]))
    const file: unknown = JSON.parse(await readFile(pendingPath(f.context), "utf8"))
    expect(file).toMatchObject({ sessionId: SESSION_ID, nudges: [NUDGE, { path: "notes/checklist.md", hint: "Check the deployment." }] })
    expect(file).not.toHaveProperty("compactionEpoch")
  })

  test("#given a quiet tool boundary #when a nudge is pending #then one steer delivers and clears all mirrors", async () => {
    const f = await fixture()
    const calls: unknown[] = []
    const coordinator = new IdleInjectionCoordinator(() => undefined)
    const delivery = createKibitzerDelivery({
      ledgerFor: () => f.ledger,
      pendingFor: () => f.pending,
      coordinator,
      sendMessage: (message, options) => calls.push({ message, options }),
      appendEntry: (...entry) => calls.push(entry),
    })
    await delivery.accept(SESSION_ID, f.context, [NUDGE])
    await delivery.onToolResult(SESSION_ID, f.context, { hasPendingMessages: () => false, isIdle: () => false })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual({ message: { customType: "omo-kibitzer:recall", content: expect.stringContaining("Drain nodes before rollout."), display: false }, options: { deliverAs: "steer" } })
    expect(calls[1]).toEqual(["omo-kibitzer:nudged", { version: 1, nudges: [NUDGE], via: "steer" }])
    await expect(f.pending.take(SESSION_ID)).resolves.toEqual([])
  })

  test("#given pending host messages #when tool_result fires #then it stays silent and intact", async () => {
    const f = await fixture()
    let sends = 0
    const delivery = createKibitzerDelivery({ ledgerFor: () => f.ledger, pendingFor: () => f.pending, sendMessage: () => { sends += 1 }, appendEntry: () => undefined })
    await delivery.accept(SESSION_ID, f.context, [NUDGE])
    await delivery.onToolResult(SESSION_ID, f.context, { hasPendingMessages: () => true, isIdle: () => false })
    expect(sends).toBe(0)
    await expect(f.pending.take(SESSION_ID)).resolves.toEqual([NUDGE])
  })

  test("#given an idle host #when tool_result fires #then it stays silent", async () => {
    const f = await fixture()
    let sends = 0
    const delivery = createKibitzerDelivery({ ledgerFor: () => f.ledger, pendingFor: () => f.pending, sendMessage: () => { sends += 1 }, appendEntry: () => undefined })
    await delivery.accept(SESSION_ID, f.context, [NUDGE])
    await delivery.onToolResult(SESSION_ID, f.context, { hasPendingMessages: () => false, isIdle: () => true })
    expect(sends).toBe(0)
  })

  test("#given an already delivered set #when tool_result fires twice #then one steer is sent", async () => {
    const f = await fixture()
    let sends = 0
    const delivery = createKibitzerDelivery({ ledgerFor: () => f.ledger, pendingFor: () => f.pending, sendMessage: () => { sends += 1 }, appendEntry: () => undefined })
    await delivery.accept(SESSION_ID, f.context, [NUDGE])
    await delivery.onToolResult(SESSION_ID, f.context, { hasPendingMessages: () => false, isIdle: () => false })
    await delivery.onToolResult(SESSION_ID, f.context, { hasPendingMessages: () => false, isIdle: () => false })
    expect(sends).toBe(1)
  })

  test("#given a rejecting pending writer #when accepted #then delivery still works and warning is logged", async () => {
    const f = await fixture()
    const logs: string[] = []
    const delivery = createKibitzerDelivery({ ledgerFor: () => f.ledger, pendingFor: () => ({ write: async () => { throw new Error("disk") }, delete: async () => undefined }), sendMessage: () => undefined, appendEntry: () => undefined, logger: logger(logs) })
    await delivery.accept(SESSION_ID, f.context, [NUDGE])
    await delivery.onToolResult(SESSION_ID, f.context, { hasPendingMessages: () => false, isIdle: () => false })
    expect(logs.some((message) => message.includes("pending"))).toBe(true)
  })

  test("#given no coordinator #when accepted and steered #then no exception occurs", async () => {
    const f = await fixture()
    let sends = 0
    const delivery = createKibitzerDelivery({ ledgerFor: () => f.ledger, pendingFor: () => f.pending, sendMessage: () => { sends += 1 }, appendEntry: () => undefined })
    await delivery.accept(SESSION_ID, f.context, [NUDGE])
    await delivery.onToolResult(SESSION_ID, f.context, { hasPendingMessages: () => false, isIdle: () => false })
    expect(sends).toBe(1)
  })

  test("#given a rejecting ledger #when accepted #then it queues and warns", async () => {
    const f = await fixture()
    const logs: string[] = []
    class RejectingLedger extends RecallLedger {
      override async markSurfaced(): Promise<void> { throw new Error("ledger") }
    }
    const rejectingLedger = new RejectingLedger(f.context.identityPaths.recallLedger)
    const delivery = createKibitzerDelivery({ ledgerFor: () => rejectingLedger, pendingFor: () => f.pending, sendMessage: () => undefined, appendEntry: () => undefined, logger: logger(logs) })
    await delivery.accept(SESSION_ID, f.context, [NUDGE])
    expect(logs.some((message) => message.includes("ledger"))).toBe(true)
    await expect(f.pending.take(SESSION_ID)).resolves.toEqual([NUDGE])
  })

  test("#given nudges #when drained for prompt #then they are returned once and coordinator keys removed", async () => {
    const f = await fixture()
    const coordinator = new IdleInjectionCoordinator(() => undefined)
    const delivery = createKibitzerDelivery({ ledgerFor: () => f.ledger, pendingFor: () => f.pending, coordinator, sendMessage: () => undefined, appendEntry: () => undefined })
    await delivery.accept(SESSION_ID, f.context, [NUDGE])
    expect(delivery.drainForPrompt(SESSION_ID, f.context)).toEqual([NUDGE])
    expect(delivery.drainForPrompt(SESSION_ID, f.context)).toEqual([])
    expect(coordinator.pendingCount()).toBe(0)
  })
})
