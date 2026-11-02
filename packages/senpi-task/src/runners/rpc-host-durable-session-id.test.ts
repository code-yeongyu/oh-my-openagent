import { afterEach, describe, expect, test } from "bun:test"

import { isHostSessionHandle } from "./rpc-host"
import { childSpec, hostRunnerHarness } from "./rpc-host.test-support"
import type { RpcRunnerSpec } from "./types"

const harness = hostRunnerHarness()
afterEach(() => harness.release())

function unpinnedSpec(): RpcRunnerSpec {
  const { model: _pinned, ...spec } = childSpec()
  return spec
}

function durableIdHeard(handle: { onDurableSessionId(listener: (id: string) => void): () => void }): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("waited 5s for a heartbeat to report the durable id; none did")), 5_000)
    const stop = handle.onDurableSessionId((id) => {
      clearTimeout(timer)
      stop()
      resolve(id)
    })
  })
}

// The manager records child_session_id from `handle.sessionId` right after spawn (#recordSpawnFacts).
// A hosted handle used to learn its durable id only on a later heartbeat, so that write never
// happened and a grandchild's parent_session_id joined back to no task (#10873). The harness
// heartbeat interval is 60 s, so in the first two cases only the open's own state read can answer.
describe("a hosted child's durable session id (#10873)", () => {
  for (const [label, spec] of [["with a pinned model", () => childSpec()], ["without a model", unpinnedSpec]] as const) {
    test(`#given a fresh host open ${label} #when the child starts #then its handle already carries the host's durable session id`, async () => {
      const host = await harness.fakeHost()

      const handle = await harness.runnerOver(host).start(spec())

      if (!isHostSessionHandle(handle)) throw new Error("expected a host-session handle")
      expect(handle.sessionId).toBe(`durable-${handle.hostSession.routingId}`)
    })
  }

  test("#given an unpinned open whose state read fails #when the child starts #then it still starts without an id and the next heartbeat reports the durable id", async () => {
    const host = await harness.fakeHost()
    host.failReply("get_state", "state unavailable")

    const handle = await harness.runnerOver(host, { heartbeatIntervalMs: 50 }).start(unpinnedSpec())

    if (!isHostSessionHandle(handle)) throw new Error("expected a host-session handle")
    expect(handle.sessionId).toBeUndefined()
    const heard = durableIdHeard(handle)
    host.failReply("get_state", undefined)
    expect(await heard).toBe(`durable-${handle.hostSession.routingId}`)
    expect(handle.sessionId).toBe(`durable-${handle.hostSession.routingId}`)
  })
})
