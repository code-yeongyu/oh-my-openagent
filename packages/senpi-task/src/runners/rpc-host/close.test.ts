import { describe, expect, test } from "bun:test"

import type { HostSessionIdentity } from "../../state"
import { closeHostSession, type HostSessionCloseChannel } from "./close"

const IDENTITY: HostSessionIdentity = {
  socket: "/tmp/dh-fake/rpc.sock",
  routing_id: "routing-1",
  session_path: "/tmp/dh-fake/sessions/child.jsonl",
  instance_id: "instance-1",
}

type FakeChannel = HostSessionCloseChannel & { readonly calls: string[] }

function fakeChannel(fail?: "open" | "close"): FakeChannel {
  const calls: string[] = []
  return {
    calls,
    open: (input) => {
      calls.push(`open:${input.sessionPath}:${input.cwd}`)
      return fail === "open" ? Promise.reject(new Error("no such session")) : Promise.resolve({})
    },
    send: (command) => {
      calls.push(`send:${command.type}`)
      return Promise.resolve()
    },
    close: () => {
      calls.push("close_session")
      return fail === "close" ? Promise.reject(new Error("host gone")) : Promise.resolve()
    },
    detach: () => {
      calls.push("detach")
      return Promise.resolve()
    },
  }
}

describe("the single host-session close writer", () => {
  test("#given a session the daemon still holds #when it is closed #then the turn is aborted and close_session is issued on the recorded path", async () => {
    // given
    const channel = fakeChannel()

    // when
    const outcome = await closeHostSession({ hostSession: IDENTITY, cwd: "/repo" }, { createChannel: () => channel })

    // then
    expect(outcome).toBe("closed")
    expect(channel.calls).toEqual([`open:${IDENTITY.session_path}:/repo`, "send:abort", "close_session"])
  })

  test("#given a daemon that will not open the session #when it is closed #then the connection is dropped and nothing is aborted", async () => {
    // given
    const channel = fakeChannel("open")

    // when
    const outcome = await closeHostSession({ hostSession: IDENTITY }, { createChannel: () => channel })

    // then
    expect(outcome).toBe("unreachable")
    expect(channel.calls.filter((call) => call.startsWith("send:"))).toEqual([])
    expect(channel.calls.at(-1)).toBe("detach")
  })

  test("#given a daemon that dies during close_session #when it is closed #then the caller learns it is unreachable instead of throwing", async () => {
    // given
    const channel = fakeChannel("close")

    // when
    const outcome = await closeHostSession({ hostSession: IDENTITY }, { createChannel: () => channel })

    // then
    expect(outcome).toBe("unreachable")
    expect(channel.calls).toContain("send:abort")
  })
})
