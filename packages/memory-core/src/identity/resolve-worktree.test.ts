import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MEMORY_ROOT_ENV_VAR } from "./layout"
import { resolveAutoIdentity, resolveMemoryIdentity } from "./resolve"

// Real `git` output (worktree add, --separate-git-dir, bare clones, submodules) is the platform
// contract the git auto identity reads, so this suite builds actual repositories instead of
// faking the pointer files.
const GIT_IDENTITY = ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "-c", "commit.gpgsign=false"]

function git(cwd: string, args: readonly string[]): void {
  execFileSync("git", [...GIT_IDENTITY, ...args], { cwd, stdio: "ignore" })
}

let parent = ""
let main = ""
let worktree = ""
let plain = ""
let env: Record<string, string> = {}

beforeAll(() => {
  parent = realpathSync.native(mkdtempSync(join(tmpdir(), "memory-identity-worktree-")))
  main = join(parent, "project")
  worktree = join(parent, "project-feature")
  plain = join(parent, "not-a-repo")
  mkdirSync(main)
  mkdirSync(plain)
  mkdirSync(join(main, "packages", "api"), { recursive: true })
  git(main, ["init", "--quiet", "--initial-branch=main"])
  git(main, ["commit", "--quiet", "--allow-empty", "-m", "init"])
  git(main, ["worktree", "add", "--quiet", "-b", "feature", worktree])
  mkdirSync(join(worktree, "packages", "api"), { recursive: true })
  env = { [MEMORY_ROOT_ENV_VAR]: join(parent, "memory") }
})

afterAll(() => {
  rmSync(parent, { recursive: true, force: true })
})

describe("resolveAutoIdentity with real git layouts", () => {
  it("#given git mode #when the main checkout and its worktree resolve #then both share the main checkout's existing id", () => {
    // given
    const pathModeMain = resolveAutoIdentity(main, env)
    // when
    const gitModeMain = resolveAutoIdentity(main, env, "git")
    const gitModeWorktree = resolveAutoIdentity(worktree, env, "git")
    // then
    expect(gitModeMain.id).toBe(pathModeMain.id)
    expect(gitModeWorktree.id).toBe(pathModeMain.id)
    expect(gitModeWorktree.paths.repo).toBe(pathModeMain.paths.repo)
  })

  it("#given git mode #when a worktree subdirectory resolves #then it shares the same subdirectory of the main checkout", () => {
    // given
    const pathModeMainSubdir = resolveAutoIdentity(join(main, "packages", "api"), env)
    // when
    const gitModeWorktreeSubdir = resolveAutoIdentity(join(worktree, "packages", "api"), env, "git")
    // then
    expect(gitModeWorktreeSubdir.id).toBe(pathModeMainSubdir.id)
  })

  it("#given path mode or an auto agent value #when the worktree resolves #then it keeps its own path-derived id", () => {
    // given
    const mainIdentity = resolveAutoIdentity(main, env)
    // when
    const pathMode = resolveAutoIdentity(worktree, env, "path")
    const autoAgent = resolveMemoryIdentity("auto", worktree, env)
    // then
    expect(pathMode.id).not.toBe(mainIdentity.id)
    expect(autoAgent.id).toBe(pathMode.id)
  })

  it("#given git mode #when a directory outside git resolves #then the result matches path mode", () => {
    // given
    const outside = resolveAutoIdentity(plain, env)
    // when
    const outsideGit = resolveAutoIdentity(plain, env, "git")
    // then
    expect(outsideGit.id).toBe(outside.id)
  })

  it("#given a --separate-git-dir clone with a linked worktree #when both resolve in git mode #then each keeps its path id", () => {
    // given
    const root = join(parent, "separate")
    const sepMain = join(root, "main")
    const sepWorktree = join(root, "wt")
    mkdirSync(root)
    git(root, ["init", "--quiet", "--initial-branch=main", `--separate-git-dir=${join(root, "sep.git")}`, sepMain])
    git(sepMain, ["commit", "--quiet", "--allow-empty", "-m", "init"])
    git(sepMain, ["worktree", "add", "--quiet", "-b", "feature", sepWorktree])
    // when
    const mainGit = resolveAutoIdentity(sepMain, env, "git")
    const worktreeGit = resolveAutoIdentity(sepWorktree, env, "git")
    // then
    expect(mainGit.id).toBe(resolveAutoIdentity(sepMain, env).id)
    expect(worktreeGit.id).toBe(resolveAutoIdentity(sepWorktree, env).id)
  })

  it("#given a bare repository with two linked worktrees #when they resolve in git mode #then they share one id named after the repository", () => {
    // given
    const root = join(parent, "bare-layout")
    const bare = join(root, "lib.git")
    mkdirSync(root)
    git(root, ["clone", "--quiet", "--bare", main, bare])
    git(bare, ["worktree", "add", "--quiet", "-b", "one", join(root, "one")])
    git(bare, ["worktree", "add", "--quiet", "-b", "two", join(root, "two")])
    // when
    const one = resolveAutoIdentity(join(root, "one"), env, "git")
    const two = resolveAutoIdentity(join(root, "two"), env, "git")
    // then
    expect(two.id).toBe(one.id)
    expect(one.safeSlug).toBe("lib")
  })

  it("#given a submodule checked out inside a linked worktree #when it resolves in git mode #then it keeps its path id", () => {
    // given
    const library = join(parent, "library")
    mkdirSync(library)
    git(library, ["init", "--quiet", "--initial-branch=main"])
    git(library, ["commit", "--quiet", "--allow-empty", "-m", "lib"])
    const hostWorktree = join(parent, "project-submodule")
    git(main, ["worktree", "add", "--quiet", "-b", "with-submodule", hostWorktree])
    git(hostWorktree, ["-c", "protocol.file.allow=always", "submodule", "add", "--quiet", library, "vendor/library"])
    const submodule = join(hostWorktree, "vendor", "library")
    // when
    const gitMode = resolveAutoIdentity(submodule, env, "git")
    // then
    expect(gitMode.id).toBe(resolveAutoIdentity(submodule, env).id)
  })
})
