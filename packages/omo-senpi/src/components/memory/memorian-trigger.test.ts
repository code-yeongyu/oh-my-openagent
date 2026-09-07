import { describe, expect, test } from "bun:test"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import { tryAcquireJudgeSlot } from "./memorian-concurrency"
import { ToolArgWindow } from "./recall-query-planner-tools"
import { createMemorianTrigger } from "./memorian-trigger"
import type { CollectedRecallCandidates } from "./recall-wiring"
import type { MemorianGatePort } from "./memorian-wiring"
import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"

const context: MemoryIdentityContext = createMemoryIdentityContext({
  identity: "agent",
  identityPaths: buildIdentityPaths("/tmp/omo-memorian-trigger", "agent"),
  binding: createMemoryBinding({ identity: "agent", repoPath: "/tmp/omo-memorian-trigger/repo", boundAt: 0 }),
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
  launch: (input: Parameters<MemorianGatePort["launch"]>[0]) => Promise<unknown> = async () => ({ status: "empty" }),
  
  logs: Array<{ message: string; details?: unknown }> = [],
) {
  return createMemorianTrigger({
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
  const trigger = createMemorianTrigger({
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
  expect(logs).toContainEqual({ message: "memorian trigger skipped", details: { sessionId: "session-1", reason: "unchanged_candidates" } })
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
  expect(logs).toContainEqual({ message: "memorian trigger skipped", details: { sessionId: "session-1", reason: "launch_ceiling" } })
})

test("#given a nudged result #when launched #then accepted nudges receive the launch epoch", async () => {
  let accepted: readonly unknown[] = []
  let epoch = -1
  const trigger = createMemorianTrigger({
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
  expect(logs).toContainEqual({ message: "memorian trigger skipped", details: { sessionId: "session-1", reason: "judge_cap" } })
})

describe("memorian trigger contract", () => {
  test("#given a stale event context #when the handler returns #then detached work uses snapshots", async () => {
    let stale = false
    const launches: unknown[] = []
    const eventCtx = { get modelRegistry(): unknown { if (stale) throw new Error("stale"); return undefined } }
    const trigger = createMemorianTrigger({
      snapshotSession: () => ({ id: "session-1", entries: [] }), resolveModelRegistry: () => undefined,
      collectCandidatesFromSnapshot: async () => collected(["a"]),
      runnerFor: () => ({ launch: async (input) => { launches.push(input); return { status: "empty" as const } } }),
      resolveContext: () => context, onAccepted: async () => {}, report: () => {}, currentCompactionEpoch: () => 0, argWindow: new ToolArgWindow(),
    })
    trigger.onToolCall({ toolName: "read", input: {} }, eventCtx); stale = true; await trigger.whenIdle()
    expect(launches).toHaveLength(1)
  })
})
