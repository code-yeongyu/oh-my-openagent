import { existsSync, mkdirSync } from "@oh-my-opencode/memory-core/fs"
import { dirname, join } from "node:path"

import type { FactsSpawnArgs, MemorianSpawnArgs, ReflectionSpawnArgs } from "./worker/spawn"

/** Every child spawn shape the path sandbox can wrap; it only rewrites command/args/env. */
type SandboxableSpawnArgs = ReflectionSpawnArgs | FactsSpawnArgs | MemorianSpawnArgs

/** Surfaces the sandbox names in its warnings; one per memory child kind. */
type SandboxSurface = "reflection" | "facts" | "memorian"
import { canonicalAbsentPath, canonicalPath, defaultWhich, resolveInnerCommand } from "./sandbox-paths"
import { probeBwrapUsability, type SandboxUsability } from "./sandbox-bwrap-probe"
import { SandboxUnavailableError, type SandboxPolicy } from "./sandbox-contracts"

export { classifyBwrapSmoke, probeBwrapUsability, type SandboxUsability } from "./sandbox-bwrap-probe"

export interface PathSandboxInput {
  readonly surface: SandboxSurface
  readonly policy: SandboxPolicy
  readonly writableDirs: readonly string[]
  /**
   * Entries that do not exist yet and must stay writable as BOTH a file and a directory:
   * proper-lockfile mkdirs the lock directory and then writes inside it. They are never
   * realpath-canonicalized (realpathSync throws ENOENT on an absent path); their parent is.
   */
  readonly lockPaths?: readonly string[]
  readonly payloadPaths: readonly string[]
  readonly fallbackDir: string
  readonly foreignRoots?: readonly string[]
  readonly command: string
  readonly env: NodeJS.ProcessEnv
  readonly errorRethrow?: (error: SandboxUnavailableError) => never
  readonly platform?: NodeJS.Platform
  readonly which?: (command: string) => string | undefined
  /**
   * Verifies the resolved Linux executable can actually start a sandbox. Defaults to the real
   * bwrap smoke probe, which only spawns when the resolved path exists on this machine, so tests
   * that inject a fake `which` keep their existence-only semantics and never spawn bwrap.
   */
  readonly probe?: (executable: string) => SandboxUsability
}

export interface GenericSandboxTransform<T> {
  (spawnArgs: T): T
  readonly wasSandboxed: boolean
  readonly warning?: string
}

export function buildPathSandboxTransform<T extends SandboxableSpawnArgs>(
  input: PathSandboxInput,
): GenericSandboxTransform<T> {
  if (input.policy === "off") return identityTransform()

  const platform = input.platform ?? process.platform
  const executable = resolveExecutable(platform, input.which ?? defaultWhich)
  if (executable === undefined) {
    const reason = platform === "darwin" ? "sandbox-exec not found"
      : platform === "linux" ? "bwrap not found"
        : "platform is unsupported"
    if (input.policy === "required") {
      const error = new SandboxUnavailableError(platform, reason)
      if (input.errorRethrow !== undefined) input.errorRethrow(error)
      throw error
    }
    return identityTransform(`${input.surface} sandbox unavailable on ${platform}: ${reason}; running unsandboxed because policy is auto`)
  }

  if (platform === "linux") {
    const usability = (input.probe ?? defaultProbe)(executable)
    if (!usability.usable) {
      const reason = `bwrap cannot create a sandbox: ${usability.reason}`
      if (input.policy === "required") {
        const error = new SandboxUnavailableError(platform, reason)
        if (input.errorRethrow !== undefined) input.errorRethrow(error)
        throw error
      }
      return identityTransform(`${input.surface} sandbox unavailable on ${platform}: ${reason}; running unsandboxed because policy is auto`)
    }
  }

  const lockPaths = input.lockPaths ?? []
  if (platform !== "darwin" && lockPaths.length > 0) {
    const reason = `${platform} sandbox cannot grant the agent lockfile paths (${lockPaths.join(", ")}); bwrap has no minimal grant for entries that do not exist yet`
    if (input.policy === "required") {
      const error = new SandboxUnavailableError(platform, reason)
      if (input.errorRethrow !== undefined) input.errorRethrow(error)
      throw error
    }
    return identityTransform(`${input.surface} sandbox unavailable on ${platform}: ${reason}; running unsandboxed because policy is auto`)
  }

  const writableDirs = input.writableDirs.map(canonicalPath)
  if (platform === "darwin") {
    const payloads = input.payloadPaths.map(canonicalPath)
    const foreignRoots = (input.foreignRoots ?? []).map(canonicalPath)
    const lockPathsResolution = resolveLockPaths({
      lockPaths,
      surface: input.surface,
      policy: input.policy,
      platform,
      errorRethrow: input.errorRethrow,
    })
    if ("warning" in lockPathsResolution) return identityTransform(lockPathsResolution.warning)
    const tempDir = join(dirname(payloads[0] ?? canonicalPath(input.fallbackDir)), ".sandbox-tmp")
    mkdirSync(tempDir, { recursive: true, mode: 0o700 })
    const profile = buildDarwinProfile({
      writableDirs,
      lockPaths: lockPathsResolution.paths,
      tempDir,
      payloads,
      foreignRoots,
    })
    return guardedSandboxedTransform(input.surface, input.command, input.env, (spawnArgs, innerCommand) => ({
      ...spawnArgs,
      command: executable,
      args: ["-p", profile, "--", innerCommand, ...spawnArgs.args],
      env: { ...spawnArgs.env, TMPDIR: tempDir },
    }))
  }

  return guardedSandboxedTransform(input.surface, input.command, input.env, (spawnArgs, innerCommand) => ({
    ...spawnArgs,
    command: executable,
    args: [
      "--ro-bind", "/", "/",
      "--dev-bind", "/dev", "/dev",
      "--tmpfs", "/tmp",
      ...writableDirs.flatMap((writableDir) => ["--bind", writableDir, writableDir]),
      "--chdir", spawnArgs.cwd,
      "--", innerCommand, ...spawnArgs.args,
    ],
  }))
}

