import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { buildIdentityPaths, PendingNudges, RecallLedger, type RecallNudge } from "@oh-my-opencode/memory-core"
import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { tryAcquireJudgeSlot } from "./kibitzer-concurrency"
import { createKibitzerDelivery } from "./kibitzer-delivery"
import { KibitzerGateRunner } from "./kibitzer-runner"
import { CANDIDATES, nudgeOnce, registrySnapshot, runnerOptions, scriptedSession } from "./kibitzer-runner.test-support"
import { createKibitzerTrigger } from "./kibitzer-trigger"
import { createKibitzerGateWiring } from "./kibitzer-wiring"
import { MemoryFakeExtensionAPI, memorySettings } from "./memory.test-support"
import { ToolArgWindow } from "./recall-query-planner-tools"
import { createRecallDrain } from "./recall-drain"

const sessionId = "observability-session"
const nudge: RecallNudge = { path: "memory/rollouts.md", hint: "Drain nodes before rollout." }
const dirs: string[] = []
type GateEntry = { outcome: { status: string; cause?: string }; collected?: unknown }

afterEach(async () => {
  for (const dir of dirs.splice(0)) await Bun.$`rm -rf ${dir}`
})

function contextFor(dir: string): MemoryIdentityContext {
  return createMemoryIdentityContext({
    identity: "observability-agent",
    identityPaths: buildIdentityPaths(join(dir, "memory"), "observability-agent"),
    binding: createMemoryBinding({ identity: "observability-agent", repoPath: join(dir, "repo"), boundAt: 0 }),
  })
}

function triggerFor(logs: Array<{ message: string; details?: unknown }>, gateEntries: GateEntry[], nudgedEntries: unknown[] = [], result: unknown = { status: "empty" }) {
  const context = contextFor("/tmp/kibitzer-observability-trigger")
  return createKibitzerTrigger({
    snapshotSession: () => ({ id: sessionId, entries: [] }),
    resolveModelRegistry: () => undefined,
    collectCandidatesFromSnapshot: async () => ({
      sessionId,
      context,
      candidates: [{ path: "memory/one.md", description: "one", excerpt: "one", score: 1 }],
      surfaced: new Set<string>(),
      maxItems: 1,
      transcript: [],
    }),
    runnerFor: () => ({ launch: async () => result }),
    resolveContext: () => context,
    onAccepted: async (_sessionId, _context, nudges) => { nudgedEntries.push({ version: 1, nudges }) },
    report: (_sessionId, outcome, collected) => gateEntries.push({ outcome, collected }),
    currentCompactionEpoch: () => 0,
    argWindow: new ToolArgWindow(),
    logger: {
      info: (message, details) => logs.push({ message, details }),
      warn: () => undefined,
      error: () => undefined,
    },
  })
}

async function fixture(): Promise<{
  context: MemoryIdentityContext
  ledger: RecallLedger
  pending: PendingNudges
}> {
  const dir = await mkdtemp(join(tmpdir(), "kibitzer-observability-"))
  dirs.push(dir)
  const context = contextFor(dir)
  return {
    context,
    ledger: new RecallLedger(context.identityPaths.recallLedger),
    pending: new PendingNudges(context.identityPaths.recallPending),
  }
}

