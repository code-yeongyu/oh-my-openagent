// Characterization (plan pin X8c): today's memory binding at session_start. These cases pin what
// the memory component records and acquires when a session binds, and how a recorded binding,
// the session's own cwd and a repeated session_start shape that bind. They pin the behaviour as it
// is; they do not propose changes.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveMemoryIdentity } from "@oh-my-opencode/memory-core"
import { createMemoryBinding } from "./binding"
import { MEMORY_BINDING_CUSTOM_TYPE, createMemoryComponent, memoryModuleSupervisor } from "./index"
import {
  componentContext,
  loadedMemoryConfig,
  memorySettings,
  MemoryFakeExtensionAPI,
  sessionContext,
  type SessionEntryFixture,
} from "./memory.test-support"
import type { SyncRunner } from "./sync-runner"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

const roots: string[] = []
const started: Array<{ readonly pi: MemoryFakeExtensionAPI; readonly ctx: ReturnType<typeof componentContext> }> = []
// session_start leaves work running past its dispatch: afterBind is not awaited (session-binding.ts) and its
// bind-time facts reconcile is detached (facts-wiring.ts fire("reconcile")). That work recreates
// <OMO_MEMORY_HOME>/agents/<id>/runtime/locks after a removal (#9766). session_shutdown is the component's own
// settle signal for it: the drain awaits the detached reconcile (FactsExtractorRunner.cancelActive) and the
// status and maintenance settles, each raced against the drain budget, and releases the supervisor reference
// the bind took. index.test.ts and wiring.test.ts close their sessions the same way. A step that outlived the
// budget keeps running detached, so it fails the test instead of passing on timing.
afterEach(async () => {
  const overBudget: unknown[] = []
  for (const { pi, ctx } of started.splice(0)) {
    await pi.dispatch("session_shutdown", {}, sessionContext())
    overBudget.push(...ctx.logs.filter((entry) => entry.message === "memory shutdown drain hit its budget"))
  }
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  expect(overBudget).toEqual([])
})

function tempDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

type SyncCall =
  | { readonly kind: "acquire"; readonly identity: string; readonly repo: string; readonly profile: unknown; readonly projectDir: unknown }
  | { readonly kind: "release"; readonly repo: string }

function recordingSyncRunner(calls: SyncCall[]): SyncRunner {
  return {
    acquire: async (identity, paths, _settings, options) => {
      calls.push({ kind: "acquire", identity, repo: paths.repo, profile: options?.profile, projectDir: options?.projectDir })
    },
    release: async (repo) => {
      calls.push({ kind: "release", repo })
    },
    status: async () => null,
    deviceName: () => undefined,
  }
}

function boundEntry(identity: string, repoPath: string, boundAt = 1): SessionEntryFixture {
  return { type: "custom", customType: MEMORY_BINDING_CUSTOM_TYPE, data: createMemoryBinding({ identity, repoPath, boundAt }) }
}

function harness(options: { readonly agent?: string; readonly now?: number } = {}) {
  const hostCwd = join(tempDir("omo-x8c-host-"), "host")
  const env = { OMO_MEMORY_HOME: join(tempDir("omo-x8c-home-"), "memory") }
  const pi = new MemoryFakeExtensionAPI()
  const ctx = componentContext()
  const syncCalls: SyncCall[] = []
  const settings = memorySettings(options.agent === undefined ? {} : { agent: options.agent })
  createMemoryComponent({
    env,
    loadConfig: () => loadedMemoryConfig(settings),
    now: () => options.now ?? 1000,
    resolveCwd: () => hostCwd,
    syncRunner: recordingSyncRunner(syncCalls),
    createRuntime: () => {
      throw new Error("bind-only characterization does not create an identity runtime")
    },
  }).register(pi, ctx)
  started.push({ pi, ctx })
  const identityFor = (cwd: string) => resolveMemoryIdentity(settings.agent, cwd, env)
  const workspace = (): string => join(tempDir("omo-x8c-ws-"), "project")
  return { pi, ctx, hostCwd, syncCalls, identityFor, workspace }
}

function supervisorDelta(before: number): number {
  return memoryModuleSupervisor.refCount - before
}

