import { spawn } from "node:child_process"
import { existsSync } from "../fs/resilient"
import { environmentValue, type IsFile, resolveWin32Git } from "../process/win32-executable"
import { spawnTarget, spawnTargetOptions } from "../process/win32-launch"
import { GitAbortedError, GitNotFoundError, GitTimeoutError } from "./errors"
import { holdGitActivityShared } from "./git-activity-lock"
import { recordGitTimeout } from "./timeout-diagnostics"

export interface GitExecOptions {
  cwd: string
  timeoutMs: number
  env?: NodeJS.ProcessEnv
  stdin?: string | Buffer
  /** Stops the git process (SIGTERM, so git removes its own lock and temp files) and rejects. */
  signal?: AbortSignal
  /** After a timeout's SIGTERM, how long git gets to exit before SIGKILL (default GIT_KILL_GRACE_MS). */
  killGraceMs?: number
  /** After git exits normally, how long to wait for its pipes to close (default GIT_EXIT_DRAIN_MS). */
  exitDrainMs?: number
}

// A timed-out git first gets SIGTERM, on which it removes its own lock and temp files; SIGKILL
// follows only if it is still running after this grace. Killing outright stranded a HEAD.lock
// when a slow `git commit` was killed right after updating HEAD (omo #10199 field incident).
export const GIT_KILL_GRACE_MS = 10_000

// A hook's background child can inherit git's stdout/stderr and hold them open long after git has
// exited, so `close` may never come while it lives. Git's own output is written before it exits;
// this bounded drain only catches the last buffered chunks (omo #10199 review LOW 1).
export const GIT_EXIT_DRAIN_MS = 2_000

export interface GitExecResult {
  code: number
  stdout: string
  stderr: string
  /** Raw stdout for byte-framed output (`git cat-file --batch`); injected execs may omit it. */
  stdoutBytes?: Buffer
  /** How the child ended, so a silent non-zero exit can be told apart from an external kill (#11943). */
  termination?: GitTermination
}

export interface GitTermination {
  readonly signal: NodeJS.Signals | null
  readonly elapsedMs: number
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
  isFile?: IsFile
}

const RESOLUTION_INPUTS = ["PATH", "ProgramFiles", "ProgramW6432", "ProgramFiles(x86)", "LOCALAPPDATA"] as const

function resolutionKey(environment: NodeJS.ProcessEnv): string {
  return JSON.stringify(RESOLUTION_INPUTS.map((name) => environmentValue(environment, name) ?? null))
}

function missingCwdResult(cwd: string): GitExecResult {
  return { code: 128, stdout: "", stderr: `fatal: cannot change to '${cwd}': No such file or directory` }
}

