import { spawn } from "node:child_process"
import { existsSync } from "../fs/resilient"
import { win32 } from "node:path"
import { GitAbortedError, GitNotFoundError, GitTimeoutError } from "./errors"

export interface GitExecOptions {
  cwd: string
  timeoutMs: number
  env?: NodeJS.ProcessEnv
  stdin?: string | Buffer
  /** Stops the git process (SIGTERM, so git removes its own lock and temp files) and rejects. */
  signal?: AbortSignal
}

export interface GitExecResult {
  code: number
  stdout: string
  stderr: string
  /** Raw stdout for byte-framed output (`git cat-file --batch`); injected execs may omit it. */
  stdoutBytes?: Buffer
}

export interface GitExec {
  run(argv: readonly string[], options: GitExecOptions): Promise<GitExecResult>
}

export interface NodeGitExecRuntime {
  platform?: NodeJS.Platform
  runCommand?: (
    executable: string,
    argv: readonly string[],
    options: GitExecOptions,
    environment: NodeJS.ProcessEnv,
  ) => Promise<GitExecResult>
}

const WINDOWS_GIT_CANDIDATES = [
  ["ProgramFiles", ["Git", "cmd", "git.exe"]],
  ["ProgramW6432", ["Git", "cmd", "git.exe"]],
  ["ProgramFiles(x86)", ["Git", "cmd", "git.exe"]],
  ["LOCALAPPDATA", ["Programs", "Git", "cmd", "git.exe"]],
] as const

function environmentValue(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  for (const [key, value] of Object.entries(environment)) {
    if (key.toLowerCase() !== name.toLowerCase() || value === undefined) continue
    const trimmed = value.trim()
    if (trimmed.length > 0) return trimmed
  }
  return undefined
}

function windowsGitExecutables(environment: NodeJS.ProcessEnv): string[] {
  const seen = new Set<string>()
  const candidates: string[] = []

  for (const [environmentName, pathParts] of WINDOWS_GIT_CANDIDATES) {
    const root = environmentValue(environment, environmentName)
    if (root === undefined || !/^[A-Za-z]:[\\/]/.test(root)) continue

    const candidate = win32.join(root, ...pathParts)
    const normalizedCandidate = win32.normalize(candidate).toLowerCase()
    if (seen.has(normalizedCandidate)) continue
    seen.add(normalizedCandidate)
    candidates.push(candidate)
  }

  return candidates
}

function isGitNotFoundFromEnoent(error: unknown): error is GitNotFoundError {
  if (!(error instanceof GitNotFoundError) || !(error.cause instanceof Error)) return false
  return (error.cause as NodeJS.ErrnoException).code === "ENOENT"
}

function runGitCommand(
  executable: string,
  argv: readonly string[],
  options: GitExecOptions,
  environment: NodeJS.ProcessEnv,
): Promise<GitExecResult> {
  return new Promise((resolve, reject) => {
    const hasStdin = options.stdin !== undefined
    // git.exe is a console-subsystem binary: without windowsHide every memory auto-commit and
    // sync allocates a fresh console window that Windows foregrounds, stealing the user's focus
    // (#8501). Inert on posix, load-bearing on win32 - do not drop it.
    const child = spawn(executable, [...argv], {
      cwd: options.cwd,
      env: environment,
      shell: false,
      stdio: [hasStdin ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let settled = false
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, options.timeoutMs)
    let aborted = false
    const onAbort = () => {
      aborted = true
      child.kill("SIGTERM")
    }
    if (options.signal?.aborted === true) onAbort()
    else options.signal?.addEventListener("abort", onAbort, { once: true })

    child.stdout!.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr!.on("data", (chunk: Buffer) => stderr.push(chunk))
    if (hasStdin) child.stdin!.end(options.stdin)
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", onAbort)
      if (error.code === "ENOENT") {
        // spawn reports ENOENT for a missing cwd as much as for a missing git binary. A fresh
        // memory identity has no repo dir yet, and calling that "git not found on PATH" surfaced a
        // bogus extension error on every first session. Behave like git itself: report the absent
        // cwd as exit 128 so head() reads it as no-repo-yet, and reserve GitNotFoundError for a cwd
        // that exists while the binary genuinely cannot spawn.
        if (!existsSync(options.cwd)) {
          resolve({
            code: 128,
            stdout: "",
            stderr: `fatal: cannot change to '${options.cwd}': No such file or directory`,
          })
          return
        }
        reject(new GitNotFoundError({ cause: error }))
      } else reject(error)
    })
    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", onAbort)
      if (aborted) {
        reject(new GitAbortedError(argv))
        return
      }
      if (timedOut) {
        reject(new GitTimeoutError(argv, options.timeoutMs))
        return
      }
      const stdoutBytes = Buffer.concat(stdout)
      resolve({
        code: code ?? 1,
        stdout: stdoutBytes.toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdoutBytes,
      })
    })
  })
}

export function createNodeGitExec(runtime: NodeGitExecRuntime = {}): GitExec {
  const platform = runtime.platform ?? process.platform
  const runCommand = runtime.runCommand ?? runGitCommand

  return {
    async run(argv, options) {
      const environment = options.env ?? process.env
      try {
        return await runCommand("git", argv, options, environment)
      } catch (error) {
        if (platform !== "win32" || !isGitNotFoundFromEnoent(error)) throw error

        for (const fallback of windowsGitExecutables(environment)) {
          try {
            return await runCommand(fallback, argv, options, environment)
          } catch (fallbackError) {
            if (isGitNotFoundFromEnoent(fallbackError)) continue
            throw fallbackError
          }
        }

        throw error
      }
    },
  }
}
