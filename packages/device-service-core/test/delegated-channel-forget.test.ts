import { describe, expect, test } from "bun:test"
import { followDelegatedChannel } from "../src/delegated-channel.ts"
import type { LocalEvent } from "../src/local-api/protocol.ts"

// A command that stopped waiting (request_timeout) has no reader for its reply: the channel must not keep it for the
// attach's lifetime (#14041 review L2).
const reply = (commandId: string) =>
  ({
    type: "event",
    kind: "session.command_event",
    device: "b",
    command_id: commandId,
    response: { type: "response", success: true },
  }) as unknown as LocalEvent

describe("delegated channel forget", () => {
  test("a reply that arrives after its command was forgotten is dropped, another command's is kept", () => {
    const channel = followDelegatedChannel("b")
    channel.forget("c1")
    channel.accept(reply("c1"))
    channel.accept(reply("c2"))
    expect(channel.takeReply("c1")).toBeUndefined()
    expect(channel.takeReply("c2")).toEqual({ type: "response", success: true })
    channel.accept(reply("c1"))
    expect(channel.takeReply("c1")).toEqual({ type: "response", success: true })
  })

  test("a reply already held when its command is forgotten is dropped at once", () => {
    const channel = followDelegatedChannel("b")
    channel.accept(reply("c1"))
    channel.forget("c1")
    expect(channel.takeReply("c1")).toBeUndefined()
  })
})
