import { afterEach, describe, expect, test } from "bun:test"
import type { RemoteThreadSurface } from "../remote/ports"
import { createRemoteThreadFixture } from "../thread-remote-fixture"
import { gitRepoKit } from "../worktree/git-repo.testkit"
import { answerWorktreeRequest } from "../worktree/worktree-rpc"
import { createdThreadId } from "./session-host"

// A create on another device whose open_session reply is lost (the caller's budget ran out while b's engine was still
// answering, and b dropped the late result for the closed connection): b made the session, so thread_create must find
// it by the id the call's idempotency key derives, on the spot or on a retry under the same key, never answer it
// uncertain once b lists it, and never open a second session.
const { account, surface, cleanup } = createRemoteThreadFixture()
const kit = gitRepoKit()
afterEach(async () => {
  await cleanup()
  kit.cleanup()
})

// b answers worktree requests from a real repository under farRoot, as its engine's worktree extension does.
const withFarWorktrees = (a: ReturnType<typeof account>, farRoot: string): RemoteThreadSurface => ({
  ...a.remote,
  sessions: {
    ...a.remote.sessions,
    sessionCommand: async (device, session, rpc, options) => {
      if (rpc["type"] !== "extension_request") return a.remote.sessions.sessionCommand(device, session, rpc, options)
      return {
        kind: "ok",
        response: {
          type: "response",
          success: true,
          data: await answerWorktreeRequest(rpc["data"] as Record<string, unknown>, farRoot),
        },
      }
    },
  },
})

// #14623 review M4: b's listing serves only its cached snapshot (b did not answer this round), and every command to a
// session there is refused because b cannot be reached.
const cachedAndUnreachable = (
  a: ReturnType<typeof account>,
  options: { readonly cached: boolean; readonly unreachable: boolean },
): RemoteThreadSurface => ({
  ...a.remote,
  sessions: {
    ...a.remote.sessions,
    sessions: async (query) =>
      (await a.remote.sessions.sessions(query)).map((row) =>
        options.cached ? { ...row, source: "cache" as const, as_of: 0 } : row,
      ),
    sessionCommand: async (device, session, rpc, commandOptions) =>
      options.unreachable
        ? { kind: "refused", reason: "peer_not_found" }
        : a.remote.sessions.sessionCommand(device, session, rpc, commandOptions),
  },
})

// #14623 review round 2 M4: b's route answers the first `unlisted` commands route_unlisted (a session b opened a moment
// ago may not be routed yet), and every later command never reaches b (request_timeout).
const unlistedThenUnreachable = (
  a: ReturnType<typeof account>,
  unlisted: number,
  then: "unreachable" | "routed" = "unreachable",
): RemoteThreadSurface => {
  let commands = 0
  return {
    ...a.remote,
    sessions: {
      ...a.remote.sessions,
      sessionCommand: async (device, session, rpc, options) => {
        commands++
        if (commands <= unlisted) return { kind: "refused", reason: "route_unlisted" }
        return then === "routed"
          ? a.remote.sessions.sessionCommand(device, session, rpc, options)
          : { kind: "refused", reason: "request_timeout" }
      },
    },
  }
}

const opens = (sent: readonly { rpc?: Record<string, unknown> }[]) =>
  sent.filter((entry) => entry.rpc?.["type"] === "open_session")
const toSession = (
  sent: readonly { session?: string; rpc?: Record<string, unknown> }[],
  session: string,
  type: string,
) => sent.filter((entry) => entry.session === session && entry.rpc?.["type"] === type).length

