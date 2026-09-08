import { expect, test } from "bun:test"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import { createMemorianTrigger } from "./memorian-trigger"
import { ToolArgWindow } from "./recall-query-planner-tools"
import type { CollectedRecallCandidates } from "./recall-wiring"
import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"

const context: MemoryIdentityContext = createMemoryIdentityContext({
  identity: "agent",
  identityPaths: buildIdentityPaths("/tmp/omo-memorian-trigger-latch", "agent"),
  binding: createMemoryBinding({ identity: "agent", repoPath: "/tmp/omo-memorian-trigger-latch/repo", boundAt: 0 }),
})
const makeCollected = (path: string): CollectedRecallCandidates => ({
  sessionId: "session-1", context, candidates: [{ path, description: path, excerpt: path, score: 1 }],
  surfaced: new Set(), maxItems: 1, transcript: [],
})

test("#given an active runner #when a new candidate arrives #then one trailing launch waits for idle", async () => {
  let releaseIdle = (): void => {}
  const idle = new Promise<void>((resolve) => { releaseIdle = resolve })
  const launches: string[] = []
  let call = 0
  const trigger = createMemorianTrigger({
    snapshotSession: () => ({ id: "session-1", entries: [] }),
    resolveModelRegistry: () => undefined,
    collectCandidatesFromSnapshot: async () => makeCollected(call++ === 0 ? "a" : "b"),
    runnerFor: () => ({
      launch: async (input) => {
        const path = input.candidates[0]?.path ?? ""
        launches.push(path)
        return { status: path === "a" ? "active" as const : "empty" as const }
      },
      whenIdle: async () => idle,
    }),
    resolveContext: () => context,
    onAccepted: async () => {}, report: () => {}, currentCompactionEpoch: () => 0,
    argWindow: new ToolArgWindow(),
  })

  trigger.onToolCall({ toolName: "read", input: {} }, {})
  await Promise.resolve()
  trigger.onToolCall({ toolName: "read", input: {} }, {})
  await Promise.resolve()
  expect(launches).toEqual(["a"])
  releaseIdle()
  await trigger.whenIdle()
  expect(launches).toEqual(["a", "b"])
})

test("#given a compaction #when the same candidates arrive #then the fingerprint is reset", async () => {
  let launches = 0
  const trigger = createMemorianTrigger({
    snapshotSession: () => ({ id: "session-1", entries: [] }), resolveModelRegistry: () => undefined,
    collectCandidatesFromSnapshot: async () => makeCollected("a"),
    runnerFor: () => ({ launch: async () => { launches += 1; return { status: "empty" as const } } }),
    resolveContext: () => context, onAccepted: async () => {}, report: () => {}, currentCompactionEpoch: () => 0,
    argWindow: new ToolArgWindow(),
  })
  trigger.onSettled({}); await trigger.whenIdle(); trigger.onCompactionAccepted("session-1")
  trigger.onSettled({}); await trigger.whenIdle()
  expect(launches).toBe(2)
})
