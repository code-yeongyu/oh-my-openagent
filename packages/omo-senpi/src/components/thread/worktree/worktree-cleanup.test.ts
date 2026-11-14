import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { createLocalSessionHost } from "../control/local-session-host"
import type { ThreadHost } from "../tools/ports"
import { createRemoteThreadFixture } from "../thread-remote-fixture"
import type { RemoteThreadSurface } from "../remote/ports"
import { gitRepoKit } from "./git-repo.testkit"
import { createThreadWorktree, runGit, type GitRun } from "./thread-worktree"
import { answerWorktreeRequest } from "./worktree-rpc"

const kit = gitRepoKit()
const { account, surface, cleanup } = createRemoteThreadFixture()
const AGENT_DIR_ENV = "OMO_CODING_AGENT_DIR"
let savedAgentDir: string | undefined
beforeEach(() => {
  savedAgentDir = process.env[AGENT_DIR_ENV]
})
afterEach(async () => {
  if (savedAgentDir === undefined) delete process.env[AGENT_DIR_ENV]
  else process.env[AGENT_DIR_ENV] = savedAgentDir
  await cleanup()
  kit.cleanup()
})

const errorOf = (outcome: unknown) => (outcome as { error?: { code: string; details?: Record<string, unknown> } }).error
const branchExists = (repo: string, branch: string): boolean =>
  kit.git(repo, "branch", "--list", branch).length > 0
const worktreeCount = (repo: string): number => kit.git(repo, "worktree", "list").split("\n").length

describe("L1: a worktree create that fails part way leaves nothing behind", () => {
  test("#given git is killed by its timeout after it made the branch and the checkout #when the worktree is created #then git_timeout, and the branch, the checkout and the folder this call made are gone, so a retry succeeds", async () => {
    const repo = kit.repository()
    const root = kit.folder("thread-wt-root-")
    const slowGit: GitRun = async (args, cwd) => {
      if (args[0] !== "worktree" || args[1] !== "add") return runGit(args, cwd)
      await runGit(args, cwd)
      return { exit: "timeout", stdout: "", stderr: "" }
    }
    const failed = await createThreadWorktree({ repository: repo, request: { branch: "slow" }, root, git: slowGit })
    expect(errorOf(failed)).toMatchObject({ code: "host_unavailable", details: { reason: "git_timeout" } })
    const path = String(errorOf(failed)?.details?.["path"])
    expect([branchExists(repo, "slow"), existsSync(path), existsSync(dirname(path)), worktreeCount(repo)]).toEqual([
      false,
      false,
      false,
      1,
    ])
    expect(await createThreadWorktree({ repository: repo, request: { branch: "slow" }, root })).toMatchObject({ kind: "ok" })
  })
})

