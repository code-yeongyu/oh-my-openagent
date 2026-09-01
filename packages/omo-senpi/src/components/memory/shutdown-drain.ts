// Bounded session_shutdown drain (IC-10). senpi awaits session_shutdown handlers before
// disposing the runtime, so the drain owns a hard budget: an absolute deadline propagated
// with a shared AbortSignal into every step. Each step is raced against the remaining
// budget AND re-checks the clock and the signal before it starts, so a timed-out drain
// STARTS no further mutation or spawn once the handler returns. Work abandoned this way is
// recovered by the session_start reconcile paths, never by fire-and-forget continuation.

import type { ComponentLogger } from "../../extension/types"

/** Hard drain budget in milliseconds. Pinned by test: senpi blocks shutdown on this handler. */
export const SESSION_SHUTDOWN_DRAIN_BUDGET_MS = 1500

export type ShutdownReason = "quit" | "reload" | "new" | "resume" | "fork"

export interface ShutdownEvaluatorInput {
  readonly reason: ShutdownReason
  readonly sessionId: string
  readonly deadlineAt: number
  readonly signal: AbortSignal
}

/** IC-10 evaluator: appended by registration, run sequentially in registration order. */
export type ShutdownEvaluator = (input: ShutdownEvaluatorInput) => Promise<void> | void

export interface ShutdownDrainInput {
  readonly reason: ShutdownReason
  readonly sessionId: string
  readonly deadlineAt: number
  /** Injectable clock; the fake-clock deadline test drives the race through it. */
  readonly now?: () => number
}

export interface ShutdownDrainSteps {
  /** (a) IC-11 journal flush. */
  flushJournal(sessionId: string, signal: AbortSignal): Promise<void>
  /** (b) final un-enqueued transcript delta. */
  enqueueFinalDelta(sessionId: string, signal: AbortSignal): Promise<void>
  /** (c') debounced skills-usage writer, flushed before any launch. */
  flushSkillsUsage(sessionId: string, signal: AbortSignal): Promise<void>
  /** (c) facts child spawn, gated by the debounce threshold. */
  launchFacts(sessionId: string, signal: AbortSignal): Promise<void>
}

export interface ShutdownDrain {
  registerEvaluator(evaluator: ShutdownEvaluator): void
  run(input: ShutdownDrainInput): Promise<void>
}

export interface ShutdownDrainOptions {
  readonly steps: ShutdownDrainSteps
  readonly logger?: ComponentLogger
}

/** The absolute deadline a shutdown handler hands to the drain. */
export function shutdownDeadlineAt(now: () => number): number {
  return now() + SESSION_SHUTDOWN_DRAIN_BUDGET_MS
}

export function createShutdownDrain(options: ShutdownDrainOptions): ShutdownDrain {
  const evaluators: ShutdownEvaluator[] = []

  return {
    registerEvaluator(evaluator: ShutdownEvaluator): void {
      evaluators.push(evaluator)
    },

    async run(input: ShutdownDrainInput): Promise<void> {
      const now = input.now ?? Date.now
      const controller = new AbortController()
      const signal = controller.signal
      let budgetWarned = false
      const completedSteps: string[] = []

      const exhaust = (step: string): void => {
        controller.abort()
        if (budgetWarned) return
        budgetWarned = true
        const details = {
          step,
          reason: input.reason,
          sessionId: input.sessionId,
          remainingMs: Math.max(0, input.deadlineAt - now()),
          completedSteps,
        }
        if (step === "shutdown-evaluator") {
          options.logger?.info("memory shutdown drain deferred optional work", details)
        } else {
          options.logger?.warn("memory shutdown drain hit its budget", details)
        }
      }

      /** Races one step against the remaining budget. Returns false once the budget is gone. */
      const runStep = async (name: string, work: () => Promise<void>): Promise<boolean> => {
        if (signal.aborted || now() >= input.deadlineAt) {
          exhaust(name)
          return false
        }
        // Errors are settled at attach time so an abandoned step can never surface as an
        // unhandled rejection after the drain returned; only a step that wins its race is reported.
        const settled = work().then(
          () => undefined,
          (error: unknown) => error,
        )
        const remainingMs = Math.max(0, input.deadlineAt - now())
        let timer: ReturnType<typeof setTimeout> | undefined
        const expired = new Promise<typeof BUDGET_EXPIRED>((resolve) => {
          timer = setTimeout(() => resolve(BUDGET_EXPIRED), remainingMs)
        })
        const outcome = await Promise.race([settled, expired])
        if (timer !== undefined) clearTimeout(timer)
        if (outcome === BUDGET_EXPIRED) {
          exhaust(name)
          return false
        }
        if (outcome !== undefined) {
          options.logger?.warn("memory shutdown drain step failed", {
            step: name,
            reason: input.reason,
            error: String(outcome),
          })
        }
        completedSteps.push(name)
        return true
      }

      const evaluatorInput: ShutdownEvaluatorInput = {
        reason: input.reason,
        sessionId: input.sessionId,
        deadlineAt: input.deadlineAt,
        signal,
      }

      try {
        if (!(await runStep("journal-flush", () => options.steps.flushJournal(input.sessionId, signal)))) return
        if (!(await runStep("facts-enqueue", () => options.steps.enqueueFinalDelta(input.sessionId, signal)))) return
        if (input.reason !== "quit") return
        if (!(await runStep("skills-usage-flush", () => options.steps.flushSkillsUsage(input.sessionId, signal)))) return
        if (!(await runStep("facts-launch", () => options.steps.launchFacts(input.sessionId, signal)))) return
        for (const evaluator of evaluators) {
          const proceed = await runStep("shutdown-evaluator", async () => {
            await evaluator(evaluatorInput)
          })
          if (!proceed) return
        }
      } finally {
        // The handler is returning and the component releases the session next: nothing that
        // still holds this signal may start further work, budget spent or not.
        controller.abort()
      }
    },
  }
}

const BUDGET_EXPIRED = Symbol("shutdown-drain-budget-expired")