function buildDarwinProfile(input: {
  readonly writableDirs: readonly string[]
  readonly lockPaths: readonly string[]
  readonly tempDir: string
  readonly payloads: readonly string[]
  readonly foreignRoots: readonly string[]
}): string {
  const writable = [...input.writableDirs, input.tempDir]
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    ...writable.map((path) => `(allow file-write* (subpath ${seatbeltString(path)}))`),
    ...input.lockPaths.map((path) =>
      `(allow file-write* (literal ${seatbeltString(path)}) (subpath ${seatbeltString(path)}))`),
    '(allow file-write* (literal "/dev/null"))',
    '(allow file-write* (literal "/dev/tty"))',
    ...input.payloads.map((path) => `(allow file-read* (literal ${seatbeltString(path)}))`),
    ...input.foreignRoots.map((path) => `(deny file-read* (subpath ${seatbeltString(path)}))`),
  ].join("\n")
}

function resolveExecutable(
  platform: NodeJS.Platform,
  which: (command: string) => string | undefined,
): string | undefined {
  if (platform === "darwin") return which("sandbox-exec")
  if (platform === "linux") return which("bwrap")
  return undefined
}

/**
 * Probes only executables that exist on this machine: a resolved path that is absent here comes
 * from an injected `which` seam, and spawning it would prove nothing while breaking hermeticity.
 */
function defaultProbe(executable: string): SandboxUsability {
  if (!existsSync(executable)) return { usable: true }
  return probeBwrapUsability(executable)
}

type LockPathsResolution =
  | { readonly paths: readonly string[] }
  | { readonly warning: string }

/**
 * Canonicalizes lock paths whose parent exists and fails closed on the rest: a lock path inside a
 * parent that does not exist yet (fresh machine, no agent dir) can never be exercised by the child,
 * so rendering it would either throw a raw ENOENT or grant a path nobody can create.
 */
function resolveLockPaths(input: {
  readonly lockPaths: readonly string[]
  readonly surface: SandboxSurface
  readonly policy: SandboxPolicy
  readonly platform: NodeJS.Platform
  readonly errorRethrow?: (error: SandboxUnavailableError) => never
}): LockPathsResolution {
  const paths: string[] = []
  const absentParents: string[] = []
  for (const lockPath of input.lockPaths) {
    const parent = dirname(lockPath)
    if (existsSync(parent)) paths.push(canonicalAbsentPath(lockPath))
    else if (!absentParents.includes(parent)) absentParents.push(parent)
  }
  if (absentParents.length === 0) return { paths }
  const reason = `lock parent directories do not exist (${absentParents.join(", ")})`
  if (input.policy === "required") {
    const error = new SandboxUnavailableError(input.platform, reason)
    if (input.errorRethrow !== undefined) input.errorRethrow(error)
    throw error
  }
  return {
    warning: `${input.surface} sandbox unavailable on ${input.platform}: ${reason}; running unsandboxed because policy is auto`,
  }
}

function seatbeltString(path: string): string {
  return JSON.stringify(path)
}

function identityTransform<T>(warning?: string): GenericSandboxTransform<T> {
  return Object.assign((spawnArgs: T) => spawnArgs, {
    wasSandboxed: false,
    ...(warning === undefined ? {} : { warning }),
  })
}

function guardedSandboxedTransform<T extends SandboxableSpawnArgs>(
  surface: SandboxSurface,
  command: string,
  env: NodeJS.ProcessEnv,
  transform: (spawnArgs: T, innerCommand: string) => T,
): GenericSandboxTransform<T> {
  const innerCommand = resolveInnerCommand(command, env)
  if (innerCommand === undefined) {
    return identityTransform(`${surface} sandbox unavailable: inner command "${command}" is not absolute and could not be resolved; running unsandboxed`)
  }
  return Object.assign((spawnArgs: T) => transform(spawnArgs, innerCommand), { wasSandboxed: true })
}
