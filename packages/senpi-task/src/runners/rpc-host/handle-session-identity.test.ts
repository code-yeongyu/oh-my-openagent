import { describe, expect, test } from "bun:test"

import { createHandleSessionIdentity } from "./handle-session-identity"

const SESSION = { routingId: "rpc-1", sessionPath: "/tmp/child.jsonl", instanceId: "i-1" }

function identityWith(initialDurableId?: string) {
  const learned: string[] = []
  const identity = createHandleSessionIdentity(SESSION, initialDurableId, (id) => learned.push(id))
  return { identity, learned }
}

describe("a host-session handle's durable id (#10873)", () => {
  test("#given no id from the open #when heartbeats report one #then it is learned and reported exactly once", () => {
    const { identity, learned } = identityWith()

    identity.observeDurableId("durable-a")
    identity.observeDurableId("durable-a")

    expect(identity.durableId()).toBe("durable-a")
    expect(learned).toEqual(["durable-a"])
  })

  test("#given an id from the open #when a heartbeat reports a different one #then the known id stands and nothing is reported", () => {
    const { identity, learned } = identityWith("durable-a")

    identity.observeDurableId("durable-stale")

    expect(identity.durableId()).toBe("durable-a")
    expect(learned).toEqual([])
  })

  test("#given a session switch #when a state answer sent before it arrives late #then the replacement's id stands", () => {
    const { identity, learned } = identityWith("durable-old")

    identity.followReplace({ sessionId: "rpc-1", durableSessionId: "durable-new", sessionFile: "/tmp/new.jsonl" })
    identity.observeDurableId("durable-old")

    expect(identity.durableId()).toBe("durable-new")
    expect(identity.current().sessionPath).toBe("/tmp/new.jsonl")
    expect(learned).toEqual([])
  })

  test("#given an older host's malformed answer #when it is observed #then it is ignored", () => {
    const { identity, learned } = identityWith()

    identity.observeDurableId(42)
    identity.observeDurableId("")

    expect(identity.durableId()).toBeUndefined()
    expect(learned).toEqual([])
  })
})
