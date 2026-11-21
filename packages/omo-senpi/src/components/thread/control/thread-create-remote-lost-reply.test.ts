import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture } from "../thread-remote-fixture"
import { createdThreadId } from "./session-host"

// A create on another device whose open_session reply is lost (the caller's budget ran out while b's engine was still
// answering, and b dropped the late result for the closed connection): b made the session, so thread_create must find
// it by the id the call's idempotency key derives, on the spot or on a retry under the same key, never answer it
// uncertain once b lists it, and never open a second session.
const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

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

  test("#given b's engine ignores the derived id and the reply is lost #when the create is retried under the same key #then idempotency_uncertain and no second open", async () => {
    const a = account({ openLosesReply: 1, ignoresDurableSessionId: true })
    const { run } = surface(a.remote)
    const args = { device: "studio", name: "no-capability", idempotency_key: "remote-lost-3" }

    expect(await run("thread_create", args)).toMatchObject({ kind: "error", error: { code: "idempotency_uncertain" } })
    expect(await run("thread_create", args)).toMatchObject({ kind: "error", error: { code: "idempotency_uncertain" } })
    expect(opens(a.sent)).toHaveLength(1)
  })
})
