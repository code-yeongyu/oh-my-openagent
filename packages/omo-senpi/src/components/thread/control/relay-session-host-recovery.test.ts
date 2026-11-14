import { afterEach, describe, expect, test } from "bun:test"
import type { RemoteThreadSurface } from "../remote/ports"
import { createRemoteThreadFixture } from "../thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const ENGINE_OPEN_REPLY = { sessionId: "rpc-9", state: { sessionId: "dur-new-on-b" } }

const opens = (sent: readonly { rpc?: Record<string, unknown> }[]) =>
  sent.filter((entry) => entry.rpc?.["type"] === "open_session").length

describe("a create on another device that opened the session is never lost to a later step's failure", () => {
  test("#given b opened the session but cannot locate its listing key #when thread_create runs twice under one idempotency key #then both answer the created thread by its durable id with a warning, and b opens one session", async () => {
    const a = account({ openData: ENGINE_OPEN_REPLY, relayKeys: new Map() })
    const { run } = surface(a.remote)
    const args = { device: "studio", idempotency_key: "create-once-1" }

    const first = await run("thread_create", args)
    const replay = await run("thread_create", args)

    expect(first).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-new-on-b", device: "b", warnings: [{ code: "unsupported", details: { reason: "session_not_found" } }] },
    })
    expect(replay).toEqual(first)
    expect(opens(a.sent)).toBe(1)
  })

  test("#given b opened the session but refuses its name #when thread_create names it #then the created thread is answered with a name warning, not an error", async () => {
    const a = account({ openData: ENGINE_OPEN_REPLY, relayKeys: new Map([["dur-new-on-b", "rk-new-on-b"]]) })
    const sessions = a.remote.sessions
    const refusingName: RemoteThreadSurface = {
      ...a.remote,
      sessions: {
        ...sessions,
        sessionCommand: async (device, session, rpc, options) =>
          rpc["type"] === "set_session_name"
            ? { kind: "refused", reason: "request_timeout" }
            : sessions.sessionCommand(device, session, rpc, options),
      },
    }
    const { run } = surface(refusingName)

    const result = await run("thread_create", { device: "studio", name: "fresh" })

    expect(result).toMatchObject({
      kind: "ok",
      thread: { thread_id: "dur-new-on-b", warnings: [{ code: "host_unavailable", details: { reason: "name_not_applied" } }] },
    })
    expect(opens(a.sent)).toBe(1)
  })
})
