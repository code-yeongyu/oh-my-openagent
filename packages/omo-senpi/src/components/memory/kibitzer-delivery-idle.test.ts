import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, PendingNudges, RecallLedger, type RecallNudge } from "@oh-my-opencode/memory-core"

import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import { createMemoryIdentityContext } from "./context"
import { createMemoryBinding } from "./binding"
import { createKibitzerDelivery, type KibitzerDelivery } from "./kibitzer-delivery"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { registerKibitzerHooks } from "./kibitzer-hooks"
import { createKibitzerTrigger } from "./kibitzer-trigger"
import { ToolArgWindow } from "./recall-query-planner-tools"
import { beforeAgentStart, eventContext } from "./recall-wiring.test-support"

const SESSION_ID = "idle-session"
const NUDGE: RecallNudge = { path: "reference/idle.md", hint: "Use the idle wake path." }
const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fixture(): Promise<{ context: ReturnType<typeof createMemoryIdentityContext>; ledger: RecallLedger; pending: PendingNudges }> {
  const dir = join(tmpdir(), `kibitzer-idle-${crypto.randomUUID()}`)
  await mkdir(dir, { recursive: true })
  tempDirs.push(dir)
  const context = createMemoryIdentityContext({ identity: "idle-agent", identityPaths: buildIdentityPaths(join(dir, "memory"), "idle-agent"), binding: createMemoryBinding({ identity: "idle-agent", repoPath: dir, boundAt: 0 }) })
  return { context, ledger: new RecallLedger(context.identityPaths.recallLedger), pending: new PendingNudges(context.identityPaths.recallPending) }
}

function sessionHooks(delivery: KibitzerDelivery, context: ReturnType<typeof createMemoryIdentityContext>) {
  const pi = new FakeExtensionAPI()
  const trigger = createKibitzerTrigger({
    snapshotSession: () => undefined, resolveModelRegistry: () => undefined,
    collectCandidatesFromSnapshot: async () => undefined,
    runnerFor: () => ({ launch: async () => ({ status: "empty" }) }),
    resolveContext: () => context, onAccepted: delivery.accept, report: () => {},
    currentCompactionEpoch: () => 0, argWindow: new ToolArgWindow(),
  })
  registerKibitzerHooks(pi, {
    trigger, delivery, resolveContext: () => context, resolveSessionId: () => SESSION_ID,
    registerSettle: false, ...{ env: {} },
  })
  return pi
}

describe("kibitzer accept-time delivery", () => {
  test("#given a running prompt session #when nudges are accepted #then one steer batches every nudge", async () => {
    // given
    const f = await fixture()
    const sends = new FakeExtensionAPI()
    const nudges = [NUDGE, { path: "notes/checklist.md", hint: "Check the rollout." }]
    const delivery = createKibitzerDelivery({
      ledgerFor: () => f.ledger, pendingFor: () => f.pending,
      sendMessage: (message, options) => sends.sendMessage(message, options), appendEntry: () => {},
    })
    const pi = sessionHooks(delivery, f.context)
    await pi.dispatch("before_agent_start", beforeAgentStart("rollout"), eventContext([], SESSION_ID))
    // when
    await delivery.accept(SESSION_ID, f.context, nudges, 0)
    // then
    expect(sends.messages).toHaveLength(1)
    expect(sends.messages[0]).toMatchObject({ message: { customType: "omo-kibitzer:recall", display: false }, options: { deliverAs: "steer" } })
    for (const nudge of nudges) expect(sends.messages[0]?.message.content).toContain(nudge.path)
  })

  test("#given a running session with a rejecting sender #when nudges are accepted #then it warns and preserves every fallback", async () => {
    // given
    const f = await fixture()
    const warnings: unknown[] = []
    const coordinator = new IdleInjectionCoordinator(() => {})
    let sends = 0
    const delivery = createKibitzerDelivery({
      ledgerFor: () => f.ledger, pendingFor: () => f.pending, coordinator, appendEntry: () => {},
      sendMessage: async () => { sends += 1; throw new Error("sender unavailable") },
      logger: { warn: (_message, details) => { warnings.push(details) }, info: () => {}, error: () => {} },
    })
    const pi = sessionHooks(delivery, f.context)
    await pi.dispatch("before_agent_start", beforeAgentStart("rollout"), eventContext([], SESSION_ID))
    // when
    await delivery.accept(SESSION_ID, f.context, [NUDGE], 0)
    // then
    expect(sends).toBe(1)
    expect(warnings).toHaveLength(1)
    expect(coordinator.pendingCount()).toBe(1)
    expect(delivery.drainForPrompt(SESSION_ID, f.context)).toEqual([NUDGE])
    await expect(f.pending.take(SESSION_ID, { currentEpoch: 0 })).resolves.toEqual([NUDGE])
  })

  test("#given a session without a prompt event #when nudges are accepted #then they stay queued without steering", async () => {
    // given
    const f = await fixture()
    let sends = 0
    const delivery = createKibitzerDelivery({ ledgerFor: () => f.ledger, pendingFor: () => f.pending, sendMessage: () => { sends += 1 }, appendEntry: () => {} })
    sessionHooks(delivery, f.context)
    // when
    await delivery.accept(SESSION_ID, f.context, [NUDGE], 0)
    // then
    expect(sends).toBe(0)
    expect(delivery.drainForPrompt(SESSION_ID, f.context)).toEqual([NUDGE])
    await expect(f.pending.take(SESSION_ID, { currentEpoch: 0 })).resolves.toEqual([NUDGE])
  })

  test("#given a steer in flight #when another verdict is accepted #then the steering latch prevents a second send", async () => {
    // given
    const f = await fixture()
    const sent = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let sends = 0
    const delivery = createKibitzerDelivery({
      ledgerFor: () => f.ledger, pendingFor: () => f.pending, appendEntry: () => {},
      sendMessage: () => { sends += 1; sent.resolve(); return release.promise },
    })
    const pi = sessionHooks(delivery, f.context)
    await pi.dispatch("before_agent_start", beforeAgentStart("rollout"), eventContext([], SESSION_ID))
    const first = delivery.accept(SESSION_ID, f.context, [NUDGE], 0)
    try {
      await Promise.race([sent.promise, first])
      // when
      await delivery.accept(SESSION_ID, f.context, [{ path: "notes/second.md", hint: "Check health." }], 0)
      // then
      expect(sends).toBe(1)
    } finally {
      release.resolve()
      await first
    }
  }, 5_000)

  test.each(["settled", "compacted", "shutdown"] as const)("#given a %s session after a prompt event #when a late verdict is accepted #then it stays queued", async (state) => {
    // given
    const f = await fixture()
    let sends = 0
    const delivery = createKibitzerDelivery({ ledgerFor: () => f.ledger, pendingFor: () => f.pending, sendMessage: () => { sends += 1 }, appendEntry: () => {} })
    const pi = sessionHooks(delivery, f.context)
    const ctx = eventContext([], SESSION_ID)
    await pi.dispatch("before_agent_start", beforeAgentStart("rollout"), ctx)
    switch (state) {
      case "settled": await pi.dispatch("agent_settled", {}, ctx); break
      case "compacted": await delivery.onCompactionAccepted(SESSION_ID, f.context); break
      case "shutdown": delivery.onSessionShutdown(SESSION_ID); break
      default: state satisfies never
    }
    // when
    await delivery.accept(SESSION_ID, f.context, [NUDGE], 1)
    // then
    expect(sends).toBe(0)
    expect(delivery.drainForPrompt(SESSION_ID, f.context)).toEqual([NUDGE])
  })
})

