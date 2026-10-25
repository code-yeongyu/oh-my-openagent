import { afterEach, expect, test } from "bun:test"

import { sessionClientHarness } from "./session-client.test-support"
import { openHostSessionHandle } from "./handle.test-support"

const harness = sessionClientHarness()
afterEach(harness.release)

test("the engine client carries typed abort options over the hosted socket", async () => {
  // given a real engine client connected to a host that holds abort responses
  const host = await harness.fakeHost()
  const handle = await openHostSessionHandle({
    client: harness.hostClient(host), sessionPath: "/tmp/abort-wire-child.jsonl",
  })
  const release = host.holdReply("abort")
  let settled = false
  try {
    // when the typed abort traverses HostSessionClient and the engine's RpcClient
    const asked = host.waitForCommand("abort")
    const abort = handle.abort().then(result => { settled = true; return result })
    const command = await asked
    expect(settled).toBe(false)
    release()
    const receipt = await abort

    // then all effect options reach the wire, and a legacy empty reply asserts no stop
    expect(command.payload).toMatchObject({ type: "abort", awaitIdle: true, clearQueue: true })
    expect(command.payload.effectId).toBeString()
    expect(receipt).not.toHaveProperty("stopped")
    expect(receipt).not.toHaveProperty("cleared")
  } finally {
    release()
    await handle.dispose()
  }
})
