import { afterEach, describe, expect, test } from "bun:test"
import type { ThreadToolResult } from "../contracts"
import { hashArgs } from "../gateway/bindings"
import { createRemoteThreadFixture } from "../thread-remote-fixture"
import type { ThreadHostSession } from "../tools"
import { createdThreadId } from "./session-host"

// omo#14060: the connection to this device's host can close after the host made the session and before its reply
// arrived. thread_create must not leave a prompt-less thread behind: it finds the thread it made by the id the call's
// idempotency key derives, on the spot or on a retry under the same key, and admits the prompt exactly once.
const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

type Created = Extract<ThreadToolResult, { kind: "ok" }> & {
  thread: string
  prompt?: Record<string, unknown>
}

describe("thread_create survives a lost open reply (#14060)", () => {
  test("#given the host makes the session but the reply is lost #when thread_create runs with a prompt #then it answers that thread and admits the prompt once", async () => {
    const { run, openSession, enqueuedFor } = surface(undefined, { openLosesReply: 1 })
    const result = (await run("thread_create", {
      name: "lost-reply",
      prompt: "build it",
      idempotency_key: "atomic-1",
    })) as Created
    const id = createdThreadId("dur-caller", "atomic-1")
    expect(result).toMatchObject({ kind: "ok", thread: id })
    expect(result.prompt).toMatchObject({ delivery: { kind: expect.any(String) } })
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(enqueuedFor(id)).toBe(1)
  })

  test("#given the lost reply also fails the call #when it is retried under the same key #then the retry answers the same thread, opens nothing new and admits the prompt once", async () => {
    const { run, openSession, enqueuedFor } = surface(undefined, { openLosesReply: 1, listFailsAfterLostReply: true })
    const args = { name: "lost-twice", prompt: "build it", idempotency_key: "atomic-2" }
    const first = await run("thread_create", args)
    expect(first).toMatchObject({ kind: "error" })
    const id = createdThreadId("dur-caller", "atomic-2")
    expect(enqueuedFor(id)).toBe(0)
    const retry = (await run("thread_create", args)) as Created
    expect(retry).toMatchObject({ kind: "ok", thread: id })
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(enqueuedFor(id)).toBe(1)
    const again = (await run("thread_create", args)) as Created
    // A third run under the key finds the same thread; the prompt's own receipt answers it as already delivered.
    expect(again).toMatchObject({ kind: "ok", thread: id, prompt: { deduplicated: true } })
    expect(openSession).toHaveBeenCalledTimes(1)
  })

  test("#given a host that ignores the derived id and a lost reply #when the create is retried under the same key #then idempotency_uncertain and no second thread", async () => {
    const { run, openSession } = surface(undefined, {
      openLosesReply: 1,
      listFailsAfterLostReply: true,
      ignoresDurableSessionId: true,
    })
    const args = { name: "no-capability", prompt: "build it", idempotency_key: "atomic-3" }
    expect(await run("thread_create", args)).toMatchObject({ kind: "error" })
    expect(await run("thread_create", args)).toMatchObject({ kind: "error", error: { code: "idempotency_uncertain" } })
    expect(openSession).toHaveBeenCalledTimes(1)
  })

  test("#given a create on another device whose earlier run failed #when it is retried under the same key #then idempotency_uncertain and nothing reaches that device", async () => {
    const a = account()
    const { run, store } = surface(a.remote)
    const args = { device: "studio", name: "remote-retry", idempotency_key: "atomic-4" }
    const scope = { principal: "session:dur-caller", operation: "thread_create", idempotency_key: "atomic-4" }
    expect(await store.toolReceiptBegin({ ...scope, now: Date.now(), args_hash: hashArgs(args) })).toEqual({
      kind: "accepted",
    })
    await store.toolReceiptSettle({
      ...scope,
      now: Date.now(),
      error_note: "the call failed after b opened the session",
    })
    expect(await run("thread_create", args)).toMatchObject({ kind: "error", error: { code: "idempotency_uncertain" } })
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "open_session")).toEqual([])
  })

  test("#given the earlier run named the thread it made before failing #when the named create is retried under the same key #then it answers that thread, not name_conflict", async () => {
    const sessions: ThreadHostSession[] = [
      {
        sessionId: "route-local",
        durableSessionId: "dur-local",
        cwd: process.cwd(),
        name: "local peer",
        status: "open",
      },
    ]
    const { run, openSession, enqueuedFor } = surface(undefined, {
      sessions,
      openLosesReply: 1,
      listFailsAfterLostReply: true,
    })
    const args = { name: "named-retry", prompt: "build it", idempotency_key: "atomic-5" }
    expect(await run("thread_create", args)).toMatchObject({ kind: "error" })
    const id = createdThreadId("dur-caller", "atomic-5")
    const made = sessions.findIndex((session) => session.durableSessionId === id)
    expect(made).toBeGreaterThan(-1)
    // The engine names the session after its open (set_session_name), before a later step of the first run failed.
    const existing = sessions[made]
    expect(existing).toBeDefined()
    if (!existing) throw new Error(`created session ${id} missing from sessions`)
    sessions[made] = { ...existing, name: "named-retry" }
    expect(await run("thread_create", args)).toMatchObject({ kind: "ok", thread: id })
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(enqueuedFor(id)).toBe(1)
  })

  test("#given two creates under different keys #when both run #then each derives its own id", () => {
    expect(createdThreadId("dur-caller", "a")).not.toBe(createdThreadId("dur-caller", "b"))
    expect(createdThreadId("dur-caller", "a")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})
