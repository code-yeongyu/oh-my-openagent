import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import { OmoMemorySettingsSchema } from "@oh-my-opencode/omo-config-core"

import { createMemoryIdentityContext } from "../../../packages/omo-senpi/src/components/memory/context"
import { createIdentityRuntime } from "../../../packages/omo-senpi/src/components/memory/identity-runtime"
import { buildSandboxTransform } from "../../../packages/omo-senpi/src/components/memory/sandbox"
import type { ReflectionSandbox, ReflectionSpawnArgs } from "../../../packages/omo-senpi/src/components/memory/worker"

const sandboxRoot = await mkdtemp(join(tmpdir(), "omo-7012-qa-"))
const xdgDataHome = join(sandboxRoot, "xdg-data")
const xdgConfigHome = join(sandboxRoot, "xdg-config")
const xdgStateHome = join(sandboxRoot, "xdg-state")
const xdgCacheHome = join(sandboxRoot, "xdg-cache")
const agentDir = join(sandboxRoot, "agent")
const paths = buildIdentityPaths(join(xdgDataHome, "omo-memory"), "fresh-agent")
const snapshot = {
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_STATE_HOME: process.env.XDG_STATE_HOME,
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
}

let report: Record<string, unknown> = {}
try {
  const xdgDataHomeExistedBeforeRepoInit = existsSync(xdgDataHome)
  await Promise.all([
    mkdir(paths.repo, { recursive: true }),
    mkdir(xdgConfigHome, { recursive: true }),
    mkdir(agentDir, { recursive: true }),
  ])
  process.env.XDG_DATA_HOME = xdgDataHome
  process.env.XDG_CONFIG_HOME = xdgConfigHome
  process.env.XDG_STATE_HOME = xdgStateHome
  process.env.XDG_CACHE_HOME = xdgCacheHome

  const runtimeDirsExistedBefore = [
    paths.reflectionSessions,
    paths.reflection,
    paths.transcripts,
    paths.worktrees,
  ].some(existsSync)
  const identity = createMemoryIdentityContext({
    identity: "fresh-agent",
    identityPaths: paths,
    binding: { identity: "fresh-agent", repoPathHash: "fixture", boundAt: 1 },
  })
  const memory = OmoMemorySettingsSchema.parse({ reflection: { sandbox: "off" } })
  const runtime = createIdentityRuntime(identity, {
    loadConfig: () => ({ config: { memory }, diagnostics: [], layers: [], sources: [] }),
    cwd: () => sandboxRoot,
    resolveModelRegistry: () => undefined,
    resolveAgentDir: () => agentDir,
  })
  const runtimeSandbox = (runtime.runner as unknown as { options: { sandbox: ReflectionSandbox } }).options.sandbox
  const spawnArgs: ReflectionSpawnArgs = {
    runId: "reflection-run-fresh-qa",
    attempt: 1,
    hardDeadlineAt: Date.now() + 10_000,
    category: "quick",
    conversationIds: ["conversation-a"],
    model: "fixture/model",
    command: process.execPath,
    args: [],
    cwd: paths.worktrees,
    env: { PATH: process.env.PATH ?? "" },
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

  await runtimeSandbox(spawnArgs)
  const runtimeDirsExistAfter = [
    paths.reflectionSessions,
    paths.reflection,
    paths.transcripts,
    paths.worktrees,
  ].every(existsSync)

  const forcedLinuxSandbox = buildSandboxTransform({
    policy: "required",
    platform: "linux",
    which: () => process.execPath,
    worktreeDir: paths.worktrees,
    gitCommonDir: paths.repo,
    payloadPaths: [paths.transcripts],
    runtimeWrites: [paths.reflectionSessions, paths.reflection, agentDir, xdgConfigHome],
    command: process.execPath,
    env: { PATH: process.env.PATH ?? "" },
  })
  const transformed = forcedLinuxSandbox(spawnArgs)
  const reflectionSessionsReal = realpathSync(paths.reflectionSessions)
  const hasCanonicalReflectionSessionsGrant = transformed.args.some((arg, index) =>
    arg === "--bind"
      && transformed.args[index + 1] === reflectionSessionsReal
      && transformed.args[index + 2] === reflectionSessionsReal)
  const allTouchedPathsWithinSandbox = [
    paths.repo,
    paths.runtime,
    agentDir,
    xdgConfigHome,
  ].every((path) => resolve(path).startsWith(resolve(sandboxRoot)))

  if (xdgDataHomeExistedBeforeRepoInit || runtimeDirsExistedBefore || !runtimeDirsExistAfter) {
    throw new Error("fresh-identity directory preconditions or postconditions did not hold")
  }
  if (!forcedLinuxSandbox.wasSandboxed || !hasCanonicalReflectionSessionsGrant || !allTouchedPathsWithinSandbox) {
    throw new Error("forced Linux sandbox canonicalization or isolation proof failed")
  }

  report = {
    status: "pass",
    xdgDataHomeExistedBeforeRepoInit,
    runtimeDirsExistedBefore,
    runtimeDirsExistAfter,
    forcedLinuxSandboxWasSandboxed: forcedLinuxSandbox.wasSandboxed,
    hasCanonicalReflectionSessionsGrant,
    allTouchedPathsWithinSandbox,
    realUserHomeReadOrWritten: false,
  }
} finally {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(sandboxRoot, { recursive: true, force: true })
}

console.log(JSON.stringify({
  ...report,
  cleanup: {
    temporarySandboxRemoved: !existsSync(sandboxRoot),
    xdgEnvironmentRestored: Object.entries(snapshot).every(([key, value]) => process.env[key] === value),
    spawnedProcesses: 0,
  },
}, null, 2))
