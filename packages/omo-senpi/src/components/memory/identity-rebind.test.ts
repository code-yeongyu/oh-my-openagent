// A session that reaches a turn without session_start in this runner generation is rebound from
// its own recorded binding (#8017). These cases pin WHOSE workspace that rebind resolves: the
// session's, never the host process's (#8556).
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveMemoryIdentity } from "@oh-my-opencode/memory-core"
import { createMemoryBinding } from "./binding"
import { MEMORY_BINDING_CUSTOM_TYPE, createMemoryComponent, memoryModuleSupervisor } from "./index"
import { componentContext, loadedMemoryConfig, memorySettings, MemoryFakeExtensionAPI, sessionContext } from "./memory.test-support"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-memory-rebind-"))
  roots.push(root)
  return join(root, "project")
}

function memoryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-memory-rebind-home-"))
  roots.push(root)
  return join(root, "memory")
}

function boundEntry(identity: string, repoPath: string): { type: string; customType: string; data: unknown } {
  return {
    type: "custom",
    customType: MEMORY_BINDING_CUSTOM_TYPE,
    data: createMemoryBinding({ identity, repoPath, boundAt: 1 }),
  }
}

describe("memory identity rebind", () => {
  test("#given a session bound to its own workspace #when a host whose process cwd resolves another identity rebinds it #then the session keeps its identity and nothing is notified", async () => {
    const sessionCwd = workspace()
    const hostCwd = workspace()
    const env = { OMO_MEMORY_HOME: memoryRoot() }
    const sessionIdentity = resolveMemoryIdentity(memorySettings().agent, sessionCwd, env)
    const hostIdentity = resolveMemoryIdentity(memorySettings().agent, hostCwd, env)
    expect(hostIdentity.id).not.toBe(sessionIdentity.id)
    const recorded = boundEntry(sessionIdentity.id, sessionIdentity.paths.repo)
    const pi = new MemoryFakeExtensionAPI()
    const notifications: Array<{ message: string; level: string }> = []
    const before = memoryModuleSupervisor.refCount
    createMemoryComponent({
      env,
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      now: () => 456,
      resolveCwd: () => hostCwd,
      createRuntime: () => {
        throw new Error("bind-only test does not create an identity runtime")
      },
    }).register(pi, componentContext())

    await pi.dispatch("before_agent_start", {}, sessionContext({ entries: [recorded], notifications, cwd: sessionCwd }))

    expect(notifications).toEqual([])
    expect(pi.entries).toEqual([{
      customType: MEMORY_BINDING_CUSTOM_TYPE,
      data: { identity: sessionIdentity.id, repoPathHash: (recorded.data as { repoPathHash: string }).repoPathHash, boundAt: 456 },
    }])
    expect(memoryModuleSupervisor.refCount).toBe(before + 1)
    memoryModuleSupervisor.release()
  })

  test("#given a host that reports no session cwd #when the recorded binding disagrees with the auto-resolved identity #then the recorded identity is adopted and the rebind is logged at info", async () => {
    const boundCwd = workspace()
    const hostCwd = workspace()
    const env = { OMO_MEMORY_HOME: memoryRoot() }
    const boundIdentity = resolveMemoryIdentity(memorySettings().agent, boundCwd, env)
    const recorded = boundEntry(boundIdentity.id, boundIdentity.paths.repo)
    const pi = new MemoryFakeExtensionAPI()
    const ctx = componentContext()
    const notifications: Array<{ message: string; level: string }> = []
    const before = memoryModuleSupervisor.refCount
    createMemoryComponent({
      env,
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      now: () => 456,
      resolveCwd: () => hostCwd,
      createRuntime: () => {
        throw new Error("bind-only test does not create an identity runtime")
      },
    }).register(pi, ctx)

    await pi.dispatch("before_agent_start", {}, sessionContext({ entries: [recorded], notifications }))

    expect(notifications).toEqual([])
    expect(pi.entries).toEqual([{
      customType: MEMORY_BINDING_CUSTOM_TYPE,
      data: { identity: boundIdentity.id, repoPathHash: (recorded.data as { repoPathHash: string }).repoPathHash, boundAt: 456 },
    }])
    expect(ctx.logs.filter((entry) => entry.level === "info" && entry.message.includes("rebound"))).toHaveLength(1)
    expect(memoryModuleSupervisor.refCount).toBe(before + 1)
    memoryModuleSupervisor.release()
  })

  test("#given an explicitly configured agent that disagrees with the recorded binding #when the session is rebound #then it still fails closed with the conflict notice", async () => {
    const sessionCwd = workspace()
    const env = { OMO_MEMORY_HOME: memoryRoot() }
    const pi = new MemoryFakeExtensionAPI()
    const ctx = componentContext()
    const notifications: Array<{ message: string; level: string }> = []
    const before = memoryModuleSupervisor.refCount
    createMemoryComponent({
      env,
      loadConfig: () => loadedMemoryConfig(memorySettings({ agent: "fresh" })),
      resolveCwd: () => sessionCwd,
    }).register(pi, ctx)

    await pi.dispatch("before_agent_start", {}, sessionContext({
      entries: [{ type: "custom", customType: MEMORY_BINDING_CUSTOM_TYPE, data: { identity: "different-identity", repoPathHash: "hash", boundAt: 1 } }],
      notifications,
      cwd: sessionCwd,
    }))

    expect(pi.entries).toEqual([])
    expect(memoryModuleSupervisor.refCount).toBe(before)
    expect(notifications).toEqual([{ message: expect.stringContaining("memory identity conflict"), level: "error" }])
    expect(ctx.logs.filter((entry) => entry.level === "warn" && entry.message.includes("failed closed"))).toHaveLength(1)
  })
})
