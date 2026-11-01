import { afterEach, describe, expect, test } from "bun:test"

import { DEFAULT_TEST_TIMEOUT_MS } from "../../../../test-support/test-deadline"
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

// The shutdown bound outlives the test's own budget: only the explicit teardown release may end it.
const SHUTDOWN_BOUND_MS = DEFAULT_TEST_TIMEOUT_MS

/**
 * `withheld` is the slow-host shape seen on Windows runners (#11257): the host records the abort but its
 * acknowledgement never comes, so teardown waits out the handle's own abort grace before it closes.
 */
async function refuseFirstPrompt(abortReply: "answered" | "withheld"): Promise<void> {
  // given: detach is the unbounded disposal port; abort and close retain their normal grace.
  const host = await harness.fakeHost()
  host.failReply("prompt", "synthetic host prompt refusal")
  if (abortReply === "withheld") host.withholdReply("abort")
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
    await bounded(promptObserved, "host received the first prompt")
    let shutdownDone = false
    // Shutdown starts before refusal registers cleanup, so its later snapshot must join it too.
    const shutdown = manager.settleLaunchesForShutdown?.(SHUTDOWN_BOUND_MS).then(() => { shutdownDone = true })
    releasePrompt()
    await bounded(detaching.promise, "refused launch reached disposal")
    const result = await bounded(starting, "start settled")

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
    await bounded(shutdown ?? Promise.resolve(), "shutdown joined the released cleanup")
    await bounded(runner.settleTeardowns(), "runner teardowns settled")
    expect(disposed).toBe(true)
  } finally {
    releasePrompt()
    release.resolve()
    await bounded(runner.settleTeardowns(), "final runner teardowns")
    await bounded(manager.settleLaunchesForShutdown?.(SHUTDOWN_BOUND_MS) ?? Promise.resolve(), "final shutdown")
  }
}

describe("host first-prompt refusal cleanup", () => {
  test("#given a refused host prompt and held teardown #when launch settles #then failure precedes disposal and shutdown still owns cleanup", async () => {
    await refuseFirstPrompt("answered")
  })

  test("#given a refused host prompt whose abort the host never acknowledges #when launch settles #then disposal still follows the abort grace and shutdown still owns cleanup", async () => {
    await refuseFirstPrompt("withheld")
  })
})
