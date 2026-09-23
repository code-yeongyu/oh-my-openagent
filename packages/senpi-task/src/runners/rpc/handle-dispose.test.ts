import { spawn } from "node:child_process"
import { once } from "node:events"
import { expect, test } from "bun:test"

import { createRpcChildHandle } from "./handle"
import { RpcProtocolClient } from "./protocol-client"

class DeferredDetachClient extends RpcProtocolClient {
  readonly release = Promise.withResolvers<void>()
  override async detach(): Promise<void> {
    super.detach()
    await this.release.promise
  }
}

test("#given an unfinished detach #when dispose runs #then it waits for the detach before reporting completion", async () => {
  // given
  const child = spawn(process.execPath, ["-e", "process.stdin.resume()"], { stdio: ["pipe", "pipe", "pipe"] })
  const closed = once(child, "close")
  const client = new DeferredDetachClient({ child })
  const handle = createRpcChildHandle({
    client, child, taskId: "pending-detach", heartbeatIntervalMs: 60_000, now: () => 7,
  })
  let settled = false

  // when: cross the event-loop check phase so every already-resolved promise reaction has run.
  const disposal = handle.dispose().then(() => { settled = true })
  try {
    await new Promise<void>((resolve) => setImmediate(resolve))

    // then: detach is still withheld, so dispose must not have reported completion.
    expect(settled).toBe(false)
    client.release.resolve()
    await disposal
    expect(settled).toBe(true)
  } finally {
    client.release.resolve()
    await disposal
    child.kill()
    await closed
  }
})