describe("M1: a worktree made for a thread whose open fails is removed", () => {
  const failingHost = (error: Error): ThreadHost =>
    ({ openSession: async () => Promise.reject(error) }) as unknown as ThreadHost

  test("#given this device's open fails after the worktree was made #when the thread is created #then the open's failure stands and the worktree and its branch are removed", async () => {
    const repo = kit.repository()
    const root = kit.folder("thread-wt-root-")
    const host = createLocalSessionHost(failingHost(new Error("host_unavailable:/tmp/x.sock")), [], () => root)
    await expect(host.open({ cwd: repo, worktree: { branch: "lost" } })).rejects.toThrow("host_unavailable")
    expect([branchExists(repo, "lost"), worktreeCount(repo)]).toEqual([false, 1])
  })

  test("#given this device's open fails and the worktree cannot be removed #when the thread is created #then partial_commit names the worktree path and branch left behind", async () => {
    const repo = kit.repository()
    const root = kit.folder("thread-wt-root-")
    let made = ""
    const host = createLocalSessionHost(
      {
        openSession: async (request: { cwd?: string }) => {
          made = request.cwd ?? ""
          kit.git(made, "commit", "--allow-empty", "-q", "-m", "keep")
          kit.git(repo, "worktree", "lock", made)
          throw new Error("open refused")
        },
      } as unknown as ThreadHost,
      [],
      () => root,
    )
    const result = await host.open({ cwd: repo, worktree: { branch: "stuck" } })
    expect(errorOf(result)).toMatchObject({
      code: "partial_commit",
      details: { reason: "worktree_left_behind", path: made, branch: "stuck" },
    })
    kit.git(repo, "worktree", "unlock", made)
  })

  test("#given b made the worktree and then refused the thread's open #when the thread is created on b #then b's worktree and branch are removed and the refusal is the answer", async () => {
    const repo = kit.repository()
    const farRoot = kit.folder("thread-wt-far-")
    const a = account()
    const sessions = a.remote.sessions
    let opens = 0
    const far: RemoteThreadSurface = {
      ...a.remote,
      sessions: {
        ...sessions,
        endpointCommand: async (device, rpc, options) => {
          if (rpc["type"] === "open_session" && ++opens === 2) return { kind: "refused", reason: "capability_missing" }
          return sessions.endpointCommand(device, rpc, options)
        },
        sessionCommand: async (device, session, rpc, options) => {
          if (rpc["type"] !== "extension_request") return sessions.sessionCommand(device, session, rpc, options)
          const data = await answerWorktreeRequest(rpc["data"], farRoot)
          return { kind: "ok", response: { type: "response", success: true, data } }
        },
      },
    }
    const { run } = surface(far)
    const result = await run("thread_create", { device: "studio", cwd: repo, worktree: { branch: "far-lost" } })
    expect(errorOf(result)).toMatchObject({ code: "scope_denied", details: { device: "b" } })
    expect([branchExists(repo, "far-lost"), worktreeCount(repo)]).toEqual([false, 1])
    expect(existsSync(join(farRoot, "x"))).toBe(false)
  })

  test("#given b refused the thread's open and then could not remove its worktree #when the thread is created on b #then the refusal names the worktree left on b and the cleanup failure", async () => {
    const repo = kit.repository()
    const farRoot = kit.folder("thread-wt-far-")
    const a = account()
    const sessions = a.remote.sessions
    let opens = 0
    const far: RemoteThreadSurface = {
      ...a.remote,
      sessions: {
        ...sessions,
        endpointCommand: async (device, rpc, options) => {
          if (rpc["type"] === "open_session" && ++opens === 2) return { kind: "refused", reason: "capability_missing" }
          return sessions.endpointCommand(device, rpc, options)
        },
        sessionCommand: async (device, session, rpc, options) => {
          if (rpc["type"] !== "extension_request") return sessions.sessionCommand(device, session, rpc, options)
          const asked = rpc["data"] as Record<string, unknown>
          if (asked["remove"] !== undefined) return { kind: "refused", reason: "request_timeout" }
          const data = await answerWorktreeRequest(asked, farRoot)
          return { kind: "ok", response: { type: "response", success: true, data } }
        },
      },
    }
    const result = await surface(far).run("thread_create", { device: "studio", cwd: repo, worktree: { branch: "far-kept" } })
    expect(errorOf(result)).toMatchObject({
      code: "scope_denied",
      details: {
        worktree: { branch: "far-kept", repository: repo },
        cleanup: { code: "partial_commit", details: { reason: "worktree_left_behind", branch: "far-kept", device: "b" } },
      },
    })
    expect(branchExists(repo, "far-kept")).toBe(true)
  })
})

describe("the remove request another device sends removes only a worktree OmO made there", () => {
  test.each([
    ["a worktree outside this device's worktrees folder", "outside"],
    ["a worktree whose branch is not the one named", "branch"],
    ["a relative path", "relative"],
  ] as const)("#given %s #when removal is requested #then it is refused and the worktree stays", async (_label, kind) => {
    const repo = kit.repository()
    const root = kit.folder("thread-wt-root-")
    const made = await createThreadWorktree({ repository: repo, request: { branch: "keep-me" }, root })
    if (made.kind !== "ok") throw new Error(JSON.stringify(made))
    const outside = join(kit.folder("thread-wt-user-"), "wt")
    kit.git(repo, "worktree", "add", "-q", "-b", "user-branch", outside)
    const remove = {
      outside: { path: outside, branch: "user-branch" },
      branch: { path: made.worktree.path, branch: "main" },
      relative: { path: "wt", branch: "keep-me" },
    }[kind]
    const outcome = await answerWorktreeRequest({ remove }, root)
    expect(outcome.kind).toBe("error")
    expect([existsSync(made.worktree.path), existsSync(outside), worktreeCount(repo)]).toEqual([true, true, 3])
  })

  test("#given the worktree a failed open left #when removal is requested with its path and branch #then it and its branch are removed", async () => {
    const repo = kit.repository()
    const root = kit.folder("thread-wt-root-")
    const made = await createThreadWorktree({ repository: repo, request: { branch: "drop-me" }, root })
    if (made.kind !== "ok") throw new Error(JSON.stringify(made))
    expect(await answerWorktreeRequest({ remove: { path: made.worktree.path, branch: "drop-me" } }, root)).toEqual({ kind: "removed" })
    expect([existsSync(made.worktree.path), branchExists(repo, "drop-me"), worktreeCount(repo)]).toEqual([false, false, 1])
  })
})

describe("L2: the worktree request another device sends", () => {
  test("#given a relative repository folder #when the request is answered #then invalid_arguments relative_path and no git runs", async () => {
    let ran = false
    const outcome = await answerWorktreeRequest({ cwd: "repo/sub" }, kit.folder("thread-wt-root-"), async () => {
      ran = true
      return { exit: 0, stdout: "", stderr: "" }
    })
    expect(errorOf(outcome)).toMatchObject({ code: "invalid_arguments", details: { reason: "relative_path" } })
    expect(ran).toBe(false)
  })
})
