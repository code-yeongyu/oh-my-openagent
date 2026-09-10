import { afterEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"

import { buildIdentityPaths, PendingNudges, RecallLedger } from "@oh-my-opencode/memory-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createKibitzerDelivery } from "./kibitzer-delivery"
import { registerKibitzerHooks } from "./kibitzer-hooks"
import { memorySettings } from "./memory.test-support"
import { createMemoryRecallWiring } from "./recall-wiring"
import { beforeAgentStart, eventContext, fixture, KUBERNETES_PROMPT, ROLLOUTS_PATH, SESSION_ID, userEntry, type BranchEntry } from "./recall-wiring.test-support"
import { tryAcquireJudgeSlot } from "./kibitzer-concurrency"
import { ToolArgWindow } from "./recall-query-planner-tools"
import { createKibitzerTrigger } from "./kibitzer-trigger"
import type { CollectedRecallCandidates } from "./recall-wiring"
import type { KibitzerGatePort } from "./kibitzer-wiring"
import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"

const context: MemoryIdentityContext = createMemoryIdentityContext({
  identity: "agent",
  identityPaths: buildIdentityPaths("/tmp/omo-kibitzer-trigger", "agent"),
  binding: createMemoryBinding({ identity: "agent", repoPath: "/tmp/omo-kibitzer-trigger/repo", boundAt: 0 }),
})
const collected = (paths: string[]): CollectedRecallCandidates => ({
  sessionId: "session-1",
  context,
  candidates: paths.map((path) => ({ path, description: path, excerpt: path, score: 1 })),
  surfaced: new Set(),
  maxItems: 3,
  transcript: [],
})
function triggerFor(
  collect: (extra: readonly string[]) => Promise<CollectedRecallCandidates | undefined>,
  launch: (input: Parameters<KibitzerGatePort["launch"]>[0]) => Promise<unknown> = async () => ({ status: "empty" }),
  
  logs: Array<{ message: string; details?: unknown }> = [],
) {
  return createKibitzerTrigger({
    snapshotSession: () => ({ id: "session-1", entries: [] }),
    resolveModelRegistry: () => undefined,
    collectCandidatesFromSnapshot: async (_snapshot, extra = []) => collect(extra),
    runnerFor: () => ({ launch, whenIdle: async () => {} }),
    resolveContext: () => context,
    onAccepted: async () => {},
    report: () => {},
    currentCompactionEpoch: () => 0,
    argWindow: new ToolArgWindow(),
    logger: { info: (message, details) => logs.push({ message, details }), warn: () => {}, error: () => {} },
  })
}

test("#given a tool call #when triggered #then args are captured and a deadline is passed", async () => {
  const launches: Array<{ readonly deadlineMs?: number }> = []
  let extraTexts: readonly string[] = []
  const trigger = createKibitzerTrigger({
    snapshotSession: () => ({ id: "session-1", entries: [] }),
    resolveModelRegistry: () => undefined,
    collectCandidatesFromSnapshot: async (_snapshot, extra = []) => { extraTexts = extra; return collected(["a"]) },
    runnerFor: () => ({
      launch: async (input) => { launches.push({ deadlineMs: input.deadlineMs }); return { status: "empty" as const } },
    }),
    resolveContext: () => context,
    onAccepted: async () => {}, report: () => {}, currentCompactionEpoch: () => 0, argWindow: new ToolArgWindow(),
  })
  trigger.onToolCall({ toolName: "read", input: { path: "src/rollouts.md" } }, {})
  await trigger.whenIdle()
  expect(extraTexts.length).toBeGreaterThan(0)
  expect(launches).toEqual([{ deadlineMs: 90_000 }])
})

test("#given unchanged candidates #when triggered twice #then the second launch is skipped", async () => {
  const logs: Array<{ message: string; details?: unknown }> = []
  let launches = 0
  const trigger = triggerFor(async () => collected(["a"]), async () => { launches += 1; return { status: "empty" } }, logs)
  trigger.onSettled({}); await trigger.whenIdle(); trigger.onSettled({}); await trigger.whenIdle()
  expect(launches).toBe(1)
  expect(logs).toContainEqual({ message: "kibitzer trigger skipped", details: { sessionId: "session-1", reason: "unchanged_candidates" } })
})

test("#given different candidate sets #when triggered #then the new set launches", async () => {
  let launches = 0
  let call = 0
  const trigger = triggerFor(async () => collected([call++ === 0 ? "a" : "b"]), async () => { launches += 1; return { status: "empty" } })
  trigger.onSettled({}); await trigger.whenIdle(); trigger.onSettled({}); await trigger.whenIdle()
  expect(launches).toBe(2)
})

test("#given candidate paths in a different order #when triggered #then only one launch occurs", async () => {
  let call = 0
  let launches = 0
  const trigger = triggerFor(async () => collected(call++ === 0 ? ["b", "a"] : ["a", "b"]), async () => { launches += 1; return { status: "empty" } })
  trigger.onSettled({}); await trigger.whenIdle(); trigger.onSettled({}); await trigger.whenIdle()
  expect(launches).toBe(1)
})

test("#given a settle trigger #when launched #then no deadline is passed", async () => {
  let deadline: number | undefined = 1
  const trigger = triggerFor(async () => collected(["settle"]), async (input) => { deadline = input.deadlineMs; return { status: "empty" } })
  trigger.onSettled({}); await trigger.whenIdle()
  expect(deadline).toBeUndefined()
})

test("#given two hundred launches #when the 201st arrives #then the launch ceiling is logged", async () => {
  let call = 0
  let launches = 0
  const logs: Array<{ message: string; details?: unknown }> = []
  const trigger = triggerFor(async () => collected([`candidate-${call++}`]), async () => { launches += 1; return { status: "empty" } }, logs)
  for (let index = 0; index < 201; index += 1) {
    trigger.onSettled({})
    await trigger.whenIdle()
  }
  expect(launches).toBe(200)
  expect(logs).toContainEqual({ message: "kibitzer trigger skipped", details: { sessionId: "session-1", reason: "launch_ceiling" } })
})

test("#given a nudged result #when launched #then accepted nudges receive the launch epoch", async () => {
  let accepted: readonly unknown[] = []
  let epoch = -1
  const trigger = createKibitzerTrigger({
    snapshotSession: () => ({ id: "session-1", entries: [] }), resolveModelRegistry: () => undefined,
    collectCandidatesFromSnapshot: async () => collected(["nudge"]),
    runnerFor: () => ({ launch: async () => ({ status: "nudged" as const, nudges: [{ path: "nudge", text: "use it" }] }) }),
    resolveContext: () => context, onAccepted: async (_id, _context, nudges, launchEpoch) => { accepted = nudges; epoch = launchEpoch },
    report: () => {}, currentCompactionEpoch: () => 7, argWindow: new ToolArgWindow(),
  })
  trigger.onSettled({}); await trigger.whenIdle()
  expect(accepted).toHaveLength(1); expect(epoch).toBe(7)
})

test("#given all judge slots are held #when triggered #then it logs judge_cap without launching", async () => {
  const first = tryAcquireJudgeSlot(); const second = tryAcquireJudgeSlot()
  const logs: Array<{ message: string; details?: unknown }> = []
  let launches = 0
  const trigger = triggerFor(async () => collected(["cap"]), async () => { launches += 1; return { status: "empty" } }, logs)
  trigger.onSettled({}); await trigger.whenIdle(); first?.(); second?.()
  expect(launches).toBe(0)
  expect(logs).toContainEqual({ message: "kibitzer trigger skipped", details: { sessionId: "session-1", reason: "judge_cap" } })
})

const promptDirs: string[] = []
afterEach(async () => {
  await Promise.all(promptDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function promptFixture(entries: readonly BranchEntry[]) {
  const f = await fixture(promptDirs)
  const pi = new FakeExtensionAPI()
  const eventCtx = eventContext(entries)
  const launches: Parameters<KibitzerGatePort["launch"]>[0][] = []
  const queries: (readonly string[])[] = []
  const collections: CollectedRecallCandidates[] = []
  const recall = createMemoryRecallWiring({
    resolveContext: () => f.context, resolveSettings: memorySettings, createRepo: () => f.repo, env: {},
  })
  const argWindow = new ToolArgWindow()
  argWindow.push(SESSION_ID, ["unrelated tool arguments"])
  const delivery = createKibitzerDelivery({
    ledgerFor: () => new RecallLedger(f.context.identityPaths.recallLedger),
    pendingFor: () => new PendingNudges(f.context.identityPaths.recallPending),
    sendMessage: (message, options) => pi.sendMessage(message, options), appendEntry: () => {},
  })
  const trigger = createKibitzerTrigger({
    snapshotSession: recall.snapshotSession, resolveModelRegistry: () => undefined,
    collectCandidatesFromSnapshot: async (snapshot, extra = []) => {
      queries.push(extra)
      const result = await recall.collectCandidatesFromSnapshot(snapshot, extra)
      if (result !== undefined) collections.push(result)
      return result
    },
    runnerFor: () => ({ launch: async (input) => { launches.push(input); return { status: "empty" } } }),
    resolveContext: () => f.context, onAccepted: delivery.accept, report: () => {},
    currentCompactionEpoch: () => 0, argWindow,
  })
  registerKibitzerHooks(pi, {
    trigger, delivery, resolveContext: () => f.context, resolveSessionId: () => SESSION_ID, ...{ env: {} },
  })
  return { pi, eventCtx, trigger, launches, queries, collections }
}

describe("kibitzer prompt events", () => {
  test.each([
    { branch: "existing", entries: [userEntry("m1", "kubernetes nodes rollout")] },
    { branch: "empty", entries: [] },
  ])("#given an $branch branch without the live prompt #when before_agent_start dispatches #then the prompt collects and reaches the judge", async ({ entries }) => {
    // given
    const f = await promptFixture(entries)
    // when
    await f.pi.dispatch("before_agent_start", beforeAgentStart(KUBERNETES_PROMPT), f.eventCtx)
    await f.trigger.whenIdle()
    // then
    expect(f.queries).toEqual([[KUBERNETES_PROMPT]])
    expect(f.launches).toHaveLength(1)
    expect(f.launches[0]?.candidates.map((candidate) => candidate.path)).toContain(ROLLOUTS_PATH)
    expect(f.launches[0]?.transcript.at(-1)).toEqual({ role: "user", text: KUBERNETES_PROMPT })
    expect(f.launches[0]?.deadlineMs).toBeUndefined()
    expect(f.collections[0]?.transcript.some((turn) => turn.text === KUBERNETES_PROMPT)).toBe(false)
  })

  test("#given the live prompt already in the branch #when before_agent_start dispatches #then the judge receives no duplicate user turn", async () => {
    // given
    const f = await promptFixture([userEntry("m1", KUBERNETES_PROMPT)])
    // when
    await f.pi.dispatch("before_agent_start", beforeAgentStart(KUBERNETES_PROMPT), f.eventCtx)
    await f.trigger.whenIdle()
    // then
    expect(f.launches).toHaveLength(1)
    expect(f.launches[0]?.transcript).toEqual([{ role: "user", text: KUBERNETES_PROMPT }])
  })

  test("#given unchanged branch candidates #when the prompt turn settles #then only the prompt-origin transcript launches", async () => {
    // given
    const f = await promptFixture([userEntry("m1", "kubernetes nodes rollout")])
    // when
    await f.pi.dispatch("before_agent_start", beforeAgentStart(KUBERNETES_PROMPT), f.eventCtx)
    await f.trigger.whenIdle()
    await f.pi.dispatch("agent_settled", {}, f.eventCtx)
    await f.trigger.whenIdle()
    // then
    expect(f.launches).toHaveLength(1)
    expect(f.launches[0]?.transcript.at(-1)).toEqual({ role: "user", text: KUBERNETES_PROMPT })
  })
})

describe("kibitzer trigger contract", () => {
  test("#given a stale event context #when the handler returns #then detached work uses snapshots", async () => {
    let stale = false
    const launches: unknown[] = []
    const eventCtx = { get modelRegistry(): unknown { if (stale) throw new Error("stale"); return undefined } }
    const trigger = createKibitzerTrigger({
      snapshotSession: () => ({ id: "session-1", entries: [] }), resolveModelRegistry: () => undefined,
      collectCandidatesFromSnapshot: async () => collected(["a"]),
      runnerFor: () => ({ launch: async (input) => { launches.push(input); return { status: "empty" as const } } }),
      resolveContext: () => context, onAccepted: async () => {}, report: () => {}, currentCompactionEpoch: () => 0, argWindow: new ToolArgWindow(),
    })
    trigger.onToolCall({ toolName: "read", input: {} }, eventCtx); stale = true; await trigger.whenIdle()
    expect(launches).toHaveLength(1)
  })
})
