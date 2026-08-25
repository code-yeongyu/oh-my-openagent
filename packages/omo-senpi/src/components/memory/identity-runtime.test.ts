import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { createMemoryIdentityContext } from "./context"
import { createIdentityRuntime } from "./identity-runtime"
import { componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"
import type { ReflectionSandbox, ReflectionSpawnArgs } from "./worker"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function waitForPath(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) return
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`timed out waiting for ${path}`)
}

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

async function renderReflectionSandboxAgentDir(envShape: {
  readonly omo?: string
  readonly senpi?: string
}): Promise<{ readonly fakeHome: string; readonly renderedArgs: readonly string[] }> {
  // given: an isolated identity root, a fake sandbox-exec/bwrap on PATH so the seatbelt profile or
  // bwrap args render, and a fake absolute inner command so the sandbox does not degrade.
  const root = await mkdtemp(join(tmpdir(), "omo-memory-agent-dir-"))
  roots.push(root)
  const paths = buildIdentityPaths(root, "agent-dir-test")
  await Promise.all(
    [paths.repo, paths.transcripts, paths.reflection, paths.reflectionSessions, paths.worktrees].map((path) =>
      mkdir(path, { recursive: true }),
    ),
  )
  const binDir = join(root, "bin")
  await mkdir(binDir)
  for (const name of [process.platform === "darwin" ? "sandbox-exec" : "bwrap", "senpi-fake"]) {
    const exe = join(binDir, name)
    await writeFile(exe, "#!/bin/sh\nexit 0\n")
    await chmod(exe, 0o755)
  }
  // Seeded fake home: agent-dir resolution stays HOST-INDEPENDENT (never reads the real $HOME or
  // its ambient ~/.omo/settings.json sentinel) and the seeded sentinel forces the flat `~/.omo`
  // branch for the no-env case. Only this temp tree is mkdir'd, so the suite never writes into a
  // contributor's or runner's real home.
  const fakeHome = join(root, "fake-home")
  await mkdir(join(fakeHome, ".omo"), { recursive: true })
  const sentinelPath = join(fakeHome, ".omo", "settings.json")
  const injectedEnv: Record<string, string | undefined> = {}
  if (envShape.omo !== undefined) injectedEnv.OMO_CODING_AGENT_DIR = envShape.omo
  if (envShape.senpi !== undefined) injectedEnv.SENPI_CODING_AGENT_DIR = envShape.senpi
  const snapshot = {
    PATH: process.env.PATH,
    OMO_CODING_AGENT_DIR: process.env.OMO_CODING_AGENT_DIR,
    SENPI_CODING_AGENT_DIR: process.env.SENPI_CODING_AGENT_DIR,
    PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  }
  process.env.PATH = `${binDir}${process.platform === "win32" ? ";" : ":"}${snapshot.PATH ?? ""}`
  delete process.env.OMO_CODING_AGENT_DIR
  delete process.env.SENPI_CODING_AGENT_DIR
  delete process.env.PI_CODING_AGENT_DIR
  delete process.env.XDG_CONFIG_HOME
  try {
    const identity = createMemoryIdentityContext({
      identity: "agent-dir-test",
      identityPaths: paths,
      binding: { identity: "agent-dir-test", repoPathHash: "hash", boundAt: 1 },
    })
    const runtime = createIdentityRuntime(identity, {
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      cwd: () => root,
      resolveModelRegistry: () => undefined,
      resolveAgentDir: () =>
        resolveAgentHome({ env: injectedEnv, homeDir: fakeHome, exists: (p) => p === sentinelPath }),
    })
    const sandbox = (runtime.runner as unknown as { options: { sandbox: ReflectionSandbox } }).options.sandbox
    const transformed = await sandbox({
      runId: "reflection-run-agent-dir",
      attempt: 1,
      hardDeadlineAt: Date.now() + 10_000,
      category: "quick",
      conversationIds: ["conversation-a"],
      model: "fixture/model",
      command: join(binDir, "senpi-fake"),
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
    })
    return { fakeHome, renderedArgs: transformed.args }
  } finally {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function sandboxGrantsAgentDir(renderedArgs: readonly string[], agentDirReal: string): boolean {
  if (process.platform === "darwin") {
    const profile = renderedArgs[1]
    return typeof profile === "string" && profile.includes(`(allow file-write* (subpath ${JSON.stringify(agentDirReal)}))`)
  }
  for (let i = 0; i + 2 < renderedArgs.length; i++) {
    if (renderedArgs[i] === "--bind" && renderedArgs[i + 1] === agentDirReal && renderedArgs[i + 2] === agentDirReal) {
      return true
    }
  }
  return false
}

describe("memory identity runtime first-write seam", () => {
  test("#given a fresh identity whose runtime directories were never created #when a reserved reflection run launches through the identity runtime #then the missing runtime/reflection-sessions is created before the runner settles the run", async () => {
    // given - no mkdir anywhere under the identity root. Every other suite pre-creates
    // these dirs, which is exactly what masked #7012: the lazy sandbox grants
    // runtime/reflection-sessions as writable, and on Linux bwrap cannot bind an entry
    // that does not exist yet, so the first reflection on a fresh identity died pre-spawn.
    const root = await mkdtemp(join(tmpdir(), "omo-memory-identity-runtime-first-write-"))
    roots.push(root)
    const paths = buildIdentityPaths(root, "agent-test")
    expect(existsSync(paths.reflectionSessions)).toBe(false)
    const identity = createMemoryIdentityContext({
      identity: "agent-test",
      identityPaths: paths,
      binding: { identity: "agent-test", repoPathHash: "hash", boundAt: 1 },
    })
    const ctx = componentContext()
    const runtime = createIdentityRuntime(identity, {
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      cwd: () => root,
      resolveModelRegistry: () => undefined,
      logger: ctx.logger,
    })
    const reserved = await runtime.store.tryReserve({
      trigger: "manual",
      conversationIds: ["conversation-a"],
      snapshots: [],
    })
    if (reserved.status !== "active") throw new Error("expected an active manual reservation")

    // when
    runtime.launch(reserved.run)

    // then: launch is fire-and-forget; assert side effects, not the return
    await waitForPath(paths.reflectionSessions, 5000)
    expect(existsSync(paths.reflectionSessions)).toBe(true)
  }, 30_000)
})

describe("memory identity runtime agent-dir resolution", () => {
  test.skipIf(process.platform !== "darwin" && process.platform !== "linux")(
    "#given a rendered reflection sandbox #when OMO_CODING_AGENT_DIR is set #then the agent-dir runtimeWrites grant equals the resolved agent dir",
    async () => {
      // given
      const omoAgentDir = await mkdtemp(join(tmpdir(), "omo-omo-agent-dir-"))
      roots.push(omoAgentDir)
      // when
      const { renderedArgs } = await renderReflectionSandboxAgentDir({ omo: omoAgentDir })
      // then: assert the LITERAL injected dir. The stale expression ignores
      // OMO_CODING_AGENT_DIR, so it can never grant this dir on any host.
      expect(sandboxGrantsAgentDir(renderedArgs, realpathSync(omoAgentDir))).toBe(true)
    },
    30_000,
  )

  test.skipIf(process.platform !== "darwin" && process.platform !== "linux")(
    "#given a rendered reflection sandbox #when only SENPI_CODING_AGENT_DIR is set #then the agent-dir runtimeWrites grant equals the resolved agent dir",
    async () => {
      // given
      const senpiAgentDir = await mkdtemp(join(tmpdir(), "omo-senpi-agent-dir-"))
      roots.push(senpiAgentDir)
      // when: SENPI_ is visible only to the injected resolver, not process.env, so the
      // stale expression's process.env.SENPI_CODING_AGENT_DIR read cannot mimic it.
      const { renderedArgs } = await renderReflectionSandboxAgentDir({ senpi: senpiAgentDir })
      // then
      expect(sandboxGrantsAgentDir(renderedArgs, realpathSync(senpiAgentDir))).toBe(true)
    },
    30_000,
  )

  test.skipIf(process.platform !== "darwin" && process.platform !== "linux")(
    "#given a rendered reflection sandbox #when no agent-dir env is set #then the agent-dir runtimeWrites grant equals the sentinel-gated branded home",
    async () => {
      // when: OMO_, SENPI_ and PI_ unset; the seeded sentinel forces the flat `~/.omo` branch.
      const { fakeHome, renderedArgs } = await renderReflectionSandboxAgentDir({})
      // then: assert the LITERAL join(fakeHome, ".omo"). The stale expression resolves
      // join(realHome, ".senpi", "agent"), which a fresh fakeHome can never equal on any host,
      // sentinel present or absent - so this discriminates on CI runners too, not just here.
      expect(sandboxGrantsAgentDir(renderedArgs, realpathSync(join(fakeHome, ".omo")))).toBe(true)
    },
    30_000,
  )
})
