import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { JsonObject, RemoteCommandOutcome, RemoteThreadSurface } from "../remote/ports"
import { createRemoteThreadFixture } from "../thread-remote-fixture"
import { gitRepoKit } from "./git-repo.testkit"
import { answerWorktreeRequest, THREAD_WORKTREE_RPC } from "./worktree-rpc"

const { account, surface, cleanup } = createRemoteThreadFixture()
const kit = gitRepoKit()
const AGENT_DIR_ENV = "OMO_CODING_AGENT_DIR"
let savedAgentDir: string | undefined
let agentDir = ""
beforeEach(() => {
  savedAgentDir = process.env[AGENT_DIR_ENV]
  agentDir = kit.folder("thread-wt-agent-")
  process.env[AGENT_DIR_ENV] = agentDir
})
afterEach(async () => {
  if (savedAgentDir === undefined) delete process.env[AGENT_DIR_ENV]
  else process.env[AGENT_DIR_ENV] = savedAgentDir
  await cleanup()
  kit.cleanup()
})

const failure = (result: unknown) => (result as { error?: { code: string; details?: object } }).error

/** b's own omo answering the worktree request in its worktrees folder, or `farAnswer` in its place. */
function withFarWorktree(remote: RemoteThreadSurface, farRoot: string, farAnswer?: RemoteCommandOutcome) {
  const requests: JsonObject[] = []
  const sessions = remote.sessions
  const wrapped: RemoteThreadSurface = {
    ...remote,
    sessions: {
      ...sessions,
      sessionCommand: async (device, session, rpc, options) => {
        if (rpc["type"] !== "extension_request") return sessions.sessionCommand(device, session, rpc, options)
        requests.push(rpc)
        if (farAnswer !== undefined) return farAnswer
        const data = await answerWorktreeRequest(rpc["data"], farRoot)
        return { kind: "ok", response: { type: "response", success: true, data } }
      },
    },
  }
  return { remote: wrapped, requests }
}

describe("thread_create with worktree on this device", () => {
  test("#given a repository #when thread_create asks for a worktree #then the worktree is created under the agent dir and the thread opens in it", async () => {
    const repo = kit.repository()
    const { run, openSession } = surface(account().remote)
    const result = await run("thread_create", { cwd: repo, worktree: { branch: "feat/thread" } })
    expect(result).toMatchObject({ kind: "ok", thread: { worktree: { branch: "feat/thread", repository: repo } } })
    const path = (result as unknown as { thread: { worktree: { path: string } } }).thread.worktree.path
    expect(path.startsWith(agentDir)).toBe(true)
    expect(openSession.mock.calls.map((call) => call[0])).toEqual([{ cwd: path }])
    expect(kit.git(path, "branch", "--show-current")).toBe("feat/thread")
  })

  test("#given the branch already exists #when thread_create asks for it #then name_conflict branch_exists and no thread opens", async () => {
    const { run, openSession } = surface(account().remote)
    const result = await run("thread_create", { cwd: kit.repository(), worktree: { branch: "main" } })
    expect(failure(result)).toMatchObject({ code: "name_conflict", details: { reason: "branch_exists" } })
    expect(openSession).not.toHaveBeenCalled()
  })

  test("#given an existing thread #when thread_create names it with a worktree #then invalid_arguments and nothing opens", async () => {
    const { run, openSession } = surface(account().remote)
    const result = await run("thread_create", { thread: "dur-local", worktree: {} })
    expect(failure(result)).toMatchObject({ code: "invalid_arguments" })
    expect(openSession).not.toHaveBeenCalled()
  })
})

describe("thread_create with worktree on another device", () => {
  test("#given b's omo answers the worktree request #when thread_create targets b #then b creates the worktree, its setup session is closed, and the thread opens in the worktree on b", async () => {
    const repo = kit.repository()
    const a = account()
    const far = withFarWorktree(a.remote, kit.folder("thread-wt-far-"))
    const { run, openSession } = surface(far.remote)
    const result = await run("thread_create", { device: "studio", cwd: repo, worktree: { branch: "remote/x" } })
    expect(result).toMatchObject({ kind: "ok", thread: { device: "b", worktree: { branch: "remote/x" } } })
    const worktree = (result as unknown as { thread: { worktree: { path: string; setup_session_left_open?: string } } }).thread.worktree
    expect(worktree.setup_session_left_open).toBeUndefined()
    expect(far.requests.map((rpc) => rpc["name"])).toEqual([THREAD_WORKTREE_RPC])
    const opens = a.sent.filter((entry) => entry.rpc?.["type"] === "open_session").map((entry) => entry.rpc?.["cwd"])
    expect(opens).toEqual([repo, worktree.path])
    expect(a.sent.some((entry) => entry.rpc?.["type"] === "unload_session")).toBe(true)
    expect(openSession).not.toHaveBeenCalled()
  })

  test("#given b's omo predates the worktree request #when thread_create targets b #then unsupported asks to update omo on b, and no thread opens", async () => {
    const a = account()
    const older = { kind: "refused", reason: `Unknown extension RPC request: ${THREAD_WORKTREE_RPC}` } as const
    const far = withFarWorktree(a.remote, kit.folder("thread-wt-far-"), older)
    const { run } = surface(far.remote)
    const result = await run("thread_create", { device: "studio", cwd: "/repo/on/b", worktree: {} })
    expect(failure(result)).toMatchObject({ code: "unsupported", details: { device: "b" } })
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "open_session")).toHaveLength(1)
  })

  test("#given b refuses the worktree (branch exists there) #when thread_create targets b #then b's typed failure is the answer, naming b", async () => {
    const repo = kit.repository()
    const a = account()
    const far = withFarWorktree(a.remote, kit.folder("thread-wt-far-"))
    const { run } = surface(far.remote)
    const result = await run("thread_create", { device: "studio", cwd: repo, worktree: { branch: "main" } })
    expect(failure(result)).toMatchObject({ code: "name_conflict", details: { reason: "branch_exists", device: "b" } })
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "open_session")).toHaveLength(1)
  })

  test("#given no cwd #when a worktree is asked for on b #then invalid_arguments relative_path and nothing reaches b", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(failure(await run("thread_create", { device: "studio", worktree: {} }))).toMatchObject({
      code: "invalid_arguments",
      details: { reason: "relative_path", device: "b" },
    })
    expect(a.sent).toEqual([])
  })

  test("#given b has no such repository folder #when a worktree is asked for there #then invalid_arguments folder_missing naming b", async () => {
    const a = account({ refuse: "missing_session_cwd" })
    const { run } = surface(a.remote)
    expect(failure(await run("thread_create", { device: "studio", cwd: "/gone", worktree: {} }))).toMatchObject({
      code: "invalid_arguments",
      details: { reason: "folder_missing", device: "b" },
    })
  })
})