describe("thread_create on another device survives a lost open reply", () => {
  test("#given b makes the session but the open's reply is lost #when thread_create runs on b #then it answers that thread by the derived id, names it, and b opened one session", async () => {
    const a = account({ openLosesReply: 1 })
    const { run } = surface(a.remote)
    const id = createdThreadId("dur-caller", "remote-lost-1")

    const result = await run("thread_create", { device: "studio", name: "lost-on-b", idempotency_key: "remote-lost-1" })

    expect(result).toMatchObject({ kind: "ok", thread: id, device: "b", name: "lost-on-b" })
    expect(opens(a.sent).map((entry) => entry.rpc?.["durableSessionId"])).toEqual([id])
    expect(toSession(a.sent, `rk-${id}`, "set_session_name")).toBe(1)
  })

  test("#given the lost reply also fails the call #when it is retried under the same key #then the retry answers the same thread, opens nothing new and admits the prompt once", async () => {
    const a = account({ openLosesReply: 1, listFailsAfterLostReply: true })
    const { run } = surface(a.remote)
    const args = { device: "studio", name: "lost-twice", prompt: "build it", idempotency_key: "remote-lost-2" }
    const id = createdThreadId("dur-caller", "remote-lost-2")

    expect(await run("thread_create", args)).toMatchObject({ kind: "error", error: { code: "idempotency_uncertain" } })
    const retry = await run("thread_create", args)

    expect(retry).toMatchObject({ kind: "ok", thread: id, device: "b", name: "lost-twice" })
    expect(opens(a.sent)).toHaveLength(1)
    expect(toSession(a.sent, `rk-${id}`, "admit_external_message") + toSession(a.sent, `rk-${id}`, "prompt")).toBe(1)
  })

  // #14623 review H1: the recovered answer is recorded, so the next same-key call replays it and runs nothing.
  test("#given a lost-open create recovered by a same-key retry #when the key is called a third time #then it replays the recovered thread without listing, opening or prompting again", async () => {
    const a = account({ openLosesReply: 1, listFailsAfterLostReply: true })
    const { run } = surface(a.remote)
    const args = { device: "studio", name: "lost-replay", prompt: "build it", idempotency_key: "remote-lost-replay" }

    expect(await run("thread_create", args)).toMatchObject({ kind: "error", error: { code: "idempotency_uncertain" } })
    const recovered = await run("thread_create", args)
    if (recovered.kind !== "ok") throw new Error(`the recovery did not answer ok: ${JSON.stringify(recovered)}`)
    const sentBefore = a.sent.length

    // A same-key create replay answers deduplicated (d9f50119d7); everything else is the recorded answer.
    expect(await run("thread_create", args)).toEqual({ ...recovered, deduplicated: true })
    expect(a.sent.length).toBe(sentBefore)
  })

  test.each([
    ["b's listing is only its cached snapshot", { cached: true, unreachable: false }, { name: "lost-cached" }],
    ["b lists the session but cannot be reached", { cached: false, unreachable: true }, { name: "lost-offline" }],
    ["b's cached row names it and b cannot be reached", { cached: true, unreachable: true }, { name: "lost-stale" }],
  ] as const)(
    "#given a lost-open create #when it is retried while %s #then the retry stays idempotency_uncertain instead of adopting",
    async (_label, options, named) => {
      const a = account({ openLosesReply: 1, listFailsAfterLostReply: true })
      const { run } = surface(cachedAndUnreachable(a, options))
      const args = {
        device: "studio",
        ...named,
        idempotency_key: `remote-lost-m4-${options.cached}-${options.unreachable}`,
      }

      expect(await run("thread_create", args)).toMatchObject({
        kind: "error",
        error: { code: "idempotency_uncertain" },
      })
      expect(await run("thread_create", args)).toMatchObject({
        kind: "error",
        error: { code: "idempotency_uncertain" },
      })
      expect(opens(a.sent)).toHaveLength(1)
    },
  )

  test.each([
    ["the name step's retry through b's route never reaches b", { name: "lost-mixed" }, 2],
    ["the unnamed create's reach check after it never reaches b", {}, 1],
  ] as const)(
    "#given a lost-open create whose adoption first sees route_unlisted #when %s #then the retry stays idempotency_uncertain",
    async (_label, named, unlisted) => {
      const a = account({ openLosesReply: 1, listFailsAfterLostReply: true })
      const { run } = surface(unlistedThenUnreachable(a, unlisted))
      const args = { device: "studio", ...named, prompt: "build it", idempotency_key: `remote-lost-mixed-${unlisted}` }

      expect(await run("thread_create", args)).toMatchObject({
        kind: "error",
        error: { code: "idempotency_uncertain" },
      })
      expect(await run("thread_create", args)).toMatchObject({
        kind: "error",
        error: { code: "idempotency_uncertain" },
      })
      // Not replayed as a success either: the next call under the key is uncertain again.
      expect(await run("thread_create", args)).toMatchObject({
        kind: "error",
        error: { code: "idempotency_uncertain" },
      })
      expect(opens(a.sent)).toHaveLength(1)
    },
  )

  test("#given a lost-open create whose adoption first sees route_unlisted #when b's route then answers the name step #then the retry adopts b's session", async () => {
    const a = account({ openLosesReply: 1, listFailsAfterLostReply: true })
    const { run } = surface(unlistedThenUnreachable(a, 2, "routed"))
    const args = { device: "studio", name: "lost-lagged", idempotency_key: "remote-lost-lagged" }

    expect(await run("thread_create", args)).toMatchObject({ kind: "error", error: { code: "idempotency_uncertain" } })
    expect(await run("thread_create", args)).toMatchObject({
      kind: "ok",
      thread: createdThreadId("dur-caller", "remote-lost-lagged"),
      name: "lost-lagged",
    })
    expect(opens(a.sent)).toHaveLength(1)
  })

  test("#given an uncertain create #when two same-key retries overlap #then one runs the recovery and the other is idempotency_in_progress", async () => {
    const a = account({ openLosesReply: 1, listFailsAfterLostReply: true })
    const { run } = surface(a.remote)
    const args = { device: "studio", name: "lost-overlap", prompt: "build it", idempotency_key: "remote-lost-overlap" }
    const id = createdThreadId("dur-caller", "remote-lost-overlap")

    expect(await run("thread_create", args)).toMatchObject({ kind: "error", error: { code: "idempotency_uncertain" } })
    const answers = await Promise.all([run("thread_create", args), run("thread_create", args)])

    expect(answers.map((answer) => (answer.kind === "ok" ? "ok" : answer.error.code)).sort()).toEqual([
      "idempotency_in_progress",
      "ok",
    ])
    expect(toSession(a.sent, `rk-${id}`, "admit_external_message") + toSession(a.sent, `rk-${id}`, "prompt")).toBe(1)
  })

  // #14623 review round 2 H1: the store committed the RECOVERY reservation but its reply was lost (the worker exited).
  // The next same-key call resumes it as the recovery it is: adoption with the first cause, never a fresh second open.
  test("#given an uncertain remote create whose recovery reservation's admission reply is lost #when the key is called again #then it adopts b's session and b opened one session", async () => {
    const a = account({ openLosesReply: 1, listFailsAfterLostReply: true })
    const { run } = surface(a.remote, { loseAdmissionReply: 2 })
    const args = { device: "studio", name: "lost-admit", prompt: "build it", idempotency_key: "remote-lost-admit" }
    const id = createdThreadId("dur-caller", "remote-lost-admit")

    expect(await run("thread_create", args)).toMatchObject({ kind: "error", error: { code: "idempotency_uncertain" } })
    expect(await run("thread_create", args)).toMatchObject({ kind: "error", error: { code: "internal_error" } })
    expect(await run("thread_create", args)).toMatchObject({ kind: "ok", thread: id, device: "b" })

    expect(opens(a.sent)).toHaveLength(1)
    expect(toSession(a.sent, `rk-${id}`, "admit_external_message") + toSession(a.sent, `rk-${id}`, "prompt")).toBe(1)
  })

  test("#given b ignores the derived id and the recovery reservation's admission reply is lost #when the key is called again #then it stays idempotency_uncertain under the first cause and opens nothing", async () => {
    const a = account({ openLosesReply: 1, ignoresDurableSessionId: true })
    const { run } = surface(a.remote, { loseAdmissionReply: 2 })
    const args = { device: "studio", name: "lost-admit-cause", idempotency_key: "remote-lost-admit-cause" }

    const first = await run("thread_create", args)
    if (first.kind !== "error") throw new Error(`the first create did not fail: ${JSON.stringify(first)}`)
    expect(await run("thread_create", args)).toMatchObject({ kind: "error", error: { code: "internal_error" } })
    expect(await run("thread_create", args)).toMatchObject({
      kind: "error",
      error: { code: "idempotency_uncertain", details: { error_note: first.error.message } },
    })
    expect(opens(a.sent)).toHaveLength(1)
  })

  test("#given a lost recovery-reservation reply #when two same-key calls follow at once #then one resumes the recovery, the other is idempotency_in_progress, and b opened one session", async () => {
    const a = account({ openLosesReply: 1, listFailsAfterLostReply: true })
    const { run } = surface(a.remote, { loseAdmissionReply: 2 })
    const args = { device: "studio", name: "lost-admit-overlap", idempotency_key: "remote-lost-admit-overlap" }

    expect(await run("thread_create", args)).toMatchObject({ kind: "error", error: { code: "idempotency_uncertain" } })
    expect(await run("thread_create", args)).toMatchObject({ kind: "error", error: { code: "internal_error" } })
    const answers = await Promise.all([run("thread_create", args), run("thread_create", args)])

    expect(answers.map((answer) => (answer.kind === "ok" ? "ok" : answer.error.code)).sort()).toEqual([
      "idempotency_in_progress",
      "ok",
    ])
    expect(opens(a.sent)).toHaveLength(1)
  })

  test("#given b's engine ignores the derived id and the reply is lost #when the create is retried under the same key #then idempotency_uncertain and no second open", async () => {
    const a = account({ openLosesReply: 1, ignoresDurableSessionId: true })
    const { run } = surface(a.remote)
    const args = { device: "studio", name: "no-capability", idempotency_key: "remote-lost-3" }

    expect(await run("thread_create", args)).toMatchObject({ kind: "error", error: { code: "idempotency_uncertain" } })
    expect(await run("thread_create", args)).toMatchObject({ kind: "error", error: { code: "idempotency_uncertain" } })
    expect(opens(a.sent)).toHaveLength(1)
  })
})

