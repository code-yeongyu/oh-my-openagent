import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { rmEfaultTolerant } from "./teardown.test-support"

import { buildIdentityPaths, GitMemoryRepo } from "@oh-my-opencode/memory-core"
import type { ChildSpec, RunnerOutcome, SenpiModelPort } from "@oh-my-opencode/senpi-task"

import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext } from "./context"
import { NUDGED_ENTRY_TYPE } from "./kibitzer/notice"
import { fakeChild, withinMs, type FakeChild } from "./kibitzer/sidecar.test-support"
import type { AnyKibitzerSidecarTool } from "./kibitzer/tools/result"
import { MemoryFakeExtensionAPI, componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { MEMORY_NOTICE_CUSTOM_TYPE } from "./prompt"
import { RECALL_CUSTOM_TYPE } from "./recall-session-read"
import { createMemoryWiring, type MemoryWiring } from "./wiring"

const ROLLOUTS = "reference/rollouts.md"
const HINT = "Drain nodes first."
const completed: RunnerOutcome = { status: "completed", finalResponse: "", model: "omo-mock/mock-1" }
const model: SenpiModelPort = { provider: "omo-mock", id: "mock-1" }
const registry = {
  getAvailable: () => [model],
  find: (provider: string, modelId: string) => (provider === model.provider && modelId === model.id ? model : undefined),
  getProviderAuth: () => undefined,
}

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rmEfaultTolerant(root)
  }
})

interface Fixture {
  readonly pi: MemoryFakeExtensionAPI
  readonly wiring: MemoryWiring
  readonly sessionId: string
  readonly specs: ChildSpec[]
  readonly eventCtx: Record<string, unknown>
  nextChild(): Promise<FakeChild>
}

async function fixture(): Promise<Fixture> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-tool-boundary-")))
  roots.push(root)
  const identity = "tool-boundary-agent"
  const paths = buildIdentityPaths(join(root, "memory"), identity)
  const repo = new GitMemoryRepo({ dir: paths.repo, agentId: identity })
  await repo.init({
    seedFiles: [
      { relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\npersona\n" },
      { relativePath: ROLLOUTS, content: "---\ndescription: Rollout guidance\n---\nDrain nodes before a rollout.\n" },
    ],
  })
  const context = createMemoryIdentityContext({ identity, identityPaths: paths, binding: createMemoryBinding({ identity, repoPath: paths.repo, boundAt: 1 }) })
  const sessionId = "tool-boundary-session"
  const specs: ChildSpec[] = []
  const waiters: Array<(child: FakeChild) => void> = []
  const memory = memorySettings()
  const pi = new MemoryFakeExtensionAPI()
  const wiring = createMemoryWiring({
    sessions: new Map([[sessionId, { context }]]),
    loadConfig: () => ({ ...loadedMemoryConfig(memory), config: { memory, categories: { quick: { model: "omo-mock/mock-1" } } } }),
    cwd: () => root,
    env: {},
    kibitzerChildStarter: {
      createRunner: () => ({
        start: async (spec) => {
          specs.push(spec)
          const child = fakeChild({
            sessionId: spec.parentSessionId,
            generation: specs.length,
            prompt: spec.prompt,
            tools: (spec.memberScopedTools ?? []) as readonly AnyKibitzerSidecarTool[],
            maxItems: 2,
          })
          for (const waiter of waiters.splice(0)) waiter(child)
          return child.handle
        },
      }),
    },
  })
  const branch = [{ type: "message", message: { role: "user", content: "Drain nodes before rollout." } }]
  const eventCtx = {
    sessionManager: { getSessionId: () => sessionId, getEntries: () => branch, getBranch: () => branch },
    hasPendingMessages: () => false,
    isIdle: () => false,
    modelRegistry: registry,
  }
  wiring.registerStatic(pi, { ...componentContext(), idleCoordinator: new IdleInjectionCoordinator(() => {}) })
  return {
    pi,
    wiring,
    sessionId,
    specs,
    eventCtx,
    nextChild: () => withinMs(new Promise<FakeChild>((resolve) => waiters.push(resolve)), "the resident child"),
  }
}

/** Wakes the resident Kibitzer through a tool_call, has it nudge the rollout memory, and settles its turn. */
async function nudgedThroughToolCall(f: Fixture): Promise<FakeChild> {
  await f.pi.dispatch("tool_call", { toolName: "read", input: { path: ROLLOUTS } }, f.eventCtx)
  const child = await f.nextChild()
  expect((await child.nudge(ROLLOUTS, HINT)).isError).not.toBe(true)
  child.settle(completed)
  await f.wiring.whenIdle()
  return child
}

describe("kibitzer registration wiring", () => {
  test("#given a resident child seam and idle coordinator #when tool_call wakes the sidecar and tool_result follows #then one steer and one nudged entry are emitted", async () => {
    const f = await fixture()

    await nudgedThroughToolCall(f)
    await f.pi.dispatch("tool_result", { toolName: "read", isError: false }, f.eventCtx)

    expect(f.specs).toHaveLength(1)
    expect(f.specs[0]?.taskId).toBe(`kibitzer-${f.sessionId}-1`)
    expect(f.pi.messages).toHaveLength(1)
    expect(f.pi.messages[0]?.options).toEqual({ deliverAs: "steer" })
    expect(f.pi.messages[0]?.message).toMatchObject({ customType: RECALL_CUSTOM_TYPE, display: false })
    expect(String(f.pi.messages[0]?.message.content)).toContain(HINT)
    expect(f.pi.entries.filter((entry) => entry.customType === NUDGED_ENTRY_TYPE)).toHaveLength(1)
  })

  test("#given a held nudge #when before_agent_start dispatches #then the handlers run projection, recall drain, Kibitzer in that order and only the drain contributes the recall message", async () => {
    const f = await fixture()
    await nudgedThroughToolCall(f)

    const results = await f.pi.dispatch("before_agent_start", { type: "before_agent_start", prompt: "continue", systemPrompt: "BASE" }, f.eventCtx)

    expect(f.pi.handlers.filter((registration) => registration.event === "before_agent_start")).toHaveLength(3)
    expect(results).toHaveLength(3)
    const [projection, recall, kibitzer] = results as Array<{ systemPrompt?: string; message?: { customType?: string; content?: string } } | undefined>
    // Projection first: it is the only writer of systemPrompt, and its message is the memory notice.
    expect(projection?.systemPrompt).toContain("persona")
    expect(projection?.message?.customType).toBe(MEMORY_NOTICE_CUSTOM_TYPE)
    expect(recall?.message?.customType).toBe(RECALL_CUSTOM_TYPE)
    expect(recall?.message?.content).toContain(HINT)
    expect(recall?.systemPrompt).toBeUndefined()
    expect(kibitzer).toBeUndefined()
    // The drained nudge was delivered on the prompt path; nothing is steered afterwards.
    expect(f.pi.messages).toEqual([])
    const nudged = f.pi.entries.filter((entry) => entry.customType === NUDGED_ENTRY_TYPE)
    expect(nudged).toHaveLength(1)
    expect(nudged[0]?.data).toMatchObject({ via: "prompt" })
  })
})
