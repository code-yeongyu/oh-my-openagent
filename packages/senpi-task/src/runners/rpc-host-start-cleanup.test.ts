import { afterEach, describe, expect, test } from "bun:test"

import { bounded } from "../lifecycle/__fixtures__/live-parent-clock"
import { baseSpec, cleanupProjects, launchSettled, makeManager } from "../manager/__fixtures__/manager-fakes"
import { createRpcManagedRunner } from "../manager/runner"
import { hostRunnerHarness } from "./rpc-host.test-support"
import { HostSessionClient } from "./rpc-host/session-client"

const harness = hostRunnerHarness()

afterEach(async () => {
  await harness.release()
  cleanupProjects()
})

describe("host first-prompt refusal cleanup", () => {
  test("#given a refused host prompt and held teardown #when launch settles #then failure precedes disposal and shutdown still owns cleanup", async () => {
    // given: detach is the unbounded disposal port; abort and close retain their normal grace.
    const host = await harness.fakeHost()
    host.failReply("prompt", "synthetic host prompt refusal")
    const releasePrompt = host.holdReply("prompt")
    const promptObserved = host.waitForCommand("prompt")
    const release = Promise.withResolvers<void>()
    const detaching = Promise.withResolvers<void>()
    let disposed = false
    const runner = harness.runnerOver(host, {
      createClient: (socketPath) => {
        const client = new HostSessionClient({
          socketPath,
          ports: { probeProtocolInfo: () => host.probeProtocolInfo() },
        })
        const detach = client.detach.bind(client)
        client.detach = async () => {
          detaching.resolve()
          await release.promise
          await detach()
          disposed = true
        }
        return client
      },
    })
    const { manager, store } = makeManager({ process: createRpcManagedRunner(runner) })
    try {
      // when: the first prompt is refused, but teardown cannot finish until explicitly released.
      const starting = manager.start(baseSpec({ execution_mode: "process" }))
      await bounded(promptObserved)
      let shutdownDone = false
      // Shutdown starts before refusal registers cleanup, so its later snapshot must join it too.
      const shutdown = manager.settleLaunchesForShutdown?.(2_000).then(() => { shutdownDone = true })
      releasePrompt()
      await bounded(detaching.promise)
      const result = await bounded(starting)

      // then: a refused launch settles independently of the held teardown.
      expect(["start_failed", "error"]).toContain(await launchSettled(manager, result))
      if (result.kind !== "started" && result.kind !== "start_failed") throw new Error(`unexpected ${result.kind}`)
      expect(store.load(result.task_id)?.failure_kind).toBe("child-prompt-failed")
      expect(disposed).toBe(false)
      expect(host.commands.filter((command) => command.type === "abort")).toHaveLength(1)
      expect(host.commands.filter((command) => command.type === "close_session")).toHaveLength(1)
      expect(host.sessions()).toHaveLength(0)
      expect(shutdownDone).toBe(false)
      release.resolve()
      await bounded(shutdown ?? Promise.resolve())
      await bounded(runner.settleTeardowns())
      expect(disposed).toBe(true)
    } finally {
      releasePrompt()
      release.resolve()
      await bounded(runner.settleTeardowns())
      await bounded(manager.settleLaunchesForShutdown?.(2_000) ?? Promise.resolve())
    }
  })
})