// #14569: a same-key recovery answers what the first create would have, keeps the first uncertain cause, and an
// adopted session its route does not reach is ended and never settles the receipt as a final answer.
describe("thread_create same-key recovery on another device (#14569)", () => {
  test("#given a create with a worktree whose open reply is lost and b cannot be listed #when it is retried under the same key #then the retry answers the thread with that worktree", async () => {
    const repo = kit.repository()
    const a = account({ openLosesReply: 1, listFailsAfterLostReply: true })
    const { run } = surface(withFarWorktrees(a, kit.folder("thread-wt-far-")))
    const args = {
      device: "studio",
      name: "lost-wt",
      cwd: repo,
      worktree: { branch: "far-lost" },
      idempotency_key: "remote-lost-wt",
    }

    const first = await run("thread_create", args)
    expect(first).toMatchObject({
      kind: "error",
      error: { code: "idempotency_uncertain", details: { worktree: { branch: "far-lost" } } },
    })
    const retry = await run("thread_create", args)

    expect(retry).toMatchObject({
      kind: "ok",
      thread: createdThreadId("dur-caller", "remote-lost-wt"),
      worktree: { branch: "far-lost" },
    })
    // One create open; the other open is the worktree's short-lived setup session.
    expect(opens(a.sent).filter((entry) => entry.rpc?.["durableSessionId"] !== undefined)).toHaveLength(1)
  })

  test("#given b ignores the derived id and the reply is lost #when the create is retried twice under the same key #then each retry names the first uncertain cause", async () => {
    const a = account({ openLosesReply: 1, ignoresDurableSessionId: true })
    const { run } = surface(a.remote)
    const args = { device: "studio", name: "first-cause", idempotency_key: "remote-lost-cause" }

    const first = await run("thread_create", args)
    expect(first).toMatchObject({ kind: "error", error: { code: "idempotency_uncertain" } })
    const firstError = (first as { error: { message: string; details: Record<string, unknown> } }).error
    for (const _ of [1, 2])
      expect(await run("thread_create", args)).toMatchObject({
        kind: "error",
        error: {
          code: "idempotency_uncertain",
          details: { error_note: firstError.message, first_cause: firstError.details },
        },
      })
  })

  test("#given the lost open's session is one b's route never lists #when the create is retried under the same key #then the adopted session is ended by the routing id b's engine names and the receipt stays uncertain", async () => {
    const a = account({
      openLosesReply: 1,
      listFailsAfterLostReply: true,
      lostUnrouted: true,
      unlistedReason: "route_unlisted",
    })
    const { run } = surface(a.remote)
    const args = { device: "studio", name: "lost-unrouted", idempotency_key: "remote-lost-unrouted" }
    const id = createdThreadId("dur-caller", "remote-lost-unrouted")

    expect(await run("thread_create", args)).toMatchObject({ kind: "error", error: { code: "idempotency_uncertain" } })
    expect(await run("thread_create", args)).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable", details: { reason: "route_unlisted", created: false } },
    })
    const unloads = a.sent.filter((entry) => entry.via === "endpoint" && entry.rpc?.["type"] === "unload_session")
    expect(unloads.map((entry) => entry.rpc?.["sessionId"])).toEqual([`rpc-lost-${id}`])
    // Not replayed as a final answer: the next retry runs again and, with nothing left on b, answers uncertain.
    expect(await run("thread_create", args)).toMatchObject({ kind: "error", error: { code: "idempotency_uncertain" } })
    expect(opens(a.sent)).toHaveLength(1)
  })
})
