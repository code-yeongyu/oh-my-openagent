import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getGitHead } from "./git"

/**
 * Helper: run a shell command in the given cwd and return trimmed stdout.
 * Used to bootstrap throwaway git repos for the getGitHead tests.
 */
async function runCmd(cwd: string, cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`Command failed: ${cmd.join(" ")} in ${cwd}`)
  }
  return stdout.trim()
}

/**
 * Helper: create a fresh git repo in `dir` with a single initial commit.
 * Returns the SHA of HEAD. Throws if `git` is unavailable.
 */
async function initGitRepo(dir: string): Promise<string> {
  await runCmd(dir, ["git", "init", "-b", "main"])
  await runCmd(dir, ["git", "config", "user.email", "test@example.com"])
  await runCmd(dir, ["git", "config", "user.name", "Test User"])
  await Bun.write(join(dir, "README.md"), "hello\n")
  await runCmd(dir, ["git", "add", "README.md"])
  await runCmd(dir, ["git", "commit", "-m", "init"])
  return await runCmd(dir, ["git", "rev-parse", "HEAD"])
}

describe("handoff/git", () => {
  const TEST_ROOT = join(tmpdir(), `handoff-git-test-${Date.now()}`)

  beforeEach(() => {
    if (!existsSync(TEST_ROOT)) {
      mkdirSync(TEST_ROOT, { recursive: true })
    }
  })

  afterEach(() => {
    if (existsSync(TEST_ROOT)) {
      rmSync(TEST_ROOT, { recursive: true, force: true })
    }
  })

  describe("getGitHead", () => {
    test("returns sha + branch for a normal git repo", async () => {
      //#given - a fresh git repo on the `main` branch with one commit
      const repo = join(TEST_ROOT, "repo-normal")
      mkdirSync(repo, { recursive: true })
      const expectedSha = await initGitRepo(repo)

      //#when
      const head = await getGitHead(repo)

      //#then
      expect(head).not.toBeNull()
      expect(head?.sha).toBe(expectedSha)
      expect(head?.branch).toBe("main")
      expect(head?.detached).toBe(false)
    })

    test("returns null for a directory that is not a git repo", async () => {
      //#given - a plain directory with no .git folder
      const notRepo = join(TEST_ROOT, "not-a-repo")
      mkdirSync(notRepo, { recursive: true })

      //#when
      const head = await getGitHead(notRepo)

      //#then
      expect(head).toBeNull()
    })

    test("returns null for a non-existent directory", async () => {
      //#given - a path that does not exist on disk
      const missing = join(TEST_ROOT, "does-not-exist")

      //#when
      const head = await getGitHead(missing)

      //#then
      expect(head).toBeNull()
    })

    test("returns detached=true when HEAD points at a sha, not a branch", async () => {
      //#given - a git repo whose HEAD is detached (checked out by sha)
      const repo = join(TEST_ROOT, "repo-detached")
      mkdirSync(repo, { recursive: true })
      const sha = await initGitRepo(repo)
      await runCmd(repo, ["git", "checkout", "--detach", sha])

      //#when
      const head = await getGitHead(repo)

      //#then
      expect(head).not.toBeNull()
      expect(head?.sha).toBe(sha)
      expect(head?.detached).toBe(true)
    })

    test("returns null when the directory argument is an empty string", async () => {
      //#given - empty cwd
      //#when
      const head = await getGitHead("")

      //#then
      expect(head).toBeNull()
    })
  })
})