describe("X8c memory binding at session_start (characterization)", () => {
  test("#given a fresh session in its own workspace #when session_start fires #then one startup-bookkeeping binding entry for the session cwd's identity is appended and memory and sync are acquired", async () => {
    // given
    const h = harness({ now: 1234 })
    const sessionCwd = h.workspace()
    const identity = h.identityFor(sessionCwd)
    expect(identity.id).not.toBe(h.identityFor(h.hostCwd).id)
    const notifications: Array<{ message: string; level: string }> = []
    const before = memoryModuleSupervisor.refCount

    // when
    await h.pi.dispatch("session_start", {}, sessionContext({ notifications, cwd: sessionCwd }))

    // then
    expect(h.pi.entries).toEqual([{
      customType: MEMORY_BINDING_CUSTOM_TYPE,
      data: createMemoryBinding({ identity: identity.id, repoPath: identity.paths.repo, boundAt: 1234 }),
      options: { startupBookkeeping: true },
    }])
    expect(h.syncCalls).toEqual([{ kind: "acquire", identity: identity.id, repo: identity.paths.repo, profile: "auto", projectDir: sessionCwd }])
    expect(supervisorDelta(before)).toBe(1)
    expect(notifications).toEqual([])
  })

  test("#given a host that reports no session cwd #when session_start fires #then the binding falls back to the host process cwd's identity", async () => {
    // given
    const h = harness({ now: 1235 })
    const hostIdentity = h.identityFor(h.hostCwd)
    const before = memoryModuleSupervisor.refCount

    // when
    await h.pi.dispatch("session_start", {}, sessionContext())

    // then
    expect(h.pi.entries).toEqual([{
      customType: MEMORY_BINDING_CUSTOM_TYPE,
      data: createMemoryBinding({ identity: hostIdentity.id, repoPath: hostIdentity.paths.repo, boundAt: 1235 }),
      options: { startupBookkeeping: true },
    }])
    expect(h.syncCalls).toEqual([{ kind: "acquire", identity: hostIdentity.id, repo: hostIdentity.paths.repo, profile: "auto", projectDir: h.hostCwd }])
    expect(supervisorDelta(before)).toBe(1)
  })

  test("#given a session whose transcript recorded another auto identity #when session_start fires #then the recorded identity is re-bound, logged at info, and a new entry with the recorded hash and the new time is appended", async () => {
    // given
    const h = harness({ now: 1236 })
    const boundCwd = h.workspace()
    const sessionCwd = h.workspace()
    const recorded = h.identityFor(boundCwd)
    expect(recorded.id).not.toBe(h.identityFor(sessionCwd).id)
    const notifications: Array<{ message: string; level: string }> = []
    const before = memoryModuleSupervisor.refCount

    // when
    await h.pi.dispatch("session_start", {}, sessionContext({ entries: [boundEntry(recorded.id, recorded.paths.repo)], notifications, cwd: sessionCwd }))

    // then
    expect(h.pi.entries).toEqual([{
      customType: MEMORY_BINDING_CUSTOM_TYPE,
      data: createMemoryBinding({ identity: recorded.id, repoPath: recorded.paths.repo, boundAt: 1236 }),
      options: { startupBookkeeping: true },
    }])
    expect(h.ctx.logs.filter((entry) => entry.level === "info" && entry.message.includes("rebound"))).toHaveLength(1)
    expect(h.syncCalls).toEqual([{ kind: "acquire", identity: recorded.id, repo: recorded.paths.repo, profile: "auto", projectDir: sessionCwd }])
    expect(supervisorDelta(before)).toBe(1)
    expect(notifications).toEqual([])
  })

  test("#given several recorded bindings #when session_start fires #then the latest well-formed one is the one adopted", async () => {
    // given
    const h = harness({ now: 1237 })
    const older = h.identityFor(h.workspace())
    const latest = h.identityFor(h.workspace())
    const sessionCwd = h.workspace()
    const entries: SessionEntryFixture[] = [
      boundEntry(older.id, older.paths.repo, 1),
      boundEntry(latest.id, latest.paths.repo, 2),
      { type: "custom", customType: MEMORY_BINDING_CUSTOM_TYPE, data: { identity: older.id } },
      { type: "message", customType: MEMORY_BINDING_CUSTOM_TYPE, data: createMemoryBinding({ identity: older.id, repoPath: older.paths.repo, boundAt: 3 }) },
    ]
    const before = memoryModuleSupervisor.refCount

    // when
    await h.pi.dispatch("session_start", {}, sessionContext({ entries, cwd: sessionCwd }))

    // then
    expect(h.pi.entries).toEqual([{
      customType: MEMORY_BINDING_CUSTOM_TYPE,
      data: createMemoryBinding({ identity: latest.id, repoPath: latest.paths.repo, boundAt: 1237 }),
      options: { startupBookkeeping: true },
    }])
    expect(supervisorDelta(before)).toBe(1)
  })

  test("#given a recorded binding with the resolved identity but a different repository hash #when session_start fires #then it binds without verifying the repository", async () => {
    // given
    const h = harness({ now: 1238 })
    const sessionCwd = h.workspace()
    const identity = h.identityFor(sessionCwd)
    const notifications: Array<{ message: string; level: string }> = []
    const before = memoryModuleSupervisor.refCount

    // when
    await h.pi.dispatch("session_start", {}, sessionContext({ entries: [boundEntry(identity.id, "/elsewhere/repo")], notifications, cwd: sessionCwd }))

    // then
    expect(h.pi.entries).toEqual([{
      customType: MEMORY_BINDING_CUSTOM_TYPE,
      data: createMemoryBinding({ identity: identity.id, repoPath: identity.paths.repo, boundAt: 1238 }),
      options: { startupBookkeeping: true },
    }])
    expect(notifications).toEqual([])
    expect(supervisorDelta(before)).toBe(1)
  })

  test("#given the same mismatched repository hash #when the session is bound by before_agent_start instead #then the repository is verified and the bind fails closed", async () => {
    // given
    const h = harness({ now: 1239 })
    const sessionCwd = h.workspace()
    const identity = h.identityFor(sessionCwd)
    const notifications: Array<{ message: string; level: string }> = []
    const before = memoryModuleSupervisor.refCount

    // when
    await h.pi.dispatch("before_agent_start", {}, sessionContext({ entries: [boundEntry(identity.id, "/elsewhere/repo")], notifications, cwd: sessionCwd }))

    // then
    expect(h.pi.entries).toEqual([])
    expect(h.syncCalls).toEqual([])
    expect(supervisorDelta(before)).toBe(0)
    expect(notifications).toEqual([{ message: expect.stringContaining("memory identity conflict"), level: "error" }])
  })

  test("#given an explicit agent that disagrees with the recorded binding #when session_start, before_agent_start and session_start fire #then nothing binds, and the conflict is notified on each session_start but not on the rebind in between", async () => {
    // given
    const h = harness({ agent: "explicit-agent" })
    const sessionCwd = h.workspace()
    const recorded = boundEntry("different-identity", "/elsewhere/repo")
    const notifications: Array<{ message: string; level: string }> = []
    const event = sessionContext({ entries: [recorded], notifications, cwd: sessionCwd })
    const before = memoryModuleSupervisor.refCount

    // when
    await h.pi.dispatch("session_start", {}, event)
    const afterFirstStart = notifications.length
    await h.pi.dispatch("before_agent_start", {}, event)
    const afterRebind = notifications.length
    await h.pi.dispatch("session_start", {}, event)

    // then
    expect([afterFirstStart, afterRebind, notifications.length]).toEqual([1, 1, 2])
    expect(notifications.every((notice) => notice.level === "error" && notice.message.includes("memory identity conflict"))).toBe(true)
    expect(h.ctx.logs.filter((entry) => entry.level === "warn" && entry.message.includes("failed closed"))).toHaveLength(2)
    expect(h.pi.entries).toEqual([])
    expect(h.syncCalls).toEqual([])
    expect(supervisorDelta(before)).toBe(0)
  })

  test("#given a bound session #when before_agent_start fires #then it is not bound again", async () => {
    // given
    const h = harness({ now: 1240 })
    const event = sessionContext({ cwd: h.workspace() })
    const before = memoryModuleSupervisor.refCount
    await h.pi.dispatch("session_start", {}, event)

    // when
    await h.pi.dispatch("before_agent_start", {}, event)

    // then
    expect(h.pi.entries).toHaveLength(1)
    expect(h.syncCalls.map((call) => call.kind)).toEqual(["acquire"])
    expect(supervisorDelta(before)).toBe(1)
  })

  test("#given a bound session #when session_start fires again for it #then the old binding is released first and a second entry is appended, so one reference is held", async () => {
    // given
    const h = harness()
    const sessionCwd = h.workspace()
    const identity = h.identityFor(sessionCwd)
    const event = sessionContext({ cwd: sessionCwd })
    const before = memoryModuleSupervisor.refCount
    await h.pi.dispatch("session_start", {}, event)
    const afterFirst = supervisorDelta(before)

    // when
    await h.pi.dispatch("session_start", {}, event)

    // then
    expect(afterFirst).toBe(1)
    expect(h.pi.entries.map((entry) => entry.customType)).toEqual([MEMORY_BINDING_CUSTOM_TYPE, MEMORY_BINDING_CUSTOM_TYPE])
    expect(h.pi.entries.every((entry) => entry.options?.startupBookkeeping === true)).toBe(true)
    expect(h.syncCalls.map((call) => call.kind)).toEqual(["acquire", "release", "acquire"])
    expect(h.syncCalls[1]).toEqual({ kind: "release", repo: identity.paths.repo })
    expect(supervisorDelta(before)).toBe(1)
  })

  test("#given a one-shot surface without UI #when session_start fires #then the binding entry is still appended but sync is not acquired", async () => {
    // given
    const h = harness({ now: 1241 })
    const sessionCwd = h.workspace()
    const identity = h.identityFor(sessionCwd)
    const before = memoryModuleSupervisor.refCount

    // when
    await h.pi.dispatch("session_start", {}, { ...sessionContext({ cwd: sessionCwd }), hasUI: false })

    // then
    expect(h.pi.entries).toEqual([{
      customType: MEMORY_BINDING_CUSTOM_TYPE,
      data: createMemoryBinding({ identity: identity.id, repoPath: identity.paths.repo, boundAt: 1241 }),
      options: { startupBookkeeping: true },
    }])
    expect(h.syncCalls).toEqual([])
    expect(supervisorDelta(before)).toBe(1)
  })
})
