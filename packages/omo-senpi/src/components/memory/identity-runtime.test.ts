import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryIdentityContext } from "./context"
import { createIdentityRuntime } from "./identity-runtime"
import { componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"
import type { ReflectionSandbox, ReflectionSpawnArgs } from "./worker"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe("memory identity runtime", () => {
  test.skipIf(process.platform !== "darwin" && process.platform !== "linux")(
    "#given an unresolved reflection child command #when the real lazy sandbox is constructed #then the unsandboxed escape reaches the injected logger",
    async () => {
      // given
      const root = await mkdtemp(join(tmpdir(), "omo-memory-identity-runtime-"))
      roots.push(root)
      const paths = buildIdentityPaths(root, "agent-test")
      await Promise.all([
        paths.repo,
        paths.transcripts,
        paths.reflection,
        paths.reflectionSessions,
        paths.worktrees,
      ].map((path) => mkdir(path, { recursive: true })))
      const binDir = join(root, "bin")
      await mkdir(binDir)
      const sandboxExecutable = join(binDir, process.platform === "darwin" ? "sandbox-exec" : "bwrap")
      await writeFile(sandboxExecutable, "#!/bin/sh\nexit 0\n")
      await chmod(sandboxExecutable, 0o755)
      const identity = createMemoryIdentityContext({
        identity: "agent-test",
        identityPaths: paths,
        binding: { identity: "agent-test", repoPathHash: "hash", boundAt: 1 },
      })
      const ctx = componentContext()
      const previousPath = process.env.PATH
      const previousAgentDir = process.env.SENPI_CODING_AGENT_DIR
      process.env.PATH = `${binDir}${process.platform === "win32" ? ";" : ":"}${previousPath ?? ""}`
      process.env.SENPI_CODING_AGENT_DIR = paths.runtime

      try {
        const runtime = createIdentityRuntime(identity, {
          loadConfig: () => loadedMemoryConfig(memorySettings()),
          cwd: () => root,
          resolveModelRegistry: () => undefined,
          logger: ctx.logger,
        })
        const sandbox = (runtime.runner as unknown as { options: { sandbox: ReflectionSandbox } }).options.sandbox
        const spawnArgs: ReflectionSpawnArgs = {
          runId: "reflection-run-visible",
          attempt: 1,
          hardDeadlineAt: Date.now() + 10_000,
          category: "quick",
          conversationIds: ["conversation-a"],
          model: "fixture/model",
          command: "missing-senpi",
          args: [],
          cwd: paths.worktrees,
          env: { PATH: "" },
          detached: true,
          paths: {
            sessionDir: paths.reflectionSessions,
            worktree: paths.worktrees,
            gitCommonDir: paths.repo,
            transcript: join(paths.transcripts, "transcript.json"),
            persona: join(paths.reflectionSessions, "persona.md"),
            prompt: join(paths.reflectionSessions, "prompt.md"),
          },
        }

        // when
        await sandbox(spawnArgs)

        // then
        expect(ctx.logs).toContainEqual({
          level: "warn",
          message: "memory reflection sandbox degraded",
          details: {
            identity: "agent-test",
            runId: "reflection-run-visible",
            warning: 'reflection sandbox unavailable: inner command "missing-senpi" is not absolute and could not be resolved; running unsandboxed',
          },
        })
      } finally {
        if (previousPath === undefined) delete process.env.PATH
        else process.env.PATH = previousPath
        if (previousAgentDir === undefined) delete process.env.SENPI_CODING_AGENT_DIR
        else process.env.SENPI_CODING_AGENT_DIR = previousAgentDir
      }
    },
    30_000,
  )
})
