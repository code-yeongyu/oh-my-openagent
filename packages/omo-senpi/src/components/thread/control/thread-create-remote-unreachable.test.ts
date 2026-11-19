import { afterEach, describe, expect, test } from "bun:test"
import type { RemoteThreadSurface } from "../remote/ports"
import { B_FILE, createRemoteThreadFixture } from "../thread-remote-fixture"
import { gitRepoKit } from "../worktree/git-repo.testkit"
import { answerWorktreeRequest } from "../worktree/worktree-rpc"

// #14394: b is online and its engine takes the open, but b's route never lists the session it made (the Desktop app's
// host). Nothing can address that thread: its name is not applied, its first prompt cannot be delivered, and no tool
// reaches it. The create must not answer ok with an orphan thread: it ends what it opened and refuses, typed.
const { account, surface, cleanup } = createRemoteThreadFixture()
const kit = gitRepoKit()
afterEach(async () => {
  await cleanup()
  kit.cleanup()
})

// b's engine holds the file of the session it made, as it does every session it opened.
const UNROUTED_FILES = { "dur-on-b": B_FILE, "dur-new-on-b": "/home/b/.omo/agent/sessions/dur-new-on-b.jsonl" }
type Sent = ReturnType<typeof account>["sent"]
const endpointUnloads = (sent: Sent) =>
  sent.filter((entry) => entry.via === "endpoint" && entry.rpc?.["type"] === "unload_session")
const admissions = (sent: Sent) => sent.filter((entry) => entry.rpc?.["type"] === "admit_external_message")

