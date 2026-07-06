import { log } from "@oh-my-opencode/utils"

import type { LifecycleContext } from "./context"
import { destroyResidentTask } from "./destroy"
import type { TeardownSummary } from "./types"

/**
 * On session_shutdown, tear down every resident child through the destruction port: in-process
 * children abort THEN dispose; rpc children SIGTERM (escalating to SIGKILL after 5s) THEN detach.
 * Emits exactly one summary log line. Ordering is guaranteed by the destruction port itself.
 */
export async function teardownOnSessionShutdown(context: LifecycleContext): Promise<TeardownSummary> {
  const entries = [...context.registry.entries()]
  const inProcess = entries.filter((handle) => handle.kind === "in-process").length
  const rpc = entries.length - inProcess

  for (const handle of entries) {
    await destroyResidentTask(context, handle.task_id, "shutdown")
  }

  const summary: TeardownSummary = { in_process: inProcess, rpc, total: entries.length }
  log("senpi-task shutdown teardown", summary)
  return summary
}
