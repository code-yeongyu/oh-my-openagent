/// <reference types="bun-types" />

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { GitUnavailableError, createWorktree, setGitCommandRunnerForTests, validateWorktreeSpec } from "./manager"
import { removeWorktree } from "./cleanup"

const temporaryDirectories: string[] = []

async function initGitRepo(): Promise<string> {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "team-worktree-"))
  temporaryDirectories.push(repositoryRoot)
  Bun.spawnSync(["git", "init"], { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" })
  await fs.writeFile(path.join(repositoryRoot, "README.md"), "hello\n")
  Bun.spawnSync(["git", "add", "README.md"], { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" })
  Bun.spawnSync(["git", "config", "user.email", "test@example.com"], { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" })
  Bun.spawnSync(["git", "config", "user.name", "Test User"], { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" })
  Bun.spawnSync(["git", "commit", "-m", "init"], { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" })
  return repositoryRoot
}

beforeAll(() => {
  mock.restore()
})

afterAll(async () => {
  for (const directory of temporaryDirectories) {
    await fs.rm(directory, { recursive: true, force: true })
  }
  mock.restore()
})

describe("team-worktree manager", () => {
  test("given tmp git repo when createWorktree then registers detached worktree", async () => {
    // given
    const repositoryRoot = await initGitRepo()
    const worktreePath = `../worktree-${randomUUID()}`
    const worktreeDirectory = path.resolve(repositoryRoot, worktreePath)

    // when
    const resultPath = await createWorktree(repositoryRoot, "t1", "m1", worktreePath, {})

    // then
    expect(resultPath).toBe(worktreeDirectory)
    await expect(fs.stat(worktreeDirectory)).resolves.toBeDefined()
    const listResult = Bun.spawnSync(["git", "worktree", "list"], { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" })
    expect(new TextDecoder().decode(listResult.stdout)).toContain(worktreeDirectory)
    const headResult = Bun.spawnSync(["git", "-C", worktreeDirectory, "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" })
    const repoHeadResult = Bun.spawnSync(["git", "-C", repositoryRoot, "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" })
    expect(new TextDecoder().decode(headResult.stdout).trim()).toBe(new TextDecoder().decode(repoHeadResult.stdout).trim())
  })

  test("validateWorktreeSpec rejects bare name", () => {
    // given
    const worktreePath = "feature-x"

    // when
    const validate = () => validateWorktreeSpec(worktreePath)

    // then
    expect(validate).toThrow("worktreePath must be a filesystem path (relative './...', '../...' or absolute '/...')")
  })

  test("given git unavailable when createWorktree then throws unavailable error", async () => {
    // given
    const repositoryRoot = await initGitRepo()
    setGitCommandRunnerForTests(async (args) => {
      if (args[0] === "--version") {
        return { code: 1, stderr: "git missing" }
      }

      return { code: 0, stderr: "" }
    })

    // when
    const create = createWorktree(repositoryRoot, "t1", "m1", `../worktree-${randomUUID()}`, {})

    // then
    await expect(create).rejects.toBeInstanceOf(GitUnavailableError)
    setGitCommandRunnerForTests(async (args) => {
      if (args[0] === "--version") {
        return { code: 0, stderr: "" }
      }

      return { code: 0, stderr: "" }
    })
  })

  test("given created worktree when removeWorktree then directory disappears", async () => {
    // given
    const repositoryRoot = await initGitRepo()
    const worktreePath = await createWorktree(repositoryRoot, "t1", "m1", `../worktree-${randomUUID()}`, {})

    // when
    await removeWorktree(worktreePath)

    // then
    await expect(fs.stat(worktreePath)).rejects.toThrow()
  })
})
