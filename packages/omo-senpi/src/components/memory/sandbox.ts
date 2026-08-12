import { accessSync, constants, existsSync, mkdirSync, realpathSync } from "node:fs"
import { delimiter, dirname, isAbsolute, join } from "node:path"

import type { FactsSandbox, FactsSpawnArgs, ReflectionSpawnArgs } from "./worker/spawn"

export type SandboxPolicy = "required" | "auto" | "off"

export interface SandboxTransform {
  (spawnArgs: ReflectionSpawnArgs): ReflectionSpawnArgs
  readonly wasSandboxed: boolean
  readonly warning?: string
}

export class SandboxUnavailableError extends Error {
  readonly platform: NodeJS.Platform

  constructor(platform: NodeJS.Platform, reason: string) {
    super(`required reflection sandbox unavailable on ${platform}: ${reason}`)
    this.name = "SandboxUnavailableError"
    this.platform = platform
  }
}

export function buildSandboxTransform(input: {
  readonly policy: SandboxPolicy
  readonly worktreeDir: string
  readonly gitCommonDir: string
  readonly payloadPaths: readonly string[]
  readonly runtimeWrites?: readonly string[]
  readonly foreignRoots?: readonly string[]
  readonly errorRethrow?: (error: SandboxUnavailableError) => never
  readonly platform?: NodeJS.Platform
  readonly which?: (command: string) => string | undefined
}): SandboxTransform {
  return buildPathSandboxTransform({
    policy: input.policy,
    writableDirs: [
      input.worktreeDir,
      input.gitCommonDir,
      ...(input.runtimeWrites ?? []),
    ],
    payloadPaths: input.payloadPaths,
    fallbackDir: input.worktreeDir,
    foreignRoots: input.foreignRoots,
    errorRethrow: input.errorRethrow,
    platform: input.platform,
    which: input.which,
  })
}

export function buildFactsSandboxTransform(input: {
  readonly policy: SandboxPolicy
  readonly foreignRoots?: readonly string[]
  readonly errorRethrow?: (error: SandboxUnavailableError) => never
  readonly platform?: NodeJS.Platform
  readonly which?: (command: string) => string | undefined
}): FactsSandbox {
  return (spawnArgs) => buildPathSandboxTransform<FactsSpawnArgs>({
    policy: input.policy,
    writableDirs: [spawnArgs.paths.runDir],
    payloadPaths: [spawnArgs.paths.payload],
    fallbackDir: spawnArgs.paths.runDir,
    foreignRoots: input.foreignRoots,
    errorRethrow: input.errorRethrow,
    platform: input.platform,
    which: input.which,
  })(spawnArgs)
}

function buildPathSandboxTransform<T extends ReflectionSpawnArgs | FactsSpawnArgs>(input: {
  readonly policy: SandboxPolicy
  readonly writableDirs: readonly string[]
  readonly payloadPaths: readonly string[]
  readonly fallbackDir: string
  readonly foreignRoots?: readonly string[]
  readonly errorRethrow?: (error: SandboxUnavailableError) => never
  readonly platform?: NodeJS.Platform
  readonly which?: (command: string) => string | undefined
}): GenericSandboxTransform<T> {
  if (input.policy === "off") return identityTransform()

  const platform = input.platform ?? process.platform
  const which = input.which ?? defaultWhich
  const executable = resolveExecutable(platform, which)
  if (executable === undefined) {
    const reason = platform === "darwin" ? "sandbox-exec not found"
      : platform === "linux" ? "bwrap not found"
        : "platform is unsupported"
    if (input.policy === "required") {
      const error = new SandboxUnavailableError(platform, reason)
      if (input.errorRethrow !== undefined) input.errorRethrow(error)
      throw error
    }
    return identityTransform(`reflection sandbox unavailable on ${platform}: ${reason}; running unsandboxed because policy is auto`)
  }

  const writableDirs = input.writableDirs.map(canonicalPath)
  if (platform === "darwin") {
    const payloads = input.payloadPaths.map(canonicalPath)
    const foreignRoots = (input.foreignRoots ?? []).map(canonicalPath)
    const tempDir = join(dirname(payloads[0] ?? canonicalPath(input.fallbackDir)), ".sandbox-tmp")
    mkdirSync(tempDir, { recursive: true, mode: 0o700 })
    const profile = buildDarwinProfile({ writableDirs, tempDir, payloads, foreignRoots })
    return guardedSandboxedTransform((spawnArgs, innerCommand) => ({
      ...spawnArgs,
      command: executable,
      args: ["-p", profile, "--", innerCommand, ...spawnArgs.args],
      env: { ...spawnArgs.env, TMPDIR: tempDir },
    }))
  }

  return guardedSandboxedTransform((spawnArgs, innerCommand) => ({
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

function canonicalPath(path: string): string {
  return realpathSync(path)
}

function seatbeltString(path: string): string {
  return JSON.stringify(path)
}

interface GenericSandboxTransform<T> {
  (spawnArgs: T): T
  readonly wasSandboxed: boolean
  readonly warning?: string
}

function identityTransform<T>(warning?: string): GenericSandboxTransform<T> {
  return Object.assign((spawnArgs: T) => spawnArgs, {
    wasSandboxed: false,
    ...(warning === undefined ? {} : { warning }),
  })
}

function guardedSandboxedTransform<T extends ReflectionSpawnArgs | FactsSpawnArgs>(
  transform: (spawnArgs: T, innerCommand: string) => T,
): GenericSandboxTransform<T> {
  let wasSandboxed = true
  let warning: string | undefined
  const guarded = (spawnArgs: T): T => {
    const innerCommand = resolveInnerCommand(spawnArgs.command, spawnArgs.env)
    if (innerCommand === undefined) {
      wasSandboxed = false
      warning = `reflection sandbox unavailable: inner command "${spawnArgs.command}" is not absolute and could not be resolved; running unsandboxed`
      return spawnArgs
    }
    return transform(spawnArgs, innerCommand)
  }
  return Object.defineProperties(guarded, {
    wasSandboxed: { get: () => wasSandboxed },
    warning: { get: () => warning },
  }) as GenericSandboxTransform<T>
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
