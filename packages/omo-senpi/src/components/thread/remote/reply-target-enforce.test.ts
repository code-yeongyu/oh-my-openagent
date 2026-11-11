import { afterEach, describe, expect, test } from "bun:test"
import { B_ROW, createRemoteThreadFixture } from "../thread-remote-fixture"

// Decision 0027 section 6, enforcement half: the allowance approved a send as a REPLY to a consumed delivery's sender (by
// id or stated name); the send step delivers only when the address resolves to that sender, else refuses by name.
describe("a reply approved from a consumed delivery delivers only to that sender", () => {
  const fixture = createRemoteThreadFixture()
  afterEach(fixture.cleanup)

  test("#given the delivery stated sender dur-on-b named 'on b' #when the run replies by that name #then it resolves to b's row and is delivered there", async () => {
    const a = fixture.account({ rows: [B_ROW] })
    const { run } = fixture.surface(a.remote, { callerReplySenders: () => [{ session_id: "dur-on-b", name: "on b" }] })
    expect(await run("thread_send", { thread: "on b", message: "reply" })).toMatchObject({
      kind: "ok",
      thread_id: "dur-on-b",
      device: "b",
    })
  })
  test("#given the delivery stated sender dur-on-b named 'local peer' (a name a local thread also carries) #when the run replies by that name #then the resolved local thread is not the sender: reply_target_mismatch, nothing sent", async () => {
    const a = fixture.account({ rows: [B_ROW] })
    const { run } = fixture.surface(a.remote, {
      callerReplySenders: () => [{ session_id: "dur-on-b", name: "local peer" }],
    })
    expect(await run("thread_send", { thread: "local peer", message: "reply" })).toMatchObject({
      kind: "error",
      error: { code: "reply_target_mismatch", details: { resolved_thread_id: "dur-local" } },
    })
    expect(a.sent).toHaveLength(0)
  })
})
