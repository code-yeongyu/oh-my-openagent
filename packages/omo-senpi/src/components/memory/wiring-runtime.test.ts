import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryIdentityContext } from "./context"
import type { FactsExtractorRunnerOptions } from "./facts-runner"
import { componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { createMemoryRuntimeWiring } from "./wiring-runtime"
import type { FactsSpawnArgs } from "./worker"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe("memory runtime wiring", () => {
  test("#given production facts wiring #when its extractor is created #then a sandbox transform is supplied", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-memory-runtime-wiring-"))
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
        return {
          launchPending: async () => ({ status: "empty" }),
          reconcilePending: async () => ({ status: "empty" }),
        }
      },
    }, {})

    // when
    runtime.factsWiringFor(identity)

    // then
    expect(captured?.sandbox).toBeFunction()
  }, 30_000)

  test.skipIf(process.platform !== "darwin" && process.platform !== "linux")(
    "#given an unresolved facts child command #when production facts wiring applies its sandbox #then the escape reaches the injected logger",
    async () => {
      // given
      const root = await mkdtemp(join(tmpdir(), "omo-memory-runtime-wiring-"))
      roots.push(root)
      const identity = createMemoryIdentityContext({
        identity: "agent-test",
        identityPaths: buildIdentityPaths(root, "agent-test"),
        binding: { identity: "agent-test", repoPathHash: "hash", boundAt: 1 },
      })
      const runDir = join(root, "facts-run")
      await mkdir(runDir)
      const payload = join(runDir, "facts-payload.json")
      await writeFile(payload, "{}")
      const binDir = join(root, "bin")
      await mkdir(binDir)
      const sandboxExecutable = join(binDir, process.platform === "darwin" ? "sandbox-exec" : "bwrap")
      await writeFile(sandboxExecutable, "#!/bin/sh\nexit 0\n")
      await chmod(sandboxExecutable, 0o755)
      const ctx = componentContext()
      const previousPath = process.env.PATH
      process.env.PATH = `${binDir}${delimiter}${previousPath ?? ""}`
      let captured: FactsExtractorRunnerOptions | undefined
      try {
        const runtime = createMemoryRuntimeWiring({
          sessions: new Map(),
          loadConfig: () => loadedMemoryConfig(memorySettings()),
          cwd: () => root,
          env: {},
          logger: ctx.logger,
          createFactsExtractor: (options) => {
            captured = options
            return {
              launchPending: async () => ({ status: "empty" }),
              reconcilePending: async () => ({ status: "empty" }),
            }
          },
        }, {})
        runtime.factsWiringFor(identity)
        const spawnArgs: FactsSpawnArgs = {
          runId: "facts-run-visible",
          attempt: 1,
          hardDeadlineAt: Date.now() + 10_000,
          model: "fixture/model",
          command: "missing-senpi",
          args: [],
          cwd: runDir,
          // Seed the agent dir so the facts lock-path grant resolves against a parent that
          // exists on every host: with an empty env the resolver falls back to host probing,
          // and CI runners have neither ~/.omo/agent/settings.json nor ~/.senpi/agent, so the
          // sandbox would degrade on the missing lock parent instead of reaching the
          // unresolvable-inner-command escape this test pins.
          env: { PATH: "", OMO_CODING_AGENT_DIR: root },
          detached: true,
          paths: { runDir, payload, extraction: join(runDir, "extraction.jsonl") },
        }

        // when
        await captured?.sandbox?.(spawnArgs)

        // then: the expected warning differs by platform - on darwin the profile
        // builds but the inner command can't be resolved; on linux the lock-path
        // grant cannot be expressed (bwrap limitation) so it degrades earlier.
        const isDarwin = process.platform === "darwin"
        expect(ctx.logs).toContainEqual({
          level: "warn",
          message: "memory facts sandbox degraded",
          details: {
            identity: "agent-test",
            runId: "facts-run-visible",
            warning: isDarwin
              ? 'facts sandbox unavailable: inner command "missing-senpi" is not absolute and could not be resolved; running unsandboxed'
              : expect.stringContaining("facts sandbox unavailable on linux"),
          },
        })
      } finally {
        if (previousPath === undefined) delete process.env.PATH
        else process.env.PATH = previousPath
      }
    },
    30_000,
  )
})