describe("kibitzer observability contract", () => {
  test("#given two accepted judges #when tool and settle triggers exceed the budget #then one cooldown gate entry is recorded without another child or delivery", async () => {
    const { context } = await fixture()
    const stub = scriptedSession(nudgeOnce)
    stub.resolve()
    const runner = new KibitzerGateRunner(runnerOptions(context.identityPaths, { createSession: stub.createSession }))
    const gate = createKibitzerGateWiring({ resolveContext: () => context, runnerFor: () => runner })
    const entries: Array<{ customType: string; data: unknown }> = []
    gate.attachEntrySink((customType, data) => entries.push({ customType, data }))
    const accepted: unknown[] = []
    let collection = 0
    const trigger = createKibitzerTrigger({
      snapshotSession: () => ({ id: sessionId, entries: [] }),
      resolveModelRegistry: () => registrySnapshot(),
      collectCandidatesFromSnapshot: async () => ({
        sessionId,
        context,
        candidates: [...CANDIDATES, { path: `reference/control-${++collection}.md`, description: "control", excerpt: "control", score: 1 }],
        surfaced: new Set<string>(),
        maxItems: 1,
        transcript: [],
      }),
      runnerFor: () => runner,
      resolveContext: () => context,
      onAccepted: async (_id, _context, nudges) => { accepted.push(nudges) },
      report: gate.reportOutcome,
      currentCompactionEpoch: gate.currentCompactionEpoch,
      argWindow: new ToolArgWindow(),
    })

    for (let index = 0; index < 2; index += 1) {
      trigger.onToolCall({ toolName: "read", input: { path: "rollout.ts" } }, {})
      await trigger.whenIdle()
      trigger.onSettled({})
      await trigger.whenIdle()
    }

    expect(stub.created).toBe(2)
    expect(accepted).toHaveLength(2)
    expect(entries).toEqual([{
      customType: "omo-kibitzer:gate",
      data: { version: 1, status: "skipped", cause: "cooldown", candidateCount: 2 },
    }])
  })

  test("#given unchanged candidates #when triggered twice #then skip is logged without a gate entry", async () => {
    const logs: Array<{ message: string; details?: unknown }> = []
    const gateEntries: GateEntry[] = []
    const trigger = triggerFor(logs, gateEntries)

    trigger.onSettled({})
    await trigger.whenIdle()
    trigger.onSettled({})
    await trigger.whenIdle()

    expect(logs).toContainEqual({
      message: "kibitzer trigger skipped",
      details: { sessionId, reason: "unchanged_candidates" },
    })
    expect(gateEntries).toEqual([])
  })

  test("#given judge slots are full #when triggered #then judge cap is logged without a gate entry", async () => {
    const logs: Array<{ message: string; details?: unknown }> = []
    const gateEntries: GateEntry[] = []
    const trigger = triggerFor(logs, gateEntries)
    const first = tryAcquireJudgeSlot()
    const second = tryAcquireJudgeSlot()

    trigger.onSettled({})
    await trigger.whenIdle()
    first?.()
    second?.()

    expect(logs).toContainEqual({
      message: "kibitzer trigger skipped",
      details: { sessionId, reason: "judge_cap" },
    })
    expect(gateEntries).toEqual([])
  })

  test("#given a salvaged launch #when the judge returns partial nudges #then one normal nudged entry and no gate entry are produced", async () => {
    const logs: Array<{ message: string; details?: unknown }> = []
    const gateEntries: GateEntry[] = []
    const nudgedEntries: unknown[] = []
    const trigger = triggerFor(logs, gateEntries, nudgedEntries, { status: "nudged", partial: true, nudges: [nudge] })

    trigger.onSettled({})
    await trigger.whenIdle()

    expect(nudgedEntries).toEqual([{ version: 1, nudges: [nudge] }])
    expect(gateEntries).toEqual([])
  })

  test("#given a dropped deadline outcome #when reported and rendered #then a gate record is kept without a notice", async () => {
    const logs: Array<{ message: string; details?: unknown }> = []
    const gateEntries: GateEntry[] = []
    const trigger = triggerFor(logs, gateEntries, [], { status: "dropped", cause: "deadline" })

    trigger.onSettled({})
    await trigger.whenIdle()

    expect(gateEntries).toHaveLength(1)
    expect(gateEntries[0].outcome).toMatchObject({ status: "dropped", cause: "deadline" })
  })

  test("#given accepted nudges #when steer wake and prompt deliver #then each trace records its via", async () => {
    const steer = await fixture()
    const steerEntries: unknown[] = []
    const steerDelivery = createKibitzerDelivery({
      ledgerFor: () => steer.ledger,
      pendingFor: () => steer.pending,
      sendMessage: () => undefined,
      appendEntry: (_type, data) => steerEntries.push(data),
    })
    await steerDelivery.accept("steer-session", steer.context, [nudge], 0)
    await steerDelivery.onToolResult("steer-session", steer.context, {
      hasPendingMessages: () => false,
      isIdle: () => false,
    })

    const wake = await fixture()
    const wakeEntries: unknown[] = []
    let wakeEntryReady: (() => void) | undefined
    const wakeReady = new Promise<void>((resolve) => { wakeEntryReady = resolve })
    const coordinator = new IdleInjectionCoordinator(() => undefined)
    const wakeDelivery = createKibitzerDelivery({
      ledgerFor: () => wake.ledger,
      pendingFor: () => wake.pending,
      coordinator,
      sendMessage: () => undefined,
      appendEntry: (_type, data) => {
        wakeEntries.push(data)
        if (typeof data === "object" && data !== null && "via" in data && data.via === "wake") wakeEntryReady?.()
      },
    })
    await wakeDelivery.accept("wake-session", wake.context, [nudge], 0)
    coordinator.enqueue({ key: "task-completion:1", source: "task-completion", content: "done" })
    coordinator.flushOnIdle()
    await Promise.race([wakeReady, new Promise<void>((_, r) => setTimeout(() => r(new Error("wake ready timeout")), 5000))])

    const prompt = await fixture()
    const promptEntries: unknown[] = []
    const promptDelivery = createKibitzerDelivery({
      ledgerFor: () => prompt.ledger,
      pendingFor: () => prompt.pending,
      sendMessage: () => undefined,
      appendEntry: (_type, data) => promptEntries.push(data),
    })
    await promptDelivery.accept("prompt-session", prompt.context, [nudge], 0)
    const drain = createRecallDrain({
      resolveContext: (id) => (id === "prompt-session" ? prompt.context : undefined),
      resolveSettings: () => memorySettings(),
      env: {},
      ledgerFor: () => prompt.ledger,
      pendingFor: () => prompt.pending,
      drainQueued: promptDelivery.drainForPrompt,
    })
    const pi = new MemoryFakeExtensionAPI()
    drain.register(pi)
    await pi.dispatch("before_agent_start", { type: "before_agent_start" }, {
      sessionManager: { getSessionId: () => "prompt-session", getBranch: () => [] },
    })

    expect(steerEntries).toEqual([{ version: 1, nudges: [nudge], via: "steer" }])
    await Promise.race([wakeReady, new Promise<void>((_, r) => setTimeout(() => r(new Error("wake ready timeout")), 5000))])
    expect(wakeEntries).toEqual([{ version: 1, nudges: [nudge], via: "wake" }])
    expect(pi.entries.map((entry) => entry.data)).toEqual([{ version: 1, nudges: [nudge], via: "prompt" }])
  })
})
