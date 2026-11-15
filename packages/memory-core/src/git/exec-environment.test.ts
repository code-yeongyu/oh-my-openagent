import { describe, expect, onTestFinished, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

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
  const git = (...argv: string[]) =>
    execFileSync("git", argv, { cwd: repo, env: memoryGitEnvironment(process.env), stdio: "pipe" })
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

  test.skipIf(process.platform === "win32")(
    "#given an inherited GIT_CONFIG_COUNT pair setting core.hooksPath #when a memory commit runs #then the repository's own pre-commit hook still runs",
    async () => {
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
      const result = await createNodeGitExec().run(["commit", "--allow-empty", "-m", "memory write"], {
        cwd: repo,
        timeoutMs: TIMEOUT_MS,
        env,
      })

      // #then
      expect(result.stderr).toContain("memory pre-commit: refused")
      expect(result.code).not.toBe(0)
    },
  )

  test.skipIf(process.platform === "win32")(
    "#given an inherited GIT_CONFIG_PARAMETERS setting core.hooksPath #when a memory commit runs #then the repository's own pre-commit hook still runs",
    async () => {
      // #given
      const root = scratchRoot()
      const repo = repoWithRefusingHook(root, "repo")
      const env = { ...process.env, GIT_CONFIG_PARAMETERS: `'core.hookspath'='${join(root, "no-hooks")}'` }

      // #when
      const result = await createNodeGitExec().run(["commit", "--allow-empty", "-m", "memory write"], {
        cwd: repo,
        timeoutMs: TIMEOUT_MS,
        env,
      })

      // #then
      expect(result.stderr).toContain("memory pre-commit: refused")
      expect(result.code).not.toBe(0)
    },
  )

  test("#given inherited GIT_CONFIG_COUNT pairs beside core.hooksPath #when building the git environment #then only the hook pair is dropped and the rest is renumbered", () => {
    const env = memoryGitEnvironment({
      PATH: "/usr/bin",
      GIT_CONFIG_COUNT: "4",
      GIT_CONFIG_KEY_0: "url.https://mirror.example.invalid/.insteadOf",
      GIT_CONFIG_VALUE_0: "https://origin.example.invalid/",
      GIT_CONFIG_KEY_1: "core.hooksPath",
      GIT_CONFIG_VALUE_1: "/dev/null",
      GIT_CONFIG_KEY_2: "http.extraHeader",
      GIT_CONFIG_VALUE_2: "Authorization: Bearer <redacted>",
      GIT_CONFIG_KEY_3: "Core.FSMonitor",
      GIT_CONFIG_VALUE_3: "true",
      GIT_CONFIG_KEY_4: "safe.directory",
      GIT_CONFIG_VALUE_4: "ignored by git: past GIT_CONFIG_COUNT",
    })

    expect(env).toEqual({
      PATH: "/usr/bin",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "url.https://mirror.example.invalid/.insteadOf",
      GIT_CONFIG_VALUE_0: "https://origin.example.invalid/",
      GIT_CONFIG_KEY_1: "http.extraHeader",
      GIT_CONFIG_VALUE_1: "Authorization: Bearer <redacted>",
    })
  })

  test("#given an inherited GIT_CONFIG_PARAMETERS list beside core.hooksPath #when building the git environment #then only the hook entry is dropped", () => {
    const env = memoryGitEnvironment({
      GIT_CONFIG_PARAMETERS:
        "'url.git@mirror:.insteadof'='m:' 'core.hookspath'='/dev/null' 'http.extraheader'='X-Note: it'\\''s'\\!'' 'safe.directory=*' ' core.hooksPath =/x' 'include.path'='/x/hooks.cfg' 'includeIf.gitdir:/m/.path'='/x/hooks.cfg' 'credential.helper'=",
    })

    expect(env).toEqual({
      GIT_CONFIG_PARAMETERS:
        "'url.git@mirror:.insteadof'='m:' 'http.extraheader'='X-Note: it'\\''s'\\!'' 'safe.directory=*' 'credential.helper'=",
    })
  })

  test("#given inherited config git itself refuses to parse #when building the git environment #then the unparseable source is dropped whole", () => {
    expect(
      memoryGitEnvironment({
        GIT_CONFIG_PARAMETERS: " 'a.b'='c'",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "a.b",
        GIT_CONFIG_VALUE_0: "c",
      }),
    ).toEqual({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "a.b",
      GIT_CONFIG_VALUE_0: "c",
    })
    expect(
      memoryGitEnvironment({
        GIT_CONFIG_COUNT: "2",
        GIT_CONFIG_KEY_0: "a.b",
        GIT_CONFIG_VALUE_0: "c",
        GIT_CONFIG_PARAMETERS: "'d.e'='f'",
      }),
    ).toEqual({
      GIT_CONFIG_PARAMETERS: "'d.e'='f'",
    })
    expect(memoryGitEnvironment({ GIT_CONFIG_COUNT: "-1", GIT_CONFIG_KEY_0: "a.b", GIT_CONFIG_VALUE_0: "c" })).toEqual(
      {},
    )
  })

  test.skipIf(process.platform === "win32")(
    "#given inherited url.*.insteadOf and http.extraHeader pairs beside core.hooksPath=/dev/null #when memory git runs #then those pairs apply and the hook still runs",
    async () => {
      // #given: a mirror reached only through an inherited insteadOf rewrite, plus the gate's hook-disabling pair
      const root = scratchRoot()
      const repo = repoWithRefusingHook(root, "repo")
      const mirror = repoWithRefusingHook(root, "mirror")
      const env = {
        ...process.env,
        GIT_CONFIG_COUNT: "3",
        GIT_CONFIG_KEY_0: `url.${mirror}.insteadOf`,
        GIT_CONFIG_VALUE_0: "memory-mirror:",
        GIT_CONFIG_KEY_1: "core.hooksPath",
        GIT_CONFIG_VALUE_1: "/dev/null",
        GIT_CONFIG_KEY_2: "http.extraHeader",
        GIT_CONFIG_VALUE_2: "X-Memory-Probe: kept",
      }
      const git = createNodeGitExec()

      // #when
      const header = await git.run(["config", "--get", "http.extraHeader"], { cwd: repo, timeoutMs: TIMEOUT_MS, env })
      const remote = await git.run(["ls-remote", "--get-url", "memory-mirror:"], {
        cwd: repo,
        timeoutMs: TIMEOUT_MS,
        env,
      })
      const commit = await git.run(["commit", "--allow-empty", "-m", "memory write"], {
        cwd: repo,
        timeoutMs: TIMEOUT_MS,
        env,
      })

      // #then
      expect(header.stdout.trim()).toBe("X-Memory-Probe: kept")
      expect(remote.stdout.trim()).toBe(mirror)
      expect(commit.stderr).toContain("memory pre-commit: refused")
      expect(commit.code).not.toBe(0)
    },
  )

  test.skipIf(process.platform === "win32")(
    "#given an inherited include.path whose file sets core.hooksPath #when a memory commit runs #then the repository's own pre-commit hook still runs",
    async () => {
      // #given: the same hook redirection, one include away
      const root = scratchRoot()
      const repo = repoWithRefusingHook(root, "repo")
      const included = join(root, "hooks.cfg")
      writeFileSync(included, "[core]\n\thooksPath = /dev/null\n")
      const env = {
        ...process.env,
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "include.path",
        GIT_CONFIG_VALUE_0: included,
        GIT_CONFIG_PARAMETERS: `'includeIf.gitdir:${repo}/.path'='${included}'`,
      }

      // #when
      const result = await createNodeGitExec().run(["commit", "--allow-empty", "-m", "memory write"], {
        cwd: repo,
        timeoutMs: TIMEOUT_MS,
        env,
      })

      // #then
      expect(result.stderr).toContain("memory pre-commit: refused")
      expect(result.code).not.toBe(0)
    },
  )

  test.skipIf(process.platform === "win32")(
    "#given mixed-case Git_Config_* names beside the real upper-case list #when memory git runs off Windows #then it applies exactly the config git reads from that environment",
    async () => {
      // #given: names are case-sensitive here and git reads only GIT_CONFIG_*; the mixed-case pair comes first in the object
      const root = scratchRoot()
      const repo = repoWithRefusingHook(root, "repo")
      const mirror = repoWithRefusingHook(root, "mirror")
      const env = {
        ...process.env,
        Git_Config_Count: "1",
        Git_Config_Key_0: `url.${mirror}.insteadOf`,
        Git_Config_Value_0: "memory-mirror:",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.extraHeader",
        GIT_CONFIG_VALUE_0: "X-Memory-Probe: upper-case list",
      }
      const raw = (...argv: string[]) => execFileSync("git", argv, { cwd: repo, env, stdio: "pipe" }).toString().trim()
      const git = createNodeGitExec()

      // #when
      const remote = await git.run(["ls-remote", "--get-url", "memory-mirror:"], {
        cwd: repo,
        timeoutMs: TIMEOUT_MS,
        env,
      })
      const header = await git.run(["config", "--get", "http.extraHeader"], { cwd: repo, timeoutMs: TIMEOUT_MS, env })

      // #then: git itself, given the raw environment, ignores the mixed-case pair and reads the upper-case one
      expect(raw("ls-remote", "--get-url", "memory-mirror:")).toBe("memory-mirror:")
      expect(remote.stdout.trim()).toBe("memory-mirror:")
      expect(raw("config", "--get", "http.extraHeader")).toBe("X-Memory-Probe: upper-case list")
      expect(header.stdout.trim()).toBe("X-Memory-Probe: upper-case list")
    },
  )

  test("#given mixed-case GIT_* names on Windows #when building the git environment #then they count as git's own, as git-for-windows reads them", () => {
    const env = memoryGitEnvironment(
      {
        Path: "C:\\Windows",
        Git_Dir: "C:\\elsewhere\\.git",
        Git_Config_Count: "2",
        Git_Config_Key_0: "Core.HooksPath",
        Git_Config_Value_0: "NUL",
        Git_Config_Key_1: "safe.directory",
        Git_Config_Value_1: "*",
      },
      "win32",
    )

    expect(env).toEqual({
      Path: "C:\\Windows",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "safe.directory",
      GIT_CONFIG_VALUE_0: "*",
    })
  })

  test("#given an inherited GIT_DIR naming another repository #when memory git reads HEAD #then it reads the memory repository", async () => {
    // #given
    const root = scratchRoot()
    const memory = repoWithRefusingHook(root, "memory")
    const other = repoWithRefusingHook(root, "other")
    const env = { ...process.env, GIT_DIR: join(other, ".git"), GIT_WORK_TREE: other }

    // #when
    const result = await createNodeGitExec().run(["rev-parse", "--absolute-git-dir"], {
      cwd: memory,
      timeoutMs: TIMEOUT_MS,
      env,
    })

    // #then
    expect(result.code).toBe(0)
    // git prints forward slashes on Windows; resolve() normalizes both sides to the platform separator.
    expect(resolve(result.stdout.trim())).toBe(resolve(join(memory, ".git")))
  })
})
