import { describe, expect, onTestFinished, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createNodeGitExec } from "./exec"
import { resolveHooksDir } from "./git-dir"
import { createRepo, removeTempDirs, run, writeFiles, type RunResult } from "../memfs/hooks.test-support"
import { removeTreeSync } from "../../../../test-support/remove-tree"

// A global core.hooksPath silently redirects hook lookup away from the hooks
// memory installs, so a commit through the exec must pin the memory hooks dir
// next to NO_FSMONITOR (omo #12367). The positive control proves the fixture
// really skips hooks without the pin; the exec run proves the pin restores them.
const BAD_FRONTMATTER = "no frontmatter\n"

interface HooksPathFixture {
  readonly root: string
  readonly dir: string
  readonly env: NodeJS.ProcessEnv
  readonly runGit: (argv: readonly string[]) => Promise<RunResult>
}

async function commitBadFile(fixture: HooksPathFixture, file: string, message: string): Promise<RunResult> {
  await writeFiles(fixture.dir, { [file]: BAD_FRONTMATTER })
  await fixture.runGit(["git", "add", "-A"])
  return fixture.runGit(["git", "commit", "-m", message])
}

async function makeGlobalConfigFixture(): Promise<HooksPathFixture> {
  const root = mkdtempSync(join(tmpdir(), "omo-git-hookspath-e2e-"))
  const configPath = join(root, "gitconfig")
  writeFileSync(configPath, "[core]\n\thooksPath = /dev/null\n")
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: root,
    XDG_CONFIG_HOME: join(root, "xdg"),
    GIT_CONFIG_GLOBAL: configPath,
    GIT_CONFIG_NOSYSTEM: "1",
  }
  const dir = await createRepo()
  return { root, dir, env, runGit: (argv) => run(argv, dir, env) }
}

async function makeSandboxedHomeFixture(): Promise<HooksPathFixture> {
  const root = mkdtempSync(join(tmpdir(), "omo-git-hookspath-e2e-"))
  writeFileSync(join(root, ".gitconfig"), "[core]\n\thooksPath = /dev/null\n")
  // The test preload owns GIT_CONFIG_GLOBAL, which would replace $HOME/.gitconfig,
  // so this variant builds its git environment from scratch instead of spreading
  // process.env: no GIT_CONFIG_GLOBAL key at all, HOME pointed at the sandbox.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "",
    HOME: root,
    XDG_CONFIG_HOME: join(root, "xdg"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  }
  const dir = await createRepo()
  const runGit = async (argv: readonly string[]): Promise<RunResult> => {
    const result = spawnSync(argv[0] ?? "", argv.slice(1), { cwd: dir, env, encoding: "utf8" })
    if (result.error !== undefined) throw result.error
    return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
  }
  return { root, dir, env, runGit }
}

describe("createNodeGitExec hooksPath", () => {
  test("#given a repository cwd #when any git command runs #then argv pins core.hooksPath to the memory hooks dir", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "omo-git-hookspath-"))
    onTestFinished(() => removeTreeSync(cwd, { maxRetries: 10, retryDelay: 200 }))
    const seen: (readonly string[])[] = []
    const exec = createNodeGitExec({
      platform: "linux",
      runCommand: async (_executable, argv) => {
        seen.push(argv)
        return { code: 0, stdout: "", stderr: "" }
      },
    })

    await exec.run(["status", "--porcelain"], { cwd, timeoutMs: 5000 })

    expect(seen).toEqual([
      ["-c", "core.fsmonitor=false", "-c", `core.hooksPath=${resolveHooksDir(cwd)}`, "status", "--porcelain"],
    ])
  })

  for (const [variant, makeFixture] of [
    ["GIT_CONFIG_GLOBAL file", makeGlobalConfigFixture],
    ["sandboxed HOME", makeSandboxedHomeFixture],
  ] as const) {
    test(`#given a global core.hooksPath pointing at /dev/null via ${variant} #when a memory commit runs through createNodeGitExec #then the memory pre-commit hook still rejects frontmatter-less notes`, async () => {
      const fixture = await makeFixture()
      onTestFinished(async () => {
        await removeTempDirs()
        removeTreeSync(fixture.root, { maxRetries: 10, retryDelay: 200 })
      })
      const exec = createNodeGitExec()

      // given: without the exec boundary the global hooksPath skips the hook
      const raw = await commitBadFile(fixture, "system/bad.md", "raw commit")
      expect(raw.code).toBe(0)

      // when: the same violation goes through the exec boundary
      await writeFiles(fixture.dir, { "system/bad-two.md": BAD_FRONTMATTER })
      await fixture.runGit(["git", "add", "-A"])
      const result = await exec.run(["commit", "-m", "exec commit"], { cwd: fixture.dir, timeoutMs: 30_000, env: fixture.env })

      // then: the memory pre-commit hook runs and rejects the commit
      expect(result.code).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toContain("Frontmatter validation failed")
    }, 60_000)
  }
})
