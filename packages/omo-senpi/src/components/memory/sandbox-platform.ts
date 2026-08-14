import { accessSync, constants, existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync } from "node:fs"
import { delimiter, dirname, isAbsolute, join, parse, resolve, sep } from "node:path"

import type { FactsSpawnArgs, ReflectionSpawnArgs } from "./worker/spawn"
import { SandboxUnavailableError, type SandboxPolicy } from "./sandbox-contracts"

export interface PathSandboxInput {
  readonly surface: "reflection" | "facts"
  readonly policy: SandboxPolicy
  readonly writableDirs: readonly string[]
  readonly ownedWritableDirs?: readonly string[]
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

  const innerCommand = resolveInnerCommand(input.command, input.env)
  if (innerCommand === undefined) {
    return identityTransform(`${input.surface} sandbox unavailable: inner command "${input.command}" is not absolute and could not be resolved; running unsandboxed`)
  }

  const writableDirs = [
    ...input.writableDirs.map(canonicalPath),
    ...(input.ownedWritableDirs ?? []).map(canonicalOwnedWritableDir),
  ]
  if (platform === "darwin") {
    const payloads = input.payloadPaths.map(canonicalPath)
    const foreignRoots = (input.foreignRoots ?? []).map(canonicalPath)
    const tempDir = join(dirname(payloads[0] ?? canonicalPath(input.fallbackDir)), ".sandbox-tmp")
    mkdirSync(tempDir, { recursive: true, mode: 0o700 })
    const profile = buildDarwinProfile({ writableDirs, tempDir, payloads, foreignRoots })
    return sandboxedTransform<T>((spawnArgs) => ({
      ...spawnArgs,
      command: executable,
      args: ["-p", profile, "--", innerCommand, ...spawnArgs.args],
      env: { ...spawnArgs.env, TMPDIR: tempDir },
    }) as T)
  }

  return sandboxedTransform<T>((spawnArgs) => ({
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
  }) as T)
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
  if (process.platform === "win32") return realpathSync(path)
  const absolute = resolve(path)
  const root = parse(absolute).root
  let pending = pathComponents(absolute, root)
  let resolved = root
  let followedLinks = 0
  while (pending.length > 0) {
    const candidate = join(resolved, pending.shift() ?? "")
    let stat: ReturnType<typeof lstatSync>
    try {
      stat = lstatSync(candidate)
    } catch (error) {
      if (existsSync(candidate)) {
        throw new Error(`Sandbox path is incompatible with this runtime: ${candidate}`, { cause: error })
      }
      throw error
    }
    if (!stat.isSymbolicLink()) {
      resolved = candidate
      continue
    }
    followedLinks += 1
    if (followedLinks > 40) throw new Error(`Too many symbolic links while resolving sandbox path: ${path}`)
    const target = resolve(resolved, readlinkSync(candidate))
    pending = [...pathComponents(target, root), ...pending]
    resolved = root
  }
  return resolved
}

function pathComponents(path: string, root: string): string[] {
  return path.slice(root.length).split(sep).filter((component) => component.length > 0)
}

function canonicalOwnedWritableDir(path: string): string {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  return canonicalPath(path)
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

function sandboxedTransform<T>(transform: (spawnArgs: T) => T): GenericSandboxTransform<T> {
  return Object.assign(transform, { wasSandboxed: true })
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
