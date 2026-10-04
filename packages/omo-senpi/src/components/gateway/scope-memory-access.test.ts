import { afterEach, expect, test } from "bun:test"
import { join } from "node:path"
import { realpathSync, symlinkSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { GitMemoryRepo, resolveMemoryIdentity, renderMemoryFile } from "@oh-my-opencode/memory-core"

import { createMemoryBinding } from "../memory/binding"
import { createMemoryIdentityContext } from "../memory/context"
import { createMemoryComponent, memoryModuleSupervisor } from "../memory"
import { componentContext, loadedMemoryConfig, memorySettings, MemoryFakeExtensionAPI, sessionContext } from "../memory/memory.test-support"
import { registerMemoryGuard } from "../memory/guard"
import { registerMemoryFilesystemPolicy } from "../memory/policy-guard"
import { PolicyCapturingFakeExtensionAPI } from "../memory/policy-guard.test-support"
import { gatewayReadRepo } from "../memory/gateway-scope"
import { createGatewayScopeAccess } from "./scope-access"
import { createGatewayComponent } from "./index"
import { scopeFixture, type ScopeFixture } from "./scope-memory.test-support"

let fixture: ScopeFixture | undefined
afterEach(async () => { await fixture?.dispose(); fixture = undefined })

test("#given an authoritative lead #when its memory session binds #then it resolves the explicit scope identity while a worker keeps its project identity", async () => {
  const f = fixture = await scopeFixture()
  await f.members("A", "team-A", [{ session_durable_id: "lead", role: "lead" }, { session_durable_id: "worker", role: "worker" }])
  const pi = new MemoryFakeExtensionAPI()
  createMemoryComponent({
    env: f.env, resolveCwd: () => f.workspace,
    scopeAccess: createGatewayScopeAccess(async () => f.store, f.env),
    loadConfig: () => loadedMemoryConfig(memorySettings()),
    createRuntime: () => { throw new Error("bind-only fixture") },
  }).register(pi, componentContext())
  const count = memoryModuleSupervisor.refCount
  try {
    await pi.dispatch("session_start", {}, sessionContext({ sessionId: "lead", cwd: f.workspace }))
    await pi.dispatch("session_start", {}, sessionContext({ sessionId: "worker", cwd: f.workspace }))
    expect(pi.entries[0]?.data).toMatchObject({ identity: resolveMemoryIdentity(JSON.stringify(["A", "team-A"]), f.workspace, f.env).id })
    expect(pi.entries[1]?.data).toMatchObject({ identity: resolveMemoryIdentity("auto", f.workspace, f.env).id })
  } finally {
    while (memoryModuleSupervisor.refCount > count) memoryModuleSupervisor.release()
  }
})

test("#given a worker #when memory writes target its scope repo #then mutation is refused with a reason", async () => {
  const f = fixture = await scopeFixture()
  await f.members("A", "team-A", [{ session_durable_id: "worker", role: "worker" }])
  await f.repo("team-A").init()
  const identity = resolveMemoryIdentity("auto", f.workspace, f.env)
  const pi = new MemoryFakeExtensionAPI()
  createMemoryComponent({
    env: f.env, resolveCwd: () => f.workspace,
    scopeAccess: createGatewayScopeAccess(async () => f.store, f.env),
    loadConfig: () => loadedMemoryConfig(memorySettings()),
    createRuntime: () => { throw new Error("tool-only fixture") },
  }).register(pi, componentContext())
  const count = memoryModuleSupervisor.refCount
  try {
  await pi.dispatch("session_start", {}, sessionContext({ sessionId: "worker", cwd: f.workspace }))
  const tool = pi.tools.find((entry) => entry.name === "memory")
  if (typeof tool?.execute !== "function") throw new Error("memory is not registered")
  const result = await Reflect.apply(tool.execute, tool, ["test", {
    command: "create", reason: "forbidden write",
    file_path: join(f.repo("team-A").dir, "reference/forbidden.md"), description: "blocked", file_text: "blocked",
  }])
  expect(result.isError).toBe(true)
  expect(result.details.message.length).toBeGreaterThan(0)
  expect(await f.repo("team-A").lsTree()).toEqual([])
  expect(pi.entries[0]?.data).toMatchObject({ identity: identity.id })
  } finally {
  while (memoryModuleSupervisor.refCount > count) memoryModuleSupervisor.release()
  }
})

test("#given two scopes in one workspace #when learning is read through the worker read tool #then only current scope members can read it", async () => {
  const f = fixture = await scopeFixture()
  const access = createGatewayScopeAccess(async () => f.store, f.env)
  await f.members("A", "team-A", [{ session_durable_id: "A-worker", role: "worker" }, { session_durable_id: "moving", role: "worker" }])
  await f.members("B", "team-B", [{ session_durable_id: "B-worker", role: "worker" }])
  await f.repo("team-B").init({ seedFiles: [{ relativePath: "reference/B.md", content: renderMemoryFile({ description: "B only" }, "B note") }] })
  const saved = await f.learn("A-worker", { text: "A-ONLY-READ" })
  const target = join(f.repo("team-A").dir, saved.details.path)
  const identity = resolveMemoryIdentity("auto", f.workspace, f.env)
  const context = createMemoryIdentityContext({ identity: identity.id, identityPaths: identity.paths, binding: createMemoryBinding({ identity: identity.id, repoPath: identity.paths.repo, boundAt: 1 }) })
  const pi = new PolicyCapturingFakeExtensionAPI()
  const denied = [join(f.env.OMO_MEMORY_HOME, "agents"), join(f.env.OMO_MEMORY_HOME, "gateway-scopes")]
  registerMemoryGuard(pi, componentContext(), { getContext: () => context, resolveCwd: () => f.workspace, readRepoFor: (session) => gatewayReadRepo(access, session, f.workspace), additionalDeniedRoots: denied })
  const readAs = async (session: string, path = target) => {
    const verdicts = await pi.dispatch("tool_call", { toolName: "read", input: { path } }, f.context(session))
    if (verdicts.some((value) => value !== null && typeof value === "object" && Reflect.get(value, "block") === true)) return { kind: "refused" }
    return { kind: "read", text: await readFile(path, "utf8") }
  }
  expect((await readAs("A-worker")).kind).toBe("read")
  expect((await readAs("B-worker")).kind).toBe("refused")
  const alias = join(f.repo("team-A").dir, "alias.md")
  symlinkSync(join(f.repo("team-B").dir, "reference/B.md"), alias)
  expect((await readAs("A-worker", alias)).kind).toBe("refused")
  expect((await readAs("moving")).kind).toBe("read")
  await f.members("B", "team-B", [{ session_durable_id: "B-worker", role: "worker" }, { session_durable_id: "moving", role: "worker" }])
  expect((await readAs("moving")).kind).toBe("refused")
  registerMemoryFilesystemPolicy(pi, context, { readRepoFor: () => gatewayReadRepo(access, "A-worker", f.workspace), denied, context: () => context })
  const policy = pi.filesystemPolicies[0]
  expect(await policy?.check({ operation: "read", canonicalPath: realpathSync(target), toolName: "read" })).toEqual({ allow: true })
  expect(await policy?.check({ operation: "write", canonicalPath: realpathSync(target), toolName: "write" })).toMatchObject({ allow: false, reason: expect.stringContaining("gateway_learning") })
  await f.members("A", "team-A", [])
  expect(await policy?.check({ operation: "read", canonicalPath: realpathSync(target), toolName: "read" })).toMatchObject({ allow: false })
})

test("#given a lead moving between scopes sharing an identity name #when its prior prompt is reused #then its former scope memory is removed", async () => {
  const f = fixture = await scopeFixture()
  const access = createGatewayScopeAccess(async () => f.store, f.env)
  await f.repo("shared-name", "A").init({ seedFiles: [{ relativePath: "system/work.md", content: renderMemoryFile({ description: "A work" }, "A-ONLY-LEAD") }] })
  await f.repo("shared-name", "B").init({ seedFiles: [{ relativePath: "system/work.md", content: renderMemoryFile({ description: "B work" }, "B-ONLY-LEAD") }] })
  const project = resolveMemoryIdentity("auto", f.workspace, f.env)
  await new GitMemoryRepo({ dir: project.paths.repo, agentId: project.id }).init({ seedFiles: [{ relativePath: "system/project.md", content: renderMemoryFile({ description: "project work" }, "PROJECT-B") }] })
  await f.members("A", "shared-name", [{ session_durable_id: "moving-lead", role: "lead" }])
  const pi = new MemoryFakeExtensionAPI()
  const ctx = componentContext()
  createMemoryComponent({
    env: f.env, resolveCwd: () => f.workspace, scopeAccess: access,
    loadConfig: () => loadedMemoryConfig(memorySettings()), createRuntime: () => { throw new Error("prompt-only fixture") },
  }).register(pi, ctx)
  createGatewayComponent({ scopeAccess: access, loadGatewaySection: () => undefined }).register(pi, ctx)
  const eventCtx = {
    ...sessionContext({ sessionId: "moving-lead", cwd: f.workspace }),
    sessionManager: {
      ...f.context("moving-lead").sessionManager,
      getEntries: () => pi.entries.map((entry) => ({ type: "custom", ...entry })),
      getBranch: () => pi.entries.map((entry) => ({ type: "custom", ...entry })),
    },
  }
  const prompt = async (base: string) => {
    let current = base
    for (const entry of pi.handlers.filter((entry) => entry.event === "before_agent_start")) {
      const result = await entry.handler({ type: "before_agent_start", systemPrompt: current, prompt: "" }, eventCtx)
      if (result !== null && typeof result === "object" && typeof Reflect.get(result, "systemPrompt") === "string") current = String(Reflect.get(result, "systemPrompt"))
    }
    return current
  }
  const count = memoryModuleSupervisor.refCount
  try {
    await pi.dispatch("session_start", {}, eventCtx)
    const first = await prompt("BASE")
    expect(first).toContain("A-ONLY-LEAD")
    await f.members("B", "shared-name", [{ session_durable_id: "moving-lead", role: "lead" }])
    const second = await prompt(first)
    expect(second).not.toContain("A-ONLY-LEAD")
    expect(second).toContain("B-ONLY-LEAD")
    await f.members("B", "shared-name", [{ session_durable_id: "moving-lead", role: "worker" }])
    const third = await prompt(second)
    expect(third).not.toContain("A-ONLY-LEAD")
    expect(third).not.toContain("B-ONLY-LEAD")
    expect(third).toContain("PROJECT-B")
  } finally {
    while (memoryModuleSupervisor.refCount > count) memoryModuleSupervisor.release()
  }
})
