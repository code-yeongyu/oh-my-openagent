import { afterEach, expect, test } from "bun:test"
import { GitMemoryRepo, renderMemoryFile, resolveMemoryIdentity } from "@oh-my-opencode/memory-core"

import { createMemoryComponent, memoryModuleSupervisor } from "../memory"
import { createMemoryBinding, MEMORY_BINDING_CUSTOM_TYPE } from "../memory/binding"
import { componentContext, loadedMemoryConfig, memorySettings, MemoryFakeExtensionAPI } from "../memory/memory.test-support"
import { createGatewayScopeAccess } from "./scope-access"
import { createGatewayComponent } from "./index"
import { scopeFixture, type ScopeFixture } from "./scope-memory.test-support"

let fixture: ScopeFixture | undefined
afterEach(async () => { await fixture?.dispose(); fixture = undefined })

test("#given a saved lead binding and a restarted worker #when its old prompt is reused #then project memory replaces the former scope memory", async () => {
  const f = fixture = await scopeFixture()
  await f.repo("team-A").init({ seedFiles: [{ relativePath: "system/team.md", content: renderMemoryFile({ description: "A memory" }, "A-ONLY-RESUME") }] })
  const project = resolveMemoryIdentity("recorded-project", f.workspace, f.env)
  await new GitMemoryRepo({ dir: project.paths.repo, agentId: project.id }).init({ seedFiles: [{ relativePath: "system/project.md", content: renderMemoryFile({ description: "project memory" }, "PROJECT-RESUME") }] })
  const access = createGatewayScopeAccess(async () => f.store, f.env)
  const setup = (pi: MemoryFakeExtensionAPI) => {
    createMemoryComponent({
      env: f.env, resolveCwd: () => f.workspace, scopeAccess: access,
      loadConfig: () => loadedMemoryConfig(memorySettings()), createRuntime: () => { throw new Error("prompt-only fixture") },
    }).register(pi, componentContext())
    createGatewayComponent({ scopeAccess: access, loadGatewaySection: () => undefined }).register(pi, componentContext())
  }
  const first = new MemoryFakeExtensionAPI()
  const entries = (pi: MemoryFakeExtensionAPI) => pi.entries.map((entry) => ({ type: "custom", ...entry }))
  const context = (branch: () => ReturnType<typeof entries>) => ({
    cwd: f.workspace,
    sessionManager: { getSessionId: () => "resuming", getEntries: branch, getBranch: branch },
  })
  const prompt = async (pi: MemoryFakeExtensionAPI, ctx: ReturnType<typeof context>, base: string) => {
    let current = base
    for (const entry of pi.handlers.filter((entry) => entry.event === "before_agent_start")) {
      const result = await entry.handler({ type: "before_agent_start", systemPrompt: current, prompt: "" }, ctx)
      if (result !== null && typeof result === "object" && typeof Reflect.get(result, "systemPrompt") === "string") current = String(Reflect.get(result, "systemPrompt"))
    }
    return current
  }
  const count = memoryModuleSupervisor.refCount
  try {
    await f.members("A", "team-A", [{ session_durable_id: "resuming", role: "lead" }])
    setup(first)
    const projectBinding = { type: "custom", customType: MEMORY_BINDING_CUSTOM_TYPE, data: createMemoryBinding({ identity: project.id, repoPath: project.paths.repo, boundAt: 1 }) }
    const firstContext = context(() => [projectBinding, ...entries(first)])
    await first.dispatch("session_start", {}, firstContext)
    const originalPrompt = await prompt(first, firstContext, "BASE")
    expect(originalPrompt).toContain("A-ONLY-RESUME")
    expect(originalPrompt).not.toContain("PROJECT-RESUME")
    const saved = [projectBinding, ...entries(first)]
    await f.members("B", "team-B", [{ session_durable_id: "resuming", role: "worker" }])
    const restarted = new MemoryFakeExtensionAPI()
    setup(restarted)
    const restartedContext = context(() => [...saved, ...entries(restarted)])
    await restarted.dispatch("session_start", {}, restartedContext)
    const current = await prompt(restarted, restartedContext, originalPrompt)
    expect(current).not.toContain("A-ONLY-RESUME")
    expect(current).toContain("PROJECT-RESUME")
  } finally {
    while (memoryModuleSupervisor.refCount > count) memoryModuleSupervisor.release()
  }
})
