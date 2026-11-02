import { existsSync, lstatSync, mkdirSync, realpathSync } from "@oh-my-opencode/memory-core/fs"
import { dirname, join } from "node:path"

import type { ReflectionSpawnArgs } from "./worker/spawn"

/** The path sandbox only rewrites reflection command/args/env. */
type SandboxableSpawnArgs = ReflectionSpawnArgs

type SandboxSurface = "reflection"
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
  readonly probe?: (executable: string) => SandboxUsability | Promise<SandboxUsability>
}

export interface GenericSandboxTransform<T> {
  (spawnArgs: T): T | Promise<T>
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

  // For Linux, check synchronous probes at build time (for tests), but defer async probes to transform time.
  // This allows async probes (the real default) to not block the event loop while maintaining test compatibility.
  let linuxProbeError: SandboxUnavailableError | undefined
  let linuxProbeWarning: string | undefined
  let deferAsyncProbe = false

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

  // Linux with bwrap: check synchronous probes now, defer async probes to transform time
  if (platform === "linux") {
    const probeResult = (input.probe ?? defaultProbe)(executable)
    if (probeResult instanceof Promise) {
      // Async probe - defer to transform
      deferAsyncProbe = true
    } else {
      // Synchronous probe - check now for early error
      if (!probeResult.usable) {
        const reason = `bwrap cannot create a sandbox: ${probeResult.reason}`
        if (input.policy === "required") {
          linuxProbeError = new SandboxUnavailableError(platform, reason)
          if (input.errorRethrow !== undefined) input.errorRethrow(linuxProbeError)
          throw linuxProbeError
        }
        linuxProbeWarning = `${input.surface} sandbox unavailable on ${platform}: ${reason}; running unsandboxed because policy is auto`
      }
    }
  }

  // Linux with bwrap: return transform that handles probe (already checked or async)
  const innerCommand = resolveInnerCommand(input.command, input.env)
  if (innerCommand === undefined) {
    return identityTransform(`${input.surface} sandbox unavailable: inner command "${input.command}" is not absolute and could not be resolved; running unsandboxed`)
  }

  const buildTransform = (spawnArgs: T): T => {
    // bwrap --bind source target dies child_exit when source does not exist. Reflection runtime
    // dirs are granted before anything creates them; mkdir the declared path (0700) so the bind
    // names that exact directory instead of dying or widening to an existing ancestor. Only here,
    // when bwrap will actually bind it: an off or unavailable sandbox must not create the path.
    for (const writableDir of writableDirs) createPlannedDirNoFollow(writableDir, input.surface)
    return {
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
    }
  }

  const linuxTransform = (spawnArgs: T): T | Promise<T> => {
    // If probe error was detected at build time, throw it now
    if (linuxProbeError !== undefined) {
      throw linuxProbeError
    }
    // If probe warning was detected at build time, return identity
    if (linuxProbeWarning !== undefined) {
      return spawnArgs
    }
    // If probe was async, check it now
    if (deferAsyncProbe) {
      const probeResult = (input.probe ?? defaultProbe)(executable)
      if (probeResult instanceof Promise) {
        return probeResult.then((usability) => {
          if (!usability.usable) {
            const reason = `bwrap cannot create a sandbox: ${usability.reason}`
            if (input.policy === "required") {
              const error = new SandboxUnavailableError(platform, reason)
              if (input.errorRethrow !== undefined) input.errorRethrow(error)
              throw error
            }
            // Policy is auto - return unsandboxed
            return spawnArgs
          }
          // Sandbox is usable - apply the bwrap transform
          return buildTransform(spawnArgs)
        })
      } else {
        // Should not happen - we already checked this at build time
        // But handle it gracefully
        if (!probeResult.usable) {
          const reason = `bwrap cannot create a sandbox: ${probeResult.reason}`
          if (input.policy === "required") {
            const error = new SandboxUnavailableError(platform, reason)
            if (input.errorRethrow !== undefined) input.errorRethrow(error)
            throw error
          }
          return spawnArgs
        }
        return buildTransform(spawnArgs)
      }
    }
    // Synchronous probe already checked and usable
    return buildTransform(spawnArgs)
  }

  const props: { wasSandboxed: boolean; warning?: string } = { wasSandboxed: linuxProbeWarning === undefined }
  if (linuxProbeWarning !== undefined) {
    props.warning = linuxProbeWarning
  }
  return Object.assign(linuxTransform, props) as GenericSandboxTransform<T>
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
 *
 * The gate itself answers synchronously; only the branch that actually spawns bwrap is async. An
 * `async` gate would return a Promise for the no-spawn case too, deferring the bwrap rebinding
 * behind a `.then` for a probe that never runs.
 */
function defaultProbe(executable: string): SandboxUsability | Promise<SandboxUsability> {
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

// Create a planned writable dir one missing segment at a time without following links: the existing
// prefix must still be the canonical path planned earlier, and each created (or raced-in) segment must
// be a real directory, so a link planted on any missing segment is refused before anything is written
// through it. The final realpath equality also refuses a link anywhere on the path.
function createPlannedDirNoFollow(dir: string, surface: string): void {
  const refuse = (resolved: string): never => {
    throw new Error(`${surface} sandbox refused to bind ${dir}: it now resolves to ${resolved} (a symlink appeared on the path after the sandbox was planned); remove the link and run again`)
  }
  const missing: string[] = []
  let cursor = dir
  while (!lexists(cursor)) {
    missing.unshift(cursor)
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  if (lexists(cursor) && realpathSync(cursor) !== cursor) refuse(realpathSync(cursor))
  // Documented residual (accepted, #10329): each segment is lstat-checked and the next one created in a
  // separate step, so a link swapped in between those two calls could still get one directory made through
  // it. Node has no mkdirat / O_NOFOLLOW directory walk to close that, and planting the link needs write
  // access to the identity's own 0700 runtime root, which already means owning this user.
  for (const segment of missing) {
    try {
      mkdirSync(segment, { mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }
    if (lstatSync(segment).isSymbolicLink()) refuse(realpathSync(segment))
  }
  const resolved = realpathSync(dir)
  if (resolved !== dir) refuse(resolved)
}

function lexists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}
