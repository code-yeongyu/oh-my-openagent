import { createWorkpoolTool } from "@oh-my-opencode/senpi-task"
import type { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { SenpiExtensionAPI } from "../../extension/types"
import type { TaskEngine } from "./engine"
import type { SkillInvocationTracker } from "./skill-invocation-tracker"

export function registerWorkpoolTool(
  pi: SenpiExtensionAPI,
  engine: TaskEngine,
  skills: SkillInvocationTracker,
  coordinator?: IdleInjectionCoordinator,
): void {
  const workpools = engine.manager.workpools
  if (workpools === undefined) throw new Error("Task engine does not expose workpool admission")
  pi.registerTool({ ...createWorkpoolTool({
    ...engine.taskToolDeps(sessionId => skills.stateFor(sessionId)),
    workpools,
  }) })
  workpools.bindAggregate({
    enqueue: (message, receipts) => {
      if (coordinator === undefined) {
        pi.sendMessage({ customType: "senpi-task.workpool-aggregate", content: JSON.stringify(message.results), display: false, details: message }, { triggerTurn: true, deliverAs: "steer" })
        receipts.ack()
        return
      }
      const accepted = coordinator.enqueue({
        key: `workpool:${message.pool_id}:${message.generation}`, source: "workpool-aggregate",
        customType: "senpi-task.workpool-aggregate", content: JSON.stringify(message.results), display: false, details: message,
        onFlushed: () => receipts.ack(),
        onDeliveryFailed: error => receipts.fail(error),
      })
      if (accepted === false) throw new Error("idle-injection coordinator retired on session shutdown; injection not delivered")
      coordinator.flushSoon()
    },
  })
  pi.on("session_start", () => {
    const sessionId = engine.runtime.sessionId()
    if (sessionId !== undefined) workpools.attach({ sessionId, rootSessionId: sessionId, depth: 0, cwd: pi.cwd ?? process.cwd() })
  })
  pi.on("session_shutdown", () => workpools.dispose())
}
