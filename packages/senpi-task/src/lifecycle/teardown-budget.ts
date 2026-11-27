import { log } from "@oh-my-opencode/utils"

export type TeardownStep = "abort" | "terminate" | "dispose" | "publish_task_status"

export type TeardownStepDeadline = (step: TeardownStep) => Promise<void> & { cancel?: () => void }

// Longer than an RPC child's own SIGTERM -> SIGKILL escalation (5 s) plus its exit observation (2 s),
// so a terminate that is still making progress is never cut short.
export const TEARDOWN_STEP_BUDGET_MS = 10_000

export const defaultTeardownStepDeadline: TeardownStepDeadline = (step) => {
  void step
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, TEARDOWN_STEP_BUDGET_MS)
    timer.unref?.()
  }) as Promise<void> & { cancel?: () => void }
  // The step that finishes first must not leave its budget timer armed for the whole 10 s (omo#11676).
  expired.cancel = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }
  return expired
}

/**
 * Runs one teardown step for at most its budget (omo#9785): a child that never answers abort, ignores
 * its signals, or never finishes disposing must not hold the caller - the idle sweep, a cancel, an
 * eviction - forever. A rejection still propagates; an expired budget is logged and the caller moves on.
 */
export async function withinTeardownBudget(
  deadline: TeardownStepDeadline,
  target: { readonly taskId: string; readonly pid: number | undefined },
  step: TeardownStep,
  run: () => Promise<void>,
): Promise<void> {
  const work = Promise.resolve()
    .then(run)
    .then(() => "done" as const)
  const budget = deadline(step)
  try {
    const outcome = await Promise.race([work, budget.then(() => "timed_out" as const)])
    if (outcome === "timed_out") {
      work.catch(() => undefined)
      log("senpi-task teardown step exceeded its budget; continuing without it", {
        taskId: target.taskId,
        pid: target.pid,
        step,
      })
    }
  } finally {
    budget.cancel?.()
  }
}
