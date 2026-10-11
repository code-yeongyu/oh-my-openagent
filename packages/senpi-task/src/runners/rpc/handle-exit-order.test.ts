import { expect, test } from "bun:test"
import { createRpcChildHandle } from "./handle"
import { RpcProtocolClient } from "./protocol-client"
import { spawnFakeChild } from "./__fixtures__/spawn-fake"
import { terminateRpcChild } from "./terminate"

test("process exit during a pending prompt retains exit facts for provisional settlement", async () => {
  // Given the repository's scripted RPC worker, not a live Senpi runtime.
  const child = spawnFakeChild()
  const client = new RpcProtocolClient({ child })
  const handle = createRpcChildHandle({
    client, child, taskId: "st_97150011", now: () => 0, heartbeatIntervalMs: 60_000,
  })
  try {
    await handle.startInitialPrompt("hold")
    if (handle.waitForOutcome === undefined) throw new Error("missing tracked outcome")
    const outcome = handle.waitForOutcome()
    const pending = handle.followUp("continue")
    const rejected = pending.then(() => false, () => true)
    // When the dying child's broken pipe rejects RPC before close supplies the exit code.
    child.stdin?.emit("error", Object.assign(new Error("closed pipe"), { code: "EPIPE" }))
    expect(await rejected).toBe(true)
    child.emit("close", 1, null)
    // Then the prompt rejection cannot preempt the exit-derived outcome with a generic failure.
    const result = await outcome
    expect(result.status).toBe("error")
    if (result.status !== "error") throw new Error("missing exit")
    expect(result.failure.exit).toEqual({ kind: "crashed", code: 1, signal: null })
  } finally {
    await handle.dispose()
    await terminateRpcChild(child)
  }
})
