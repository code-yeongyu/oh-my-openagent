/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import { shouldIncludeTaskTools } from "./subagent-spawn-limits"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import { resetLiveServerRouteForTesting } from "../../shared/live-server-route"

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate() && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

beforeEach(() => {
  releaseAllPromptAsyncReservationsForTesting()
  resetLiveServerRouteForTesting()
})

// Depth/member-aware child tool surface (senpi-task parity): an ordinary
// background child inside maxDepth keeps the task family; team (DAG) members
// and children at the depth floor do not. Depth enforcement itself stays in
// reserveSubagentSpawn/assertCanSpawn.

type SessionRecord = { directory?: string; parentID?: string }

function createLaunchHarness(sessions: Record<string, SessionRecord>) {
  const promptCalls: Array<Record<string, unknown>> = []
  const client = {
    session: {
      get: async (input: { path: { id: string } }) => {
        const record = sessions[input.path.id]
        if (!record) return { error: "not found" }
        return { data: { directory: "/parent", ...record } }
      },
      create: async () => ({ data: { id: "ses_child" } }),
      promptAsync: async (input: Record<string, unknown>) => {
        promptCalls.push(input)
        return {}
      },
      abort: async () => ({}),
    },
  }
  const manager = new BackgroundManager({
    pluginContext: unsafeTestValue<PluginInput>({ client, directory: tmpdir() }),
  })
  return { manager, promptCalls }
}

function launchToolsOf(call: Record<string, unknown>): Record<string, boolean> {
  const body = call.body as { tools: Record<string, boolean> }
  return body.tools
}

describe("shouldIncludeTaskTools", () => {
  test("ordinary child below the depth floor keeps the task family", () => {
    expect(shouldIncludeTaskTools({ teamRunId: undefined, spawnDepth: 1, maxDepth: 3 })).toBe(true)
    expect(shouldIncludeTaskTools({ teamRunId: undefined, spawnDepth: 2, maxDepth: 3 })).toBe(true)
  })

  test("child at the depth floor cannot delegate further (decideDepthPolicy parity)", () => {
    // decideDepthPolicy admits childDepth <= maxDepth, so a child at depth
    // maxDepth would only ever spawn a refused grandchild: deny the tool.
    expect(shouldIncludeTaskTools({ teamRunId: undefined, spawnDepth: 3, maxDepth: 3 })).toBe(false)
  })

  test("team (DAG) members never receive the task family", () => {
    expect(shouldIncludeTaskTools({ teamRunId: "team-1", spawnDepth: 1, maxDepth: 3 })).toBe(false)
  })

  test("legacy tasks without a recorded depth are treated as depth 1", () => {
    expect(shouldIncludeTaskTools({ teamRunId: undefined, spawnDepth: undefined, maxDepth: 3 })).toBe(true)
  })
})

describe("BackgroundManager child task-tool surface", () => {
  test("launch grants task to an ordinary sisyphus-junior child within maxDepth", async () => {
    // given a root parent (childDepth 1)
    const { manager, promptCalls } = createLaunchHarness({ ses_parent: {} })

    // when
    await manager.launch({
      description: "Test task",
      prompt: "Do something",
      agent: "sisyphus-junior",
      parentSessionId: "ses_parent",
      parentMessageId: "msg_parent",
    })
    await waitUntil(() => promptCalls.length > 0)
    await manager.shutdown()

    // then the agent-level task deny is overridden by the depth-aware grant
    expect(promptCalls).toHaveLength(1)
    expect(launchToolsOf(promptCalls[0]!).task).toBe(true)
  })

  test("launch grants task to an ordinary explore child within maxDepth", async () => {
    // given
    const { manager, promptCalls } = createLaunchHarness({ ses_parent: {} })

    // when
    await manager.launch({
      description: "Test task",
      prompt: "Do something",
      agent: "explore",
      parentSessionId: "ses_parent",
      parentMessageId: "msg_parent",
    })
    await waitUntil(() => promptCalls.length > 0)
    await manager.shutdown()

    // then
    expect(launchToolsOf(promptCalls[0]!).task).toBe(true)
  })

  test("launch keeps task denied for a team member (DAG exclusion)", async () => {
    // given
    const { manager, promptCalls } = createLaunchHarness({ ses_parent: {} })

    // when
    await manager.launch({
      description: "Test task",
      prompt: "Do something",
      agent: "sisyphus-junior",
      parentSessionId: "ses_parent",
      parentMessageId: "msg_parent",
      teamRunId: "team-1",
    } as Parameters<BackgroundManager["launch"]>[0])
    await waitUntil(() => promptCalls.length > 0)
    await manager.shutdown()

    // then
    expect(launchToolsOf(promptCalls[0]!).task).toBe(false)
  })

  test("launch keeps task denied at the depth floor while still admitting the child", async () => {
    // given a parent at depth 2, so the child is admitted at depth 3 == maxDepth
    const { manager, promptCalls } = createLaunchHarness({
      ses_parent: { parentID: "ses_gp" },
      ses_gp: { parentID: "ses_root" },
      ses_root: {},
    })

    // when
    await manager.launch({
      description: "Test task",
      prompt: "Do something",
      agent: "sisyphus-junior",
      parentSessionId: "ses_parent",
      parentMessageId: "msg_parent",
    })
    await waitUntil(() => promptCalls.length > 0)
    await manager.shutdown()

    // then the child spawns (depth 3 <= maxDepth 3) but cannot delegate further
    expect(promptCalls).toHaveLength(1)
    expect(launchToolsOf(promptCalls[0]!).task).toBe(false)
  })

  test("an explicit user permission deny of task wins over the depth grant", async () => {
    // given
    const { manager, promptCalls } = createLaunchHarness({ ses_parent: {} })

    // when
    await manager.launch({
      description: "Test task",
      prompt: "Do something",
      agent: "sisyphus-junior",
      parentSessionId: "ses_parent",
      parentMessageId: "msg_parent",
      userPermission: { task: "deny" },
    } as Parameters<BackgroundManager["launch"]>[0])
    await waitUntil(() => promptCalls.length > 0)
    await manager.shutdown()

    // then
    expect(launchToolsOf(promptCalls[0]!).task).toBe(false)
  })
})
