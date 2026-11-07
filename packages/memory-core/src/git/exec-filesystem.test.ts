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
  })

  describe("#given a git resolved from PATH on win32", () => {
    test("#when the runner reports the missing-cwd result #then it is returned as is and no install root is probed", async () => {
      const attempts: string[] = []
      const probed: string[] = []
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
        // The PATH git is the only spawn: a 128 answer is not a missing binary, so the Git for
        // Windows install roots stay unprobed and nothing is retried (#12146).
        isFile: (path) => {
          probed.push(path)
          return path === "C:\\Git\\cmd\\git.exe"
        },
      })

      const result = await exec.run(["status"], {
        cwd: process.cwd(),
        timeoutMs: 5000,
        env: { PATH: "C:\\Git\\cmd", ProgramFiles: "C:\\Program Files" },
      })

      expect(result).toBe(missingCwdResult)
      expect(attempts).toEqual(["C:\\Git\\cmd\\git.exe"])
      expect(probed).not.toContain("C:\\Program Files\\Git\\cmd\\git.exe")
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
