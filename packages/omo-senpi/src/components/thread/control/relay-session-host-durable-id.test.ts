import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture } from "../thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

// The engine's open_session reply names the routing id at data.sessionId and the durable id at state.sessionId, with no
// durableSessionId field (senpi host-session-open.ts reads it the same way); b's connector lists the session by a relay key.
const ENGINE_OPEN_REPLY = { sessionId: "rpc-9", state: { sessionId: "dur-new-on-b", cwd: "/work/b" } }
const RELAY_KEYS = new Map([["dur-new-on-b", "rk-new-on-b"]])

describe("thread_create on another device names the new thread by its durable id", () => {
  test("#given b's engine names the durable id only as state.sessionId #when thread_create runs on device b #then thread is the durable id, never the relay listing key", async () => {
    const a = account({ openData: ENGINE_OPEN_REPLY, relayKeys: RELAY_KEYS })
    const { run } = surface(a.remote)

    const result = await run("thread_create", { name: "relay-session-host-durable-id-17", device: "studio" })

    expect(result).toMatchObject({
      kind: "ok",
      thread: "dur-new-on-b",
      device: "b",
    })
    expect(JSON.stringify(result)).not.toContain("rk-new-on-b")
  })

  // #14015 review L1: a locate refused because this device is not signed in names that remedy, never "update omo on b".
  test.each(["sign_in_required", "signed_out"])(
    "#given the locate after the open is refused %s #when thread_create runs on device b #then the created thread's warning is host_unavailable naming this device's sign-in",
    async (reason) => {
      const a = account({ openData: ENGINE_OPEN_REPLY, locateRefuse: reason })
      const { run } = surface(a.remote)

      const result = await run("thread_create", { device: "studio", name: `signed-out-${reason}` })

      expect(result).toMatchObject({
        kind: "ok",
        thread: "dur-new-on-b",
        warnings: [{ code: "host_unavailable", details: { device: "b", reason } }],
      })
      expect(JSON.stringify(result)).not.toContain("update omo")
    },
  )

  test("#given a named create on b #when the name is applied #then set_session_name goes to the listing key while the caller gets the durable id", async () => {
    const a = account({ openData: ENGINE_OPEN_REPLY, relayKeys: RELAY_KEYS })
    const { run } = surface(a.remote)

    const result = await run("thread_create", { device: "studio", name: "fresh" })

    expect(result).toMatchObject({ kind: "ok", thread: "dur-new-on-b", name: "fresh" })
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "set_session_name").map((entry) => entry.session)).toEqual([
      "rk-new-on-b",
    ])
  })
})
