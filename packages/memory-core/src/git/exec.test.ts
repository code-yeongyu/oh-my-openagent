import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitNotFoundError } from "./errors"
import { createNodeGitExec } from "./exec"

describe("createNodeGitExec", () => {
  describe("#given a spawn cwd that does not exist", () => {
    test("#when git runs #then it does NOT report git as missing from PATH", async () => {
      const missing = join(mkdtempSync(join(tmpdir(), "omo-git-exec-")), "no-such-dir")
      const exec = createNodeGitExec()
      const result = await exec.run(["rev-parse", "--verify", "HEAD"], { cwd: missing, timeoutMs: 5000 })
      expect(result.code).toBe(128)
      expect(result.stderr).toContain("No such file or directory")
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
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })
})
