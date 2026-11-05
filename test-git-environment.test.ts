import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeTreeSync } from "./test-support/remove-tree"

// A runner that exports git config injection (a hermetic gate's GIT_CONFIG_COUNT pair with core.hooksPath=/dev/null)
// must not reach the git a test starts: every memory-core hook test then saw its own installed hook skipped (#12354).
// The preload (test-setup.ts) drops those names for the run; this commits through the inherited environment as tests do.
describe("test git environment (#12354)", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) removeTreeSync(dir, { maxRetries: 10, retryDelay: 200 })
  })

  test.skipIf(process.platform === "win32")("#given a fixture repository's own pre-commit hook #when a test commits with the inherited environment #then the hook runs", () => {
    // #given
    const dir = mkdtempSync(join(tmpdir(), "omo-test-git-env-"))
    dirs.push(dir)
    const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" })
    git("init", "-q")
    git("config", "maintenance.auto", "false")
    writeFileSync(join(dir, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho 'fixture hook ran' >&2\nexit 1\n")
    chmodSync(join(dir, ".git", "hooks", "pre-commit"), 0o755)

    // #when
    const result = git("-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-q", "-m", "probe")

    // #then
    expect(result.stderr).toContain("fixture hook ran")
    expect(result.status).not.toBe(0)
  })
})
