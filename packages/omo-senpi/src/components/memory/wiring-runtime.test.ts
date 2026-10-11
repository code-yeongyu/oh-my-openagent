import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { createMemoryIdentityContext } from "./context"
import type { FactsExtractorRunnerOptions } from "./facts-runner"
import type { MemoryIdentityRuntime, MemoryIdentityRuntimeDeps } from "./identity-runtime"
import { loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { createMemoryRuntimeWiring } from "./wiring-runtime"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe("memory runtime facts wiring", () => {
  test("#given production facts wiring #when its extractor is constructed #then it uses the in-process seam without spawn options", async () => {
    // given
    const root = await mkdtemp(`${tmpdir()}/omo-memory-runtime-wiring-`)
    roots.push(root)
    const identity = createMemoryIdentityContext({
      identity: "agent-test",
      identityPaths: buildIdentityPaths(root, "agent-test"),
      binding: { identity: "agent-test", repoPathHash: "hash", boundAt: 1 },
    })
    let captured: FactsExtractorRunnerOptions | undefined
    const runtime = createMemoryRuntimeWiring({
      sessions: new Map(),
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      cwd: () => root,
      env: {},
      createFactsExtractor: (options) => {
        captured = options
        return { launchPending: async () => ({ status: "empty" }), reconcilePending: async () => ({ status: "empty" }) }
      },
    }, {})

    // when
    runtime.factsWiringFor(identity)

    // then
    expect(captured).toBeDefined()
    expect(captured).not.toHaveProperty("senpiCommand")
    expect(captured).not.toHaveProperty("senpiPrefixArgs")
    expect(captured).not.toHaveProperty("resolveAndPreflightLaunch")
  }, 30_000)
})

describe("memory runtime agent-dir resolution", () => {
  test("#given an event context carrying the session agent dir #when a reflection runtime is created #then the runtime resolves that directory", async () => {
    // given: the engine already resolved an agent dir for this session (brand env prefix, the
    // nearest project config dir, or its home default). The adapter's own detection cannot
    // reproduce that walk, so a re-derived directory is what leaves the child locking
    // credentials outside the sandbox grant.
    const { root, identity } = await seedIdentity("agent-dir-ctx")
    const engineAgentDir = await mkdtemp(`${tmpdir()}/omo-engine-agent-dir-`)
    roots.push(engineAgentDir)
    let captured: MemoryIdentityRuntimeDeps | undefined

    // when
    createMemoryRuntimeWiring({
      sessions: new Map(),
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      cwd: () => root,
      env: {},
      createRuntime: (_identity, deps) => {
        captured = deps
        return stubRuntime()
      },
    }, { current: { agentDir: engineAgentDir } }).runtimeFor(identity)

    // then
    expect(captured?.resolveAgentDir?.()).toBe(engineAgentDir)
  }, 30_000)

  test("#given an event context whose agent dir is unusable #when a reflection runtime is created #then it falls back to the detected agent home", async () => {
    // given: a host that predates the context field, or one reporting a blank value.
    const { root, identity } = await seedIdentity("agent-dir-fallback")
    let captured: MemoryIdentityRuntimeDeps | undefined

    // when
    createMemoryRuntimeWiring({
      sessions: new Map(),
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      cwd: () => root,
      env: {},
      createRuntime: (_identity, deps) => {
        captured = deps
        return stubRuntime()
      },
    }, { current: { agentDir: "   " } }).runtimeFor(identity)

    // then
    expect(captured?.resolveAgentDir?.()).toBe(resolveAgentHome({ env: process.env }))
  }, 30_000)

  test("#given a disposed event context #when the reflection sandbox resolves its agent dir #then the stale-context throw does not reach the launch path", async () => {
    // given: the host's `agentDir` is a live getter guarded by `assertActive()`, and the sandbox is
    // built lazily at launch - long after the handler that produced the context returned.
    const { root, identity } = await seedIdentity("agent-dir-stale-ctx")
    let captured: MemoryIdentityRuntimeDeps | undefined
    const disposedContext = {
      get agentDir(): string {
        throw new Error("Extension context is no longer active")
      },
    }

    // when
    createMemoryRuntimeWiring({
      sessions: new Map(),
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      cwd: () => root,
      env: {},
      createRuntime: (_identity, deps) => {
        captured = deps
        return stubRuntime()
      },
    }, { current: disposedContext }).runtimeFor(identity)

    // then
    expect(captured?.resolveAgentDir?.()).toBe(resolveAgentHome({ env: process.env }))
  }, 30_000)
})

async function seedIdentity(name: string): Promise<{ readonly root: string; readonly identity: ReturnType<typeof createMemoryIdentityContext> }> {
  const root = await mkdtemp(`${tmpdir()}/omo-memory-runtime-wiring-`)
  roots.push(root)
  return {
    root,
    identity: createMemoryIdentityContext({
      identity: name,
      identityPaths: buildIdentityPaths(root, name),
      binding: { identity: name, repoPathHash: "hash", boundAt: 1 },
    }),
  }
}

function stubRuntime(): MemoryIdentityRuntime {
  return {
    launch: () => {},
    reconcile: async () => {},
  } as unknown as MemoryIdentityRuntime
}
