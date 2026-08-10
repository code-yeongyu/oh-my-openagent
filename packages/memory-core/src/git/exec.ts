import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { GitNotFoundError, GitTimeoutError } from "./errors"

export interface GitExecOptions {
  cwd: string
  timeoutMs: number
  env?: NodeJS.ProcessEnv
}

export interface GitExecResult {
  code: number
  stdout: string
  stderr: string
}

export interface GitExec {
  run(argv: readonly string[], options: GitExecOptions): Promise<GitExecResult>
}

export function createNodeGitExec(): GitExec {
  return {
    run(argv, options) {
      return new Promise((resolve, reject) => {
        const child = spawn("git", [...argv], {
          cwd: options.cwd,
          env: options.env ?? process.env,
          stdio: ["ignore", "pipe", "pipe"],
        })
        const stdout: Buffer[] = []
        const stderr: Buffer[] = []
        let settled = false
        let timedOut = false

        const timer = setTimeout(() => {
          timedOut = true
          child.kill("SIGKILL")
        }, options.timeoutMs)

        child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
        child.on("error", (error: NodeJS.ErrnoException) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
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
          if (timedOut) {
            reject(new GitTimeoutError(argv, options.timeoutMs))
            return
          }
          resolve({
            code: code ?? 1,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
          })
        })
      })
    },
  }
}
