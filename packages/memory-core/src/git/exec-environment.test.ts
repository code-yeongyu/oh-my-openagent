import { describe, expect, onTestFinished, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createNodeGitExec } from "./exec"
import { memoryGitEnvironment } from "./exec-environment"
import { disableFixtureAutoMaintenance } from "./test-repo-config.test-support"
import { removeTreeSync } from "../../../../test-support/remove-tree"

const TIMEOUT_MS = 60_000

function scratchRoot(): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "omo-git-exec-env-")))
  onTestFinished(() => removeTreeSync(root, { maxRetries: 10, retryDelay: 200 }))
  return root
}

/** A repository whose pre-commit hook refuses every commit, so a commit that succeeds proves the hook was skipped. */
function repoWithRefusingHook(root: string, name: string): string {
  const repo = join(root, name)
  mkdirSync(repo)
  const git = (...argv: string[]) => execFileSync("git", argv, { cwd: repo, env: memoryGitEnvironment(process.env), stdio: "pipe" })
  git("init", "--quiet")
  git("config", "user.email", "m@example.invalid")
  git("config", "user.name", "m")
  git("config", "commit.gpgsign", "false")
  disableFixtureAutoMaintenance(repo)
  const hook = join(repo, ".git", "hooks", "pre-commit")
  mkdirSync(join(repo, ".git", "hooks"), { recursive: true })
  writeFileSync(hook, "#!/bin/sh\necho 'memory pre-commit: refused' >&2\nexit 1\n")
  chmodSync(hook, 0o755)
  return repo
}

describe("memoryGitEnvironment (#12354)", () => {
  test("#given inherited config injection and repository redirection #when building the git environment #then only those names are dropped", () => {
    const env = memoryGitEnvironment({
      PATH: "/usr/bin",
      HOME: "/home/m",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "core.fsmonitor",
      GIT_CONFIG_VALUE_0: "false",
      GIT_CONFIG_KEY_1: "core.hooksPath",
      GIT_CONFIG_VALUE_1: "/dev/null",
      GIT_CONFIG_PARAMETERS: "'core.hookspath'='/dev/null'",
      GIT_DIR: "/elsewhere/.git",
      GIT_WORK_TREE: "/elsewhere",
      GIT_COMMON_DIR: "/elsewhere/.git",
      GIT_NAMESPACE: "elsewhere",
      GIT_INDEX_FILE: "/scratch/index",
      GIT_CONFIG_GLOBAL: "/home/m/.gitconfig",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    })

    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/m",
      GIT_INDEX_FILE: "/scratch/index",
      GIT_CONFIG_GLOBAL: "/home/m/.gitconfig",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    })
  })

  test.skipIf(process.platform === "win32")("#given an inherited GIT_CONFIG_COUNT pair setting core.hooksPath #when a memory commit runs #then the repository's own pre-commit hook still runs", async () => {
    // #given: the shape a hermetic gate exports to every child, `core.hooksPath=/dev/null` included
    const root = scratchRoot()
    const repo = repoWithRefusingHook(root, "repo")
    const env = {
      ...process.env,
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "core.fsmonitor",
      GIT_CONFIG_VALUE_0: "false",
      GIT_CONFIG_KEY_1: "core.hooksPath",
      GIT_CONFIG_VALUE_1: "/dev/null",
    }

    // #when
    const result = await createNodeGitExec().run(["commit", "--allow-empty", "-m", "memory write"], { cwd: repo, timeoutMs: TIMEOUT_MS, env })

    // #then
    expect(result.stderr).toContain("memory pre-commit: refused")
    expect(result.code).not.toBe(0)
  })

  test.skipIf(process.platform === "win32")("#given an inherited GIT_CONFIG_PARAMETERS setting core.hooksPath #when a memory commit runs #then the repository's own pre-commit hook still runs", async () => {
    // #given
    const root = scratchRoot()
    const repo = repoWithRefusingHook(root, "repo")
    const env = { ...process.env, GIT_CONFIG_PARAMETERS: `'core.hookspath'='${join(root, "no-hooks")}'` }

    // #when
    const result = await createNodeGitExec().run(["commit", "--allow-empty", "-m", "memory write"], { cwd: repo, timeoutMs: TIMEOUT_MS, env })

    // #then
    expect(result.stderr).toContain("memory pre-commit: refused")
    expect(result.code).not.toBe(0)
  })

  test("#given an inherited GIT_DIR naming another repository #when memory git reads HEAD #then it reads the memory repository", async () => {
    // #given
    const root = scratchRoot()
    const memory = repoWithRefusingHook(root, "memory")
    const other = repoWithRefusingHook(root, "other")
    const env = { ...process.env, GIT_DIR: join(other, ".git"), GIT_WORK_TREE: other }

    // #when
    const result = await createNodeGitExec().run(["rev-parse", "--absolute-git-dir"], { cwd: memory, timeoutMs: TIMEOUT_MS, env })

    // #then
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe(join(memory, ".git"))
  })
})
