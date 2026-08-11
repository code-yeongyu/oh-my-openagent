import { accessSync, constants, existsSync, mkdirSync, realpathSync } from "node:fs"
import { delimiter, dirname, join } from "node:path"

import type { ReflectionSpawnArgs } from "./worker/spawn"

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

  const worktree = realpathSync(input.worktreeDir)
  const gitCommonDir = realpathSync(input.gitCommonDir)
  const runtimeWrites = (input.runtimeWrites ?? []).map(canonicalPath)
  if (platform === "darwin") {
    const payloads = input.payloadPaths.map(canonicalPath)
    const foreignRoots = (input.foreignRoots ?? []).map(canonicalPath)
    const tempDir = join(dirname(payloads[0] ?? worktree), ".sandbox-tmp")
    mkdirSync(tempDir, { recursive: true, mode: 0o700 })
    const profile = buildDarwinProfile({ worktree, gitCommonDir, tempDir, payloads, foreignRoots, runtimeWrites })
    return sandboxedTransform((spawnArgs) => ({
      ...spawnArgs,
      command: executable,
      args: ["-p", profile, "--", spawnArgs.command, ...spawnArgs.args],
      env: { ...spawnArgs.env, TMPDIR: tempDir },
    }))
  }

  return sandboxedTransform((spawnArgs) => ({
    ...spawnArgs,
    command: executable,
    args: [
      "--ro-bind", "/", "/",
      "--dev-bind", "/dev", "/dev",
      "--tmpfs", "/tmp",
      "--bind", worktree, worktree,
      "--bind", gitCommonDir, gitCommonDir,
      ...runtimeWrites.flatMap((writableDir) => ["--bind", writableDir, writableDir]),
      "--chdir", spawnArgs.cwd,
      "--", spawnArgs.command, ...spawnArgs.args,
    ],
  }))
}

function buildDarwinProfile(input: {
  readonly worktree: string
  readonly gitCommonDir: string
  readonly tempDir: string
  readonly payloads: readonly string[]
  readonly foreignRoots: readonly string[]
  readonly runtimeWrites: readonly string[]
}): string {
  const writable = [input.worktree, input.gitCommonDir, input.tempDir, ...input.runtimeWrites]
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

function identityTransform(warning?: string): SandboxTransform {
  return Object.assign((spawnArgs: ReflectionSpawnArgs) => spawnArgs, {
    wasSandboxed: false,
    ...(warning === undefined ? {} : { warning }),
  })
}

function sandboxedTransform(transform: (spawnArgs: ReflectionSpawnArgs) => ReflectionSpawnArgs): SandboxTransform {
  return Object.assign(transform, { wasSandboxed: true })
}
