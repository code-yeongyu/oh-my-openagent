import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryIdentityContext } from "./context"
import type { MemoryIdentityRuntime, MemoryIdentityRuntimeDeps } from "./identity-runtime"
import { withLaunchScope } from "./launch-facts"
import { loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { createMemoryRuntimeWiring } from "./wiring-runtime"

const STALE = "This extension ctx is stale after session replacement or reload."

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe("a launch whose ctx retired with no successor (#13070)", () => {
  test.each([
    ["outside any launch scope (a facts launch without a selection)", undefined],
    ["inside a run scope without a trigger snapshot (a shutdown dream)", ["session-13070"]],
  ])("#given the runtime was created while the ctx was live #when the ctx retires before a launch %s reads its model registry #then the launch still gets the process-wide registry", async (_label, conversationIds) => {
    // given
    const root = await mkdtemp(`${tmpdir()}/omo-13070-`)
    roots.push(root)
    const identity = createMemoryIdentityContext({
      identity: "agent-13070",
      identityPaths: buildIdentityPaths(root, "agent-13070"),
      binding: { identity: "agent-13070", repoPathHash: "hash", boundAt: 1 },
    })
    const registry = { find: () => undefined, getProviderAuth: () => undefined, getAvailable: () => [] }
    let retired = false
    const ctx = new Proxy({ modelRegistry: registry, sessionManager: { getSessionId: () => "session-13070" } }, {
      get(target, key) {
        if (retired) throw new Error(STALE)
        return Reflect.get(target, key)
      },
    })
    const lastEventCtx: { current?: unknown } = { current: ctx }
    let deps: MemoryIdentityRuntimeDeps | undefined
    const wiring = createMemoryRuntimeWiring({
      sessions: new Map(),
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      cwd: () => root,
      env: {},
      createRuntime: (_identity, runtimeDeps) => {
        deps = runtimeDeps
        return { identity } as unknown as MemoryIdentityRuntime
      },
    }, lastEventCtx)
    wiring.runtimeFor(identity)

    // when
    retired = true
    const resolve = () => deps?.resolveModelRegistry()
    const resolved = conversationIds === undefined ? resolve() : withLaunchScope({ conversationIds }, resolve)

    // then
    expect(resolved).toBe(registry)
  }, 30_000)
})
