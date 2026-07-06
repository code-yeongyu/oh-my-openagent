import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../test-support/fake-extension-api"
import { createUlwLoopComponent } from "../components/ulw-loop"
import { activeStatus, createLogger } from "../components/ulw-loop/ulw-loop.test-support"
import { createParentNotifier } from "../components/task/parent-notifier"
import { IdleInjectionCoordinator } from "./idle-injection-coordinator"

// The Oracle arbitration blocker: a background task-completion wake and a ulw-loop continuation that
// land on the SAME idle edge must collapse into exactly ONE injection. This drives the two REAL
// producers (createUlwLoopComponent + createParentNotifier) through one shared coordinator, exactly as
// composeOmoSenpiExtension wires them, instead of hand-enqueuing state the producers never actually
// emit.
describe("idle-injection wiring: real producers on one idle edge", () => {
  it("#given a ulw continuation then a task-completion wake on one idle edge #when both fire #then exactly one injection is delivered", async () => {
    // given a shared coordinator whose deferred flush is captured (manual scheduler = deterministic)
    const delivered: string[] = []
    const scheduled: Array<() => void> = []
    const coordinator = new IdleInjectionCoordinator((content) => delivered.push(content), {
      scheduleFlush: (flush) => scheduled.push(flush),
    })

    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    const outputs = [activeStatus()]
    await createUlwLoopComponent({
      resolveOmoBin: () => "/tmp/omo",
      runCommand: async () => ({ code: 0, stdout: outputs.shift() ?? activeStatus() }),
    }).register(pi, { logger, config: { getFlag: () => false }, idleCoordinator: coordinator })

    // when the ulw continuation fires at turn end (enqueues, defers its flush)
    await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo" })
    expect(delivered).toEqual([])

    // and a background completion wakes the idle parent on the same edge (synchronous, throw-safe path)
    const notifier = createParentNotifier(pi, coordinator)
    notifier.enqueue({
      customType: "senpi-task.completion",
      content: "task st_done completed",
      display: false,
      details: [
        {
          task_id: "st_done",
          name: "bg",
          status: "completed",
          duration_ms: 1,
          final_response_head: "",
          continuation_hint: "",
        },
      ],
      triggerTurn: true,
    })

    // draining any deferred flush must not add a second injection
    for (const flush of scheduled) flush()

    // then exactly one injection carried both, completion first, via the coordinator (no plaintext races)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toContain("task st_done completed")
    expect(delivered[0]).toContain("Continue the active omo ulw-loop run")
    expect(pi.userMessages).toEqual([])
  })
})
