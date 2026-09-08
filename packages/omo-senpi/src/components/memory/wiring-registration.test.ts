import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildIdentityPaths, GitMemoryRepo } from "@oh-my-opencode/memory-core"
import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext } from "./context"
import { NUDGED_ENTRY_TYPE } from "./memorian-notice"
import { MemoryFakeExtensionAPI, componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { createMemoryWiring } from "./wiring"

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await Bun.$`rm -rf ${root}` })

describe("memorian registration wiring", () => {
  test("#given a fake runner and idle coordinator #when tool_call then tool_result dispatches #then one steer and one nudged entry are emitted", async () => {
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-tool-boundary-")))
    roots.push(root)
    const identity = "tool-boundary-agent"
    const paths = buildIdentityPaths(join(root, "memory"), identity)
    const repo = new GitMemoryRepo({ dir: paths.repo, agentId: identity })
    await repo.init({ seedFiles: [{ relativePath: "reference/rollouts.md", content: "---\ndescription: Rollout guidance\n---\nDrain nodes before a rollout.\n" }] })
    const context = createMemoryIdentityContext({ identity, identityPaths: paths, binding: createMemoryBinding({ identity, repoPath: paths.repo, boundAt: 1 }) })
    const sessionId = "tool-boundary-session"
    let launch: (() => void) | undefined
    const launched = new Promise<void>((resolve) => { launch = resolve })
    const pi = new MemoryFakeExtensionAPI()
    const wiring = createMemoryWiring({
      sessions: new Map([[sessionId, { context }]]), loadConfig: () => loadedMemoryConfig(memorySettings()), cwd: () => root, env: {},
      createMemorianRunner: () => ({ launch: async () => { launch?.(); return { status: "nudged" as const, nudges: [{ path: "reference/rollouts.md", hint: "Drain nodes first." }], runId: "run-tool-boundary" } }, whenIdle: async () => {} }),
    })
    const eventCtx = { sessionManager: { getSessionId: () => sessionId, getEntries: () => [{ type: "message", message: { role: "user", content: "Drain nodes before rollout." } }], getBranch: () => [{ type: "message", message: { role: "user", content: "Drain nodes before rollout." } }] }, hasPendingMessages: () => false, isIdle: () => false, modelRegistry: { find: () => undefined, getProviderAuth: () => undefined } }
    wiring.registerStatic(pi, { ...componentContext(), idleCoordinator: new IdleInjectionCoordinator(() => {}) })
    await pi.dispatch("tool_call", { toolName: "read", input: { path: "reference/rollouts.md" } }, eventCtx)
    await launched
    await wiring.whenIdle()
    await pi.dispatch("tool_result", { toolName: "read", isError: false }, eventCtx)
    expect(pi.messages).toHaveLength(1)
    expect(pi.messages[0]?.options).toEqual({ deliverAs: "steer" })
    expect(pi.entries.filter((entry) => entry.customType === NUDGED_ENTRY_TYPE)).toHaveLength(1)
  })
})
