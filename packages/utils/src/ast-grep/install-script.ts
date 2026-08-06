import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { runtimeSlug } from "./sg-manifest"

export const AST_GREP_BIN_DIR_ENV_KEY = "OMO_AST_GREP_BIN_DIR"
export const AST_GREP_INSTALL_TIMEOUT_MS = 30_000

export type AstGrepInstallSpawnOutcome =
  | { readonly kind: "exit"; readonly code: number | null; readonly signal: NodeJS.Signals | null }
  | { readonly kind: "spawn-error"; readonly error: Error; readonly missingExecutable: boolean }

export interface AstGrepInstallSpawnOptions {
  readonly cwd: string
  readonly env: Record<string, string | undefined>
}

export interface AstGrepInstallSpawnedProcess {
  readonly kill: () => void
  readonly outcome: Promise<AstGrepInstallSpawnOutcome>
}

export type AstGrepInstallSpawn = (
  command: string,
  args: readonly string[],
  options: AstGrepInstallSpawnOptions,
) => AstGrepInstallSpawnedProcess

export type AstGrepSkillInstallResult =
  | { readonly kind: "succeeded" }
  | { readonly kind: "skipped"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "timed-out" }

export interface AstGrepSkillInstallOptions {
  readonly env?: Record<string, string | undefined>
  readonly fileExists?: (filePath: string) => boolean
  readonly platform?: NodeJS.Platform
  readonly skillDir: string
  readonly spawnProcess?: AstGrepInstallSpawn
  readonly targetDir: string
  readonly timeoutMs?: number
}

export type RunAstGrepSkillInstall = (options: AstGrepSkillInstallOptions) => Promise<AstGrepSkillInstallResult>

interface InstallInvocation {
  readonly command: string
  readonly args: readonly string[]
}

type TimedInvocationOutcome = AstGrepInstallSpawnOutcome | { readonly kind: "timed-out" }

export function astGrepRuntimeDir(baseDir: string, platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  return join(baseDir, "runtime", "ast-grep", runtimeSlug(platform, arch))
}

function isMissingExecutable(error: Error): boolean {
  if (!("code" in error)) return false
  return error.code === "ENOENT"
}

function defaultSpawnProcess(command: string, args: readonly string[], options: AstGrepInstallSpawnOptions): AstGrepInstallSpawnedProcess {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: "ignore",
    windowsHide: true,
  })
  let settled = false
  const outcome = new Promise<AstGrepInstallSpawnOutcome>((resolve) => {
    const settle = (result: AstGrepInstallSpawnOutcome): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    child.once("error", (error: Error) => {
      settle({ kind: "spawn-error", error, missingExecutable: isMissingExecutable(error) })
    })
    child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      settle({ kind: "exit", code, signal })
    })
  })
  return {
    kill: () => {
      if (!child.killed) child.kill()
    },
    outcome,
  }
}

function scriptPathForPlatform(skillDir: string, platform: NodeJS.Platform): string {
  return join(skillDir, platform === "win32" ? "install.ps1" : "install.sh")
}

function invocationsForPlatform(scriptPath: string, platform: NodeJS.Platform): readonly InstallInvocation[] {
  if (platform !== "win32") return [{ command: "bash", args: [scriptPath] }]
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath]
  return [{ command: "pwsh", args }, { command: "powershell.exe", args }]
}

async function runInvocation(input: {
  readonly invocation: InstallInvocation
  readonly env: Record<string, string | undefined>
  readonly skillDir: string
  readonly spawnProcess: AstGrepInstallSpawn
  readonly timeoutMs: number
}): Promise<TimedInvocationOutcome> {
  const child = input.spawnProcess(input.invocation.command, input.invocation.args, { cwd: input.skillDir, env: input.env })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill()
  }, input.timeoutMs)
  timeout.unref?.()
  try {
    const outcome = await child.outcome
    return timedOut ? { kind: "timed-out" } : outcome
  } finally {
    clearTimeout(timeout)
  }
}

function failedReason(outcome: Exclude<TimedInvocationOutcome, { readonly kind: "exit" } | { readonly kind: "timed-out" }>): string {
  return outcome.error.message
}

export async function runAstGrepSkillInstall(options: AstGrepSkillInstallOptions): Promise<AstGrepSkillInstallResult> {
  const platform = options.platform ?? process.platform
  const fileExists = options.fileExists ?? existsSync
  const scriptPath = scriptPathForPlatform(options.skillDir, platform)
  if (!fileExists(scriptPath)) return { kind: "skipped", reason: `missing ${scriptPath}` }

  const env = { ...(options.env ?? process.env), [AST_GREP_BIN_DIR_ENV_KEY]: options.targetDir }
  const spawnProcess = options.spawnProcess ?? defaultSpawnProcess
  const timeoutMs = options.timeoutMs ?? AST_GREP_INSTALL_TIMEOUT_MS
  const invocations = invocationsForPlatform(scriptPath, platform)

  try {
    for (const invocation of invocations) {
      const outcome = await runInvocation({ env, invocation, skillDir: options.skillDir, spawnProcess, timeoutMs })
      if (outcome.kind === "timed-out") return { kind: "timed-out" }
      if (outcome.kind === "exit") {
        if (outcome.code === 0) return { kind: "succeeded" }
        return { kind: "failed", reason: `${invocation.command} exited ${outcome.code ?? outcome.signal ?? "without status"}` }
      }
      if (platform === "win32" && outcome.missingExecutable && invocation.command === "pwsh") continue
      return { kind: "failed", reason: failedReason(outcome) }
    }
    return { kind: "failed", reason: "no ast-grep install shell was available" }
  } catch (error) {
    if (error instanceof Error) return { kind: "failed", reason: error.message }
    return { kind: "failed", reason: String(error) }
  }
}
