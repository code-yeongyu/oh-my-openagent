import { describe, expect, onTestFinished, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitNotFoundError } from "./errors"
import { createNodeGitExec, type GitExecResult } from "./exec"
import { removeTreeSync } from "../../../../test-support/remove-tree"

describe("createNodeGitExec filesystem fixtures", () => {
  describe("#given a spawn cwd that does not exist", () => {
    test("#when git runs #then it does NOT report git as missing from PATH", async () => {
      const dir = mkdtempSync(join(tmpdir(), "omo-git-exec-"))
      onTestFinished(() => removeTreeSync(dir, { maxRetries: 10, retryDelay: 200 }))
      const missing = join(dir, "no-such-dir")
      const exec = createNodeGitExec()
      const result = await exec.run(["rev-parse", "--verify", "HEAD"], { cwd: missing, timeoutMs: 5000 })
      expect(result.code).toBe(128)
      expect(result.stderr).toContain("No such file or directory")
    })

    test("#when the bare runner reports the missing-cwd result #then Windows fallbacks are not attempted", async () => {
      const attempts: string[] = []
      const missingCwdResult: GitExecResult = {
        code: 128,
        stdout: "",
        stderr: "fatal: cannot change directory",
      }
      const exec = createNodeGitExec({
        platform: "win32",
        runCommand: async (executable) => {
          attempts.push(executable)
          return missingCwdResult
        },
      })

      const result = await exec.run(["status"], {
        cwd: process.cwd(),
        timeoutMs: 5000,
        env: { PATH: "/nonexistent", ProgramFiles: "C:\\Program Files" },
      })

      expect(result).toBe(missingCwdResult)
      expect(attempts).toEqual(["git"])
    })
  })

  describe("#given a cwd that exists but no git binary on PATH", () => {
    test("#when git runs #then GitNotFoundError fires", async () => {
      const dir = mkdtempSync(join(tmpdir(), "omo-git-exec-"))
      try {
        const exec = createNodeGitExec()
        await expect(
          exec.run(["--version"], { cwd: dir, timeoutMs: 5000, env: { PATH: "/nonexistent" } }),
        ).rejects.toBeInstanceOf(GitNotFoundError)
      } finally {
        removeTreeSync(dir, { maxRetries: 10, retryDelay: 200 })
      }
    })
  })

  test("#given stdin #when real Git runs #then bytes are piped and existing argv handling is unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-git-exec-"))
    try {
      const exec = createNodeGitExec()
      const content = Buffer.from("stdin-content\n")
      const path = join(dir, "content.txt")
      writeFileSync(path, content)
      const expected = await exec.run(["hash-object", "--", path], { cwd: dir, timeoutMs: 5000 })
      const result = await exec.run(["hash-object", "--stdin"], {
        cwd: dir,
        timeoutMs: 5000,
        stdin: content,
      })
      expect(result.code).toBe(0)
      expect(result.stdout).toBe(expected.stdout)
    } finally {
      removeTreeSync(dir, { maxRetries: 10, retryDelay: 200 })
    }
  })
})
