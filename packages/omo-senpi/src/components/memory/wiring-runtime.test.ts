import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryIdentityContext } from "./context"
import type { FactsExtractorRunnerOptions } from "./facts-runner"
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
