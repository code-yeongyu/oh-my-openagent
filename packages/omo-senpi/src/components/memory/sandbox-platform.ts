import { accessSync, constants, existsSync, mkdirSync, realpathSync } from "node:fs"
import { basename, delimiter, dirname, isAbsolute, join } from "node:path"

import type { FactsSpawnArgs, ReflectionSpawnArgs } from "./worker/spawn"
import { SandboxUnavailableError, type SandboxPolicy } from "./sandbox-contracts"

export interface PathSandboxInput {
  readonly surface: "reflection" | "facts"
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
}

export interface GenericSandboxTransform<T> {
  (spawnArgs: T): T
  readonly wasSandboxed: boolean
  readonly warning?: string
}

export function buildPathSandboxTransform<T extends ReflectionSpawnArgs | FactsSpawnArgs>(
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

function defaultWhich(command: string): string | undefined {
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    if (entry === "") continue
    const candidate = join(entry, command)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Not executable on this PATH entry; keep scanning.
    }
  }
  if (command === "sandbox-exec" && existsSync("/usr/bin/sandbox-exec")) return "/usr/bin/sandbox-exec"
  return undefined
}

/**
 * Canonicalizes as much of the path as exists and re-joins the remaining segments.
 *
 * The sandbox is built BEFORE the reflection child runs, and several granted entries
 * (runtime/reflection, runtime/reflection-sessions, the resolved agent dir, XDG_CONFIG_HOME)
 * legitimately do not exist yet on a fresh machine or a first reflection. A bare realpathSync
 * throws `ENOENT ... lstat '<first missing ancestor>'` there, which surfaced as a pre-spawn
 * `spawn_failed` and stalled the reflection cursor.
 *
 * Only the existing prefix is resolved through the filesystem; the absent tail is appended
 * verbatim, so the grant always names the full intended path and can never widen to an ancestor.
 */
function canonicalPath(path: string): string {
  const segments: string[] = []
  let current = path
  for (;;) {
    if (existsSync(current)) return join(realpathSync(current), ...segments.reverse())
    const parent = dirname(current)
    if (parent === current) return path
    segments.push(basename(current))
    current = parent
  }
}

function canonicalAbsentPath(path: string): string {
  return join(canonicalPath(dirname(path)), basename(path))
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
  readonly surface: "reflection" | "facts"
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

function guardedSandboxedTransform<T extends ReflectionSpawnArgs | FactsSpawnArgs>(
  surface: "reflection" | "facts",
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

function resolveInnerCommand(command: string, env: NodeJS.ProcessEnv): string | undefined {
  if (isAbsolute(command)) return command
  for (const entry of (env.PATH ?? "").split(delimiter)) {
    if (entry === "") continue
    const candidate = join(entry, command)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Not executable on this child PATH entry; keep scanning.
    }
  }
  return undefined
}