describe("thread_create on a device whose route does not reach the session it opened (#14394)", () => {
  test.each([
    ["a name and a first prompt", { name: "remote-lane", prompt: "go" }],
    ["a first prompt only", { prompt: "go" }],
  ] as const)(
    "#given b's engine takes the open but b's route never lists the new session #when thread_create runs on b with %s #then host_unavailable naming b, the session ended there, and no prompt sent",
    async (_case, args) => {
      const a = account({ openUnrouted: true, unlistedReason: "route_unlisted", sessionFiles: UNROUTED_FILES })
      const { run } = surface(a.remote)
      expect(await run("thread_create", { device: "studio", ...args })).toMatchObject({
        kind: "error",
        error: { code: "host_unavailable", details: { device: "b", reason: "route_unlisted", created: false } },
      })
      expect(endpointUnloads(a.sent).map((entry) => entry.rpc?.["sessionId"])).toEqual(["rpc-9"])
      expect(admissions(a.sent)).toEqual([])
    },
  )

  test("#given the same device #when thread_create runs on b again under the same key #then the same refusal and still one open", async () => {
    const a = account({ openUnrouted: true, unlistedReason: "route_unlisted", sessionFiles: UNROUTED_FILES })
    const { run } = surface(a.remote)
    const args = { device: "studio", prompt: "go", idempotency_key: "remote-create-1" }
    const first = await run("thread_create", args)
    expect(first).toMatchObject({ kind: "error", error: { code: "host_unavailable" } })
    expect(await run("thread_create", args)).toEqual(first)
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "open_session")).toHaveLength(1)
  })

  // #14397 review M1: a create with a worktree made that worktree on b before the open; refusing the create removes it,
  // and a removal that fails says so, naming what is left, instead of claiming nothing was left behind.
  const withFarWorktrees = (
    a: ReturnType<typeof account>,
    farRoot: string,
    removal: "answers" | "fails",
  ): RemoteThreadSurface => ({
    ...a.remote,
    sessions: {
      ...a.remote.sessions,
      sessionCommand: async (device, session, rpc, options) => {
        if (rpc["type"] !== "extension_request") return a.remote.sessions.sessionCommand(device, session, rpc, options)
        const asked = rpc["data"] as Record<string, unknown>
        if (asked["remove"] !== undefined && removal === "fails") return { kind: "refused", reason: "request_timeout" }
        return {
          kind: "ok",
          response: { type: "response", success: true, data: await answerWorktreeRequest(asked, farRoot) },
        }
      },
    },
  })

  test("#given b's route never lists the new session #when thread_create runs on b with a worktree #then the refusal removes that worktree from b, and nothing is left behind", async () => {
    const repo = kit.repository()
    const a = account({ openUnrouted: true, unlistedReason: "route_unlisted", sessionFiles: UNROUTED_FILES })
    const result = await surface(withFarWorktrees(a, kit.folder("thread-wt-far-"), "answers")).run("thread_create", {
      device: "studio",
      name: "remote-lane",
      cwd: repo,
      worktree: { branch: "far-unrouted" },
    })

    expect(result).toMatchObject({ kind: "error", error: { code: "host_unavailable", details: { created: false } } })
    expect(result).not.toMatchObject({ error: { details: { worktree: expect.anything() } } })
    expect(kit.git(repo, "branch", "--list", "far-unrouted")).toBe("")
  })

  test("#given the same, and b does not remove the worktree #when thread_create runs on b with a worktree #then the refusal names the worktree left on b and the cleanup failure", async () => {
    const repo = kit.repository()
    const a = account({ openUnrouted: true, unlistedReason: "route_unlisted", sessionFiles: UNROUTED_FILES })
    const result = await surface(withFarWorktrees(a, kit.folder("thread-wt-far-"), "fails")).run("thread_create", {
      device: "studio",
      name: "remote-lane",
      cwd: repo,
      worktree: { branch: "far-left" },
    })

    expect(result).toMatchObject({
      kind: "error",
      error: {
        code: "host_unavailable",
        message: expect.stringContaining("worktree"),
        details: {
          created: false,
          worktree: { branch: "far-left" },
          cleanup: { details: { reason: "worktree_left_behind" } },
        },
      },
    })
    expect(result).not.toMatchObject({ error: { message: expect.stringContaining("Nothing was left behind") } })
  })

  // #14397 review L2: an open whose reply names no routing id cannot be ended through the endpoint; the refusal says
  // that, never that ending it failed.
  test("#given b's open reply names no routing id and b's route never lists the session #when thread_create runs on b #then the refusal says the session could not be ended because b named no routing id", async () => {
    const a = account({
      openUnrouted: true,
      unlistedReason: "route_unlisted",
      sessionFiles: UNROUTED_FILES,
      openData: { state: { durableSessionId: "dur-new-on-b" } },
    })
    const result = await surface(a.remote).run("thread_create", { device: "studio", name: "remote-lane" })

    expect(result).toMatchObject({
      kind: "error",
      error: {
        code: "host_unavailable",
        details: { created: true, reason: "route_unlisted", unload: "no_routing_id" },
      },
    })
    expect(endpointUnloads(a.sent)).toEqual([])
  })

  // #14397 review L1: a create with an alias only (no name, no prompt) reaches the open too; it is checked the same way.
  test("#given b's route never lists the new session #when thread_create runs on b with an alias only #then host_unavailable and the session ended there", async () => {
    const a = account({ openUnrouted: true, unlistedReason: "route_unlisted", sessionFiles: UNROUTED_FILES })
    const result = await surface(a.remote).run("thread_create", { device: "studio", alias: "remote-alias-only" })

    expect(result).toMatchObject({ kind: "error", error: { code: "host_unavailable", details: { created: false } } })
    expect(endpointUnloads(a.sent).map((entry) => entry.rpc?.["sessionId"])).toEqual(["rpc-9"])
  })
})

// #14397 review L3: a session b just opened can be refused route_unlisted once before b's route lists it. That one reply
// must not end a healthy session: the create asks b where the session is and tries once more before it ends anything.
describe("thread_create on a device whose route lists a new session a moment late (#14397 review L3)", () => {
  test.each([
    ["a name", { name: "late-lane" }],
    ["a first prompt", { prompt: "go" }],
  ] as const)(
    "#given b's route refuses the new session once, then lists it #when thread_create runs on b with %s #then the thread is created and nothing is ended",
    async (_case, args) => {
      const a = account({ routeLag: 1, unlistedReason: "route_unlisted" })
      const result = await surface(a.remote).run("thread_create", { device: "studio", ...args })

      expect(result).toMatchObject({ kind: "ok", device: "b" })
      expect(endpointUnloads(a.sent)).toEqual([])
    },
  )
})
