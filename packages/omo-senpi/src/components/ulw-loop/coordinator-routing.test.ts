import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import { createUlwLoopComponent } from "./index"
import { activeStatus, createLogger } from "./ulw-loop.test-support"

describe("omo-senpi ulw-loop continuation routing through the idle coordinator", () => {
  it("#given a coordinator in ctx #when a continuation fires #then it routes through the coordinator, not a direct user message", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    const delivered: string[] = []
    const idleCoordinator = new IdleInjectionCoordinator((content) => delivered.push(content))
    const outputs = [activeStatus()]
    await createUlwLoopComponent({
      resolveOmoBin: () => "/tmp/omo",
      runCommand: async (_bin, _args, _options) => ({ code: 0, stdout: outputs.shift() ?? activeStatus() }),
    }).register(pi, { logger, config: { getFlag: () => false }, idleCoordinator })

    // when
    await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo" })

    // then the continuation was delivered through the coordinator exactly once, and NOT via sendUserMessage
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toContain("Continue the active omo ulw-loop run")
    expect(pi.userMessages).toEqual([])
  })

  it("#given a task completion already queued #when the continuation fires on the same idle edge #then both collapse into one injection", async () => {
    // given a coordinator that already holds a task-completion injection
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    const delivered: string[] = []
    const idleCoordinator = new IdleInjectionCoordinator((content) => delivered.push(content))
    idleCoordinator.enqueue({ key: "st_done", source: "task-completion", content: "task st_done completed" })
    const outputs = [activeStatus()]
    await createUlwLoopComponent({
      resolveOmoBin: () => "/tmp/omo",
      runCommand: async (_bin, _args, _options) => ({ code: 0, stdout: outputs.shift() ?? activeStatus() }),
    }).register(pi, { logger, config: { getFlag: () => false }, idleCoordinator })

    // when
    await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo" })

    // then exactly one injection carries both, completion first
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toBe("task st_done completed\n\nContinue the active omo ulw-loop run.\nRun `omo ulw-loop status --json` in this session cwd, inspect the active incomplete goals, and keep working until the run is complete or safely checkpointed.")
  })
})
