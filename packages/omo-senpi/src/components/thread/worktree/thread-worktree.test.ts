import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { gitRepoKit } from "./git-repo.testkit"
import { createThreadWorktree, type GitRun } from "./thread-worktree"

const kit = gitRepoKit()
afterEach(kit.cleanup)

const reasonOf = (outcome: unknown): unknown => (outcome as { error?: { code: string; details?: { reason?: string } } }).error

describe("createThreadWorktree", () => {
  test("#given a repository and a new branch #when the worktree is created #then it is checked out on that branch at HEAD, in OmO's worktrees folder", async () => {
    const repo = kit.repository()
    const root = kit.folder("thread-wt-root-")
    const outcome = await createThreadWorktree({ repository: join(repo, "sub"), request: { branch: "feat/x" }, root })
    if (outcome.kind !== "ok") throw new Error(JSON.stringify(outcome))
    expect(outcome.worktree.path.startsWith(root)).toBe(true)
    expect(outcome.worktree.path.endsWith("feat-x")).toBe(true)
    expect(outcome.worktree.base).toBe(kit.git(repo, "rev-parse", "HEAD"))
    expect(kit.git(outcome.worktree.path, "branch", "--show-current")).toBe("feat/x")
    expect(kit.git(repo, "worktree", "list")).toContain(outcome.worktree.path)
  })

  test("#given no branch #when the worktree is created #then a fresh omo/thread-* branch is generated", async () => {
    const outcome = await createThreadWorktree({ repository: kit.repository(), request: {}, root: kit.folder("thread-wt-root-") })
    if (outcome.kind !== "ok") throw new Error(JSON.stringify(outcome))
    expect(outcome.worktree.branch).toMatch(/^omo\/thread-\d{8}-\d{6}-[0-9a-f]{4}$/)
  })

  test.each([
    ["a folder that is not a git repository", "plain", {}, "invalid_arguments", "not_a_git_repo"],
    ["a folder that does not exist", "missing", {}, "invalid_arguments", "folder_missing"],
    ["a file instead of a folder", "file", {}, "invalid_arguments", "not_a_directory"],
    ["a branch that already exists", "repo", { branch: "main" }, "name_conflict", "branch_exists"],
    ["a base that names no commit", "repo", { base: "no-such-ref" }, "invalid_arguments", "base_not_found"],
    ["an invalid branch name", "repo", { branch: "bad..name" }, "invalid_arguments", "invalid_branch"],
    ["a branch name that looks like an option", "repo", { branch: "-x" }, "invalid_arguments", "invalid_branch"],
  ] as const)("#given %s #when the worktree is created #then it is refused typed and nothing is created", async (_label, kind, request, code, reason) => {
    const repo = kit.repository()
    const root = kit.folder("thread-wt-root-")
    const plain = kit.folder("thread-wt-plain-")
    writeFileSync(join(plain, "f.txt"), "x")
    const target = { repo, plain, missing: join(plain, "nope"), file: join(plain, "f.txt") }[kind]
    const outcome = await createThreadWorktree({ repository: target, request, root })
    expect(reasonOf(outcome)).toMatchObject({ code, details: { reason } })
    expect((outcome as { error: { next_action: string } }).error.next_action.length).toBeGreaterThan(0)
    expect(kit.git(repo, "worktree", "list").split("\n")).toHaveLength(1)
  })

  test("#given the worktree folder already exists #when the worktree is created #then it is name_conflict worktree_path_exists", async () => {
    const repo = kit.repository()
    const root = kit.folder("thread-wt-root-")
    const first = await createThreadWorktree({ repository: repo, request: { branch: "a" }, root })
    if (first.kind !== "ok") throw new Error(JSON.stringify(first))
    kit.git(repo, "worktree", "remove", first.worktree.path)
    kit.git(repo, "branch", "-D", "a")
    mkdirSync(first.worktree.path, { recursive: true })
    const again = await createThreadWorktree({ repository: repo, request: { branch: "a" }, root })
    expect(reasonOf(again)).toMatchObject({ code: "name_conflict", details: { reason: "worktree_path_exists" } })
  })

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "#given a worktrees folder the user cannot write #when the worktree is created #then it is scope_denied permission_denied",
    async () => {
      const root = kit.folder("thread-wt-root-")
      chmodSync(root, 0o500)
      try {
        const outcome = await createThreadWorktree({ repository: kit.repository(), request: { branch: "p" }, root })
        expect(reasonOf(outcome)).toMatchObject({ code: "scope_denied", details: { reason: "permission_denied" } })
      } finally {
        chmodSync(root, 0o700)
      }
    },
  )

  test.each([
    ["git is not installed", { exit: "spawn_failed", stdout: "", stderr: "spawn git ENOENT" }, "unsupported", "git_unavailable"],
    ["git does not answer in time", { exit: "timeout", stdout: "", stderr: "" }, "host_unavailable", "git_timeout"],
    ["the disk is full", { exit: 128, stdout: "", stderr: "fatal: could not write index: No space left on device" }, "host_unavailable", "no_space"],
    ["the branch is checked out elsewhere", { exit: 128, stdout: "", stderr: "fatal: 'x' is already checked out at '/w'" }, "name_conflict", "branch_checked_out"],
    ["git fails for another reason", { exit: 128, stdout: "", stderr: "fatal: something odd" }, "invalid_arguments", "git_failed"],
  ] as const)("#given %s at git worktree add #when the worktree is created #then it is refused typed, never internal_error", async (_label, failure, code, reason) => {
    const repo = kit.repository()
    const git: GitRun = async (args, cwd) => {
      if (args[0] === "worktree") return failure
      const { runGit } = await import("./thread-worktree")
      return runGit(args, cwd)
    }
    const outcome = await createThreadWorktree({ repository: repo, request: { branch: "z" }, root: kit.folder("thread-wt-root-"), git })
    expect(reasonOf(outcome)).toMatchObject({ code, details: { reason } })
  })

  test("#given git is missing entirely #when the worktree is created #then the first git call answers unsupported git_unavailable", async () => {
    const git: GitRun = async () => ({ exit: "spawn_failed", stdout: "", stderr: "spawn git ENOENT" })
    const root = kit.folder("thread-wt-root-")
    const outcome = await createThreadWorktree({ repository: kit.repository(), request: {}, root, git })
    expect(reasonOf(outcome)).toMatchObject({ code: "unsupported", details: { reason: "git_unavailable" } })
    expect(existsSync(join(root, "x"))).toBe(false)
  })
})
