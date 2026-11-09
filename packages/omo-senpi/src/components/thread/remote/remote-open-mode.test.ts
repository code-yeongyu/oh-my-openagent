import { afterEach, describe, expect, test } from "bun:test"

import { B_ROW, createRemoteThreadFixture } from "../thread-remote-fixture"
import { openRemote } from "./remote-ops"

// #6189: a session created on another device names its creator's approval mode at create, so it never falls into the
// engine's delegated `ask` with no card to answer it; opening an existing session leaves that session's own mode alone.

const fixture = createRemoteThreadFixture()
afterEach(fixture.cleanup)

const openSessionRecords = (sent: ReturnType<typeof fixture.account>["sent"]) =>
  sent.filter((entry) => entry.rpc?.["type"] === "open_session").map((entry) => entry.rpc)

describe("openRemote and the creator's approval mode", () => {
  test("#given a creator in ask #when it creates and forks on another device #then both open_session records name ask", async () => {
    // given
    const a = fixture.account()
    const remote = { ...a.remote, permissionPreset: () => "ask" }

    // when
    await openRemote(remote, { kind: "create", device: "b" })
    await openRemote(remote, { kind: "fork", row: B_ROW })

    // then
    expect(openSessionRecords(a.sent).map((rpc) => rpc?.["permissionPreset"])).toEqual(["ask", "ask"])
  })

  test("#given a creator in ask #when it opens an existing session #then the record names no mode", async () => {
    // given
    const a = fixture.account()

    // when
    await openRemote({ ...a.remote, permissionPreset: () => "ask" }, { kind: "open", row: B_ROW })

    // then
    expect(openSessionRecords(a.sent)).toEqual([expect.not.objectContaining({ permissionPreset: expect.anything() })])
  })
})
