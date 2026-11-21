import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "../../features/background-agent"
import { __resetTimingConfig, __setTimingConfig } from "./timing"
import { executeSyncTask } from "./sync-task"

const ROOT = "parent-session"
const SEQUENTIAL_DELEGATIONS = 30

function createManager(): BackgroundManager {
  const client = {
    session: {
      get: async ({ path }: { path: { id: string } }) => ({ data: { id: path.id, directory: "/tmp" } }),
      abort: async () => ({}),
    },
  }
  const pluginContext = { client, directory: "/tmp" } as unknown as PluginInput
  return new BackgroundManager({ pluginContext })
}

function liveDescendants(manager: BackgroundManager): number {
  return (manager as unknown as { rootDescendantCounts: Map<string, number> }).rootDescendantCounts.get(ROOT) ?? 0
}

async function delegateOnce(manager: BackgroundManager, index: number, fetchOk: boolean): Promise<string> {
  const sessionID = `ses_child_${String(index).padStart(8, "0")}`
  const deps = {
    createSyncSession: async () => ({ ok: true as const, sessionID }),
    sendSyncPrompt: async () => null,
    pollSyncSession: async () => null,
    fetchSyncResult: async () =>
      fetchOk ? { ok: true as const, textContent: "done" } : { ok: false as const, error: "Fetch failed" },
  }
  const ctx = { sessionID: ROOT, callID: `call-${index}`, metadata: () => {} }
  const executorCtx = { manager, client: { session: { abort: async () => ({}) } }, directory: "/tmp", onSyncSessionCreated: null }
  const args = { prompt: "p", description: "d", category: "test", load_skills: [], run_in_background: false, command: null }
  return executeSyncTask(args, ctx, executorCtx, { sessionID: ROOT }, "test-agent", undefined, undefined, undefined, undefined, deps)
}

describe("#10101 blocking task() releases its descendant slot", () => {
  let manager: BackgroundManager

  beforeEach(() => {
    __setTimingConfig({ POLL_INTERVAL_MS: 1, MIN_STABILITY_TIME_MS: 0, STABILITY_POLLS_REQUIRED: 1, MAX_POLL_TIME_MS: 100 })
    manager = createManager()
  })

  afterEach(() => {
    manager.shutdown()
    __resetTimingConfig()
  })

  test("more sequential delegations than the per-root cap all spawn, and none stays counted", async () => {
    for (let index = 0; index < SEQUENTIAL_DELEGATIONS; index += 1) {
      const result = await delegateOnce(manager, index, true)
      expect(result).not.toContain("Subagent spawn blocked")
    }
    expect(liveDescendants(manager)).toBe(0)
  })

  test("a delegation that fails after its child session exists also releases its slot", async () => {
    await delegateOnce(manager, 0, false)
    expect(liveDescendants(manager)).toBe(0)
  })
})