function gitNotFound(cwd: string): GitExecResult {
  // Same order as a failed spawn: an absent cwd is "no repo yet" (exit 128) before "no git".
  if (!existsSync(cwd)) return missingCwdResult(cwd)
  throw new GitNotFoundError({ cause: Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT", syscall: "spawn git", path: "git" }) })
}

function isGitNotFoundFromEnoent(error: unknown): error is GitNotFoundError {
  if (!(error instanceof GitNotFoundError) || !(error.cause instanceof Error)) return false
  return (error.cause as NodeJS.ErrnoException).code === "ENOENT"
}

async function runGitCommand(
  executable: string,
  argv: readonly string[],
  options: GitExecOptions,
  environment: NodeJS.ProcessEnv,
): Promise<GitExecResult> {
  const activity = await holdGitActivityShared(options.cwd)
  try {
    return await spawnGitCommand(executable, argv, options, environment, activity?.fd)
  } finally {
    await activity?.release()
  }
}

function spawnGitCommand(
  executable: string,
  argv: readonly string[],
  options: GitExecOptions,
  environment: NodeJS.ProcessEnv,
  activityFd: number | undefined,
): Promise<GitExecResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const hasStdin = options.stdin !== undefined
    const target = spawnTarget(executable, "git", argv, environment)
    // git.exe is a console-subsystem binary: without windowsHide every memory auto-commit and
    // sync allocates a fresh console window that Windows foregrounds, stealing the user's focus
    // (#8501). Inert on posix, load-bearing on win32 - do not drop it.
    const child = spawn(target.file, [...target.args], {
      cwd: options.cwd,
      env: environment,
      shell: false,
      // fd 3 carries the git-activity lock into git and every process it starts (omo #10322).
      stdio: [hasStdin ? "pipe" : "ignore", "pipe", "pipe", ...(activityFd === undefined ? [] : [activityFd])],
      windowsHide: true,
      ...spawnTargetOptions(target),
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let settled = false
    let timedOut = false
    let exitDrain: ReturnType<typeof setTimeout> | undefined

    let killTimer: ReturnType<typeof setTimeout> | undefined
    const timer = setTimeout(() => {
      timedOut = true
      recordGitTimeout(environment, child.pid, argv, options.cwd, options.timeoutMs)
      child.kill("SIGTERM")
      killTimer = setTimeout(() => child.kill("SIGKILL"), options.killGraceMs ?? GIT_KILL_GRACE_MS)
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
    // An unlistened stdin 'error' would crash the process (#11129). EPIPE means git exited before
    // reading all of its stdin (a bad path, a held index.lock), which git's own exit code already
    // reports. Any other stdin error is recorded and reported in the result's stderr.
    let stdinError: NodeJS.ErrnoException | undefined
    const stdin = hasStdin ? child.stdin : null
    if (stdin) {
      stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") stdinError = error
      })
      stdin.end(options.stdin)
    }
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(killTimer)
      clearTimeout(exitDrain)
      options.signal?.removeEventListener("abort", onAbort)
      if (error.code === "ENOENT") {
        // spawn reports ENOENT for a missing cwd as much as for a missing git binary. A fresh
        // memory identity has no repo dir yet, and calling that "git not found on PATH" surfaced a
        // bogus extension error on every first session. Behave like git itself: report the absent
        // cwd as exit 128 so head() reads it as no-repo-yet, and reserve GitNotFoundError for a cwd
        // that exists while the binary genuinely cannot spawn.
        if (!existsSync(options.cwd)) {
          resolve(missingCwdResult(options.cwd))
          return
        }
        reject(new GitNotFoundError({ cause: error }))
      } else reject(error)
    })
    const settleWithResult = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(killTimer)
      clearTimeout(exitDrain)
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
        stderr: Buffer.concat(stderr).toString("utf8") + describeStdinError(stdinError),
        stdoutBytes,
        termination: { signal, elapsedMs: Date.now() - startedAt },
      })
    }
    // Git has exited even while a hook it started still holds its stdout/stderr open, so `close`
    // may never come. A stopped git (timeout or abort) settles at once; a git that finished
    // normally settles on `close`, or with what it wrote once the bounded drain runs out.
    child.on("exit", (code, signal) => {
      if (settled) return
      if (timedOut || aborted) {
        settled = true
        clearTimeout(timer)
        clearTimeout(killTimer)
        options.signal?.removeEventListener("abort", onAbort)
        reject(aborted ? new GitAbortedError(argv) : new GitTimeoutError(argv, options.timeoutMs))
        return
      }
      clearTimeout(timer)
      exitDrain = setTimeout(() => {
        // Still open past the drain: a hook child holds them. Destroy them so it cannot keep us.
        child.stdout!.destroy()
        child.stderr!.destroy()
        settleWithResult(code, signal)
      }, options.exitDrainMs ?? GIT_EXIT_DRAIN_MS)
    })
    child.on("close", (code, signal) => settleWithResult(code, signal))
  })
}

export function createNodeGitExec(runtime: NodeGitExecRuntime = {}): GitExec {
  const platform = runtime.platform ?? process.platform
  const runCommand = runtime.runCommand ?? runGitCommand
  // On win32 git is never spawned by bare name: a bare name is searched in the working directory
  // (the memory repo) before PATH, so a planted git.exe/.cmd/.bat/.com would run (#12146). A found
  // path is memoized per PATH and install-root value; it is dropped and re-resolved once when its
  // spawn reports ENOENT, and a miss is never cached, so installing git while omo runs still works.
  // The memo hides a new, earlier PATH match until that ENOENT or a restart.
  const resolved = new Map<string, string>()
  const resolveGit = (environment: NodeJS.ProcessEnv): string | undefined => {
    const key = resolutionKey(environment)
    const known = resolved.get(key)
    if (known !== undefined) return known
    const found = resolveWin32Git(environment, runtime.isFile)
    if (found !== undefined) resolved.set(key, found)
    return found
  }

  return {
    async run(argv, options) {
      const environment = options.env ?? process.env
      if (platform !== "win32") return await runCommand("git", argv, options, environment)

      const executable = resolveGit(environment)
      if (executable === undefined) return gitNotFound(options.cwd)
      try {
        return await runCommand(executable, argv, options, environment)
      } catch (error) {
        if (!isGitNotFoundFromEnoent(error)) throw error
        resolved.delete(resolutionKey(environment))
        const relocated = resolveGit(environment)
        if (relocated === undefined || relocated === executable) throw error
        return await runCommand(relocated, argv, options, environment)
      }
    },
  }
}

function describeStdinError(error: NodeJS.ErrnoException | undefined): string {
  return error === undefined ? "" : `\nomo: git stdin was not fully delivered (${error.code ?? error.message})\n`
}