describe("kibitzer delivery idle lifecycle", () => {
  test("#given only a passive kibitzer entry #when idle flushes #then it does not deliver", async () => {
    const f = await fixture()
    const delivered: string[] = []
    let wakeEntry: unknown
    let wakeEntryReady: (() => void) | undefined
    const wakeReady = new Promise<void>((resolve) => { wakeEntryReady = resolve })
    const coordinator = new IdleInjectionCoordinator((message) => delivered.push(message.content))
    const delivery = createKibitzerDelivery({ ledgerFor: () => f.ledger, pendingFor: () => f.pending, coordinator, sendMessage: () => undefined, appendEntry: (_customType, data) => { wakeEntry = data; wakeEntryReady?.() } })
    await delivery.accept(SESSION_ID, f.context, [NUDGE], 0)
    expect(coordinator.flushOnIdle()).toBe(0)
    expect(delivered).toEqual([])
    coordinator.enqueue({ key: "task-completion:1", source: "task-completion", content: "done" })
    expect(coordinator.flushOnIdle()).toBe(2)
    await wakeReady
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toContain(NUDGE.hint)
    expect(delivered[0]).toContain("done")
    expect(wakeEntry).toEqual({ version: 1, nudges: [NUDGE], via: "wake" })
    expect(coordinator.pendingCount()).toBe(0)
    expect(delivery.drainForPrompt(SESSION_ID, f.context)).toEqual([])
    await expect(f.pending.take(SESSION_ID, { currentEpoch: 0 })).resolves.toEqual([])
  })

  test("#given accepted nudges #when compaction is accepted #then state, coordinator, and pending file are cleared", async () => {
    const f = await fixture()
    const coordinator = new IdleInjectionCoordinator(() => undefined)
    const delivery = createKibitzerDelivery({ ledgerFor: () => f.ledger, pendingFor: () => f.pending, coordinator, sendMessage: () => undefined, appendEntry: () => undefined })
    await delivery.accept(SESSION_ID, f.context, [NUDGE], 0)
    await delivery.onCompactionAccepted(SESSION_ID, f.context)
    await delivery.onToolResult(SESSION_ID, f.context, { hasPendingMessages: () => false, isIdle: () => false })
    expect(coordinator.remove(`kibitzer:${NUDGE.path}`)).toBe(false)
    await expect(f.pending.take(SESSION_ID, { currentEpoch: 0 })).resolves.toEqual([])
  })

  test("#given accepted nudges #when session shuts down #then only in-memory wake state is cleared", async () => {
    const f = await fixture()
    const coordinator = new IdleInjectionCoordinator(() => undefined)
    const delivery = createKibitzerDelivery({ ledgerFor: () => f.ledger, pendingFor: () => f.pending, coordinator, sendMessage: () => undefined, appendEntry: () => undefined })
    await delivery.accept(SESSION_ID, f.context, [NUDGE], 0)
    delivery.onSessionShutdown(SESSION_ID)
    await delivery.onToolResult(SESSION_ID, f.context, { hasPendingMessages: () => false, isIdle: () => false })
    expect(coordinator.remove(`kibitzer:${NUDGE.path}`)).toBe(false)
    await expect(f.pending.take(SESSION_ID, { currentEpoch: 0 })).resolves.toEqual([NUDGE])
  })
})
