import { log } from "@oh-my-opencode/utils"
import type { LifecycleContext } from "./context"
import { endClosingFallbackChild } from "./fallback-closing-child"

const activePasses = new WeakSet<LifecycleContext>()

/** Startup never waits for old sessions to close. One session-scoped pass runs at a time. */
export function retrySuspendedClosures(context: LifecycleContext, parentSessionId?: string): void {
  if (activePasses.has(context)) return
  const records = context.store
    .list()
    .records.filter(
      (record) =>
        record.fallback_closing_child?.requires_confirmation === true &&
        (parentSessionId === undefined
          ? context.registry.ownsRecord?.(record) === true
          : record.parent_session_id === parentSessionId),
    )
  if (records.length === 0) return
  activePasses.add(context)
  void (async () => {
    for (const record of records) {
      try {
        await endClosingFallbackChild(context, record)
      } catch (error) {
        log("senpi-task suspension closure retry failed", {
          taskId: record.task_id,
          error: String(error),
        })
      }
    }
  })().finally(() => {
    activePasses.delete(context)
  })
}
