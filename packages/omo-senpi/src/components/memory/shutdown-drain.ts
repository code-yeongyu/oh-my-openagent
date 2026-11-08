// Bounded session_shutdown drain (IC-10). senpi awaits session_shutdown handlers before
// disposing the runtime, so the drain owns a hard budget: an absolute deadline propagated
// with a shared AbortSignal into every step. Shutdown enqueues the final transcript delta but
// never launches facts: an in-process extractor cannot outlive this session. Pending work is
// launched by the next session_start reconcile path.

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
  /** (c') debounced skills-usage writer. */
  flushSkillsUsage(sessionId: string, signal: AbortSignal): Promise<void>
}

export interface ShutdownDrain {
  registerEvaluator(evaluator: ShutdownEvaluator): void
  /**
   * Runs only the journal flush, FIRST in the shutdown handler before any pre-drain await can
   * consume the budget. Returns whether the flush completed inside the budget; emits no
   * journal-loss alarm itself, because the run(input, { journalFlushed }) call that follows
   * owns that alarm exactly once.
   */
  flushJournal(input: ShutdownDrainInput): Promise<boolean>
  /**
   * One pre-drain cleanup await, raced against the SAME deadline the drain steps share. The work
   * is always started (it is what hands back the resources the session still holds - the Kibitzer
   * wake lease, the sidecar directory owner lock, the facts child) but never awaited past the
   * budget: on expiry this logs the drain's budget warning with `step: name`, RETURNS, and lets the
   * work run detached to completion, reporting a late failure instead of leaving it unhandled.
   * Returns whether the work completed inside the budget.
   */
  raceDetached(input: ShutdownDrainInput, name: string, work: () => Promise<void>): Promise<boolean>
  run(input: ShutdownDrainInput, options?: { readonly journalFlushed?: boolean }): Promise<void>
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
  /** Detached steps that completed inside the budget, per session; read by the next budget warning. */
  const detachedSteps = new Map<string, string[]>()

  const execute = async (
    input: ShutdownDrainInput,
    settings: { readonly journalFlushed?: boolean; readonly journalOnly?: boolean } = {},
  ): Promise<boolean> => {
    const now = input.now ?? Date.now
    const controller = new AbortController()
    const signal = controller.signal
    let budgetWarned = false
    let journalCompleted = settings.journalFlushed === true
    const completedSteps: string[] = settings.journalFlushed ? ["journal-flush"] : []

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
      } else if (step === "journal-flush") {
        // A journal flush that never started or never finished is silent data loss, not deferred
        // optional work: alarm-grade, distinct from the budget warnings optional steps emit.
        if (!settings.journalOnly) options.logger?.error("memory shutdown drain skipped the journal flush", details)
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
      const settled = settleInline(work)
      const outcome = await raceAgainstBudget(settled, Math.max(0, input.deadlineAt - now()))
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
      if (!settings.journalFlushed) {
        journalCompleted = await runStep("journal-flush", () => options.steps.flushJournal(input.sessionId, signal))
        if (!journalCompleted) return false
      }
      if (settings.journalOnly) return journalCompleted
      if (!(await runStep("facts-enqueue", () => options.steps.enqueueFinalDelta(input.sessionId, signal)))) return journalCompleted
      if (input.reason !== "quit") return journalCompleted
      if (!(await runStep("skills-usage-flush", () => options.steps.flushSkillsUsage(input.sessionId, signal)))) return journalCompleted
      for (const evaluator of evaluators) {
        const proceed = await runStep("shutdown-evaluator", async () => {
          await evaluator(evaluatorInput)
        })
        if (!proceed) return journalCompleted
      }
      return journalCompleted
    } finally {
      // The handler is returning and the component releases the session next: nothing that
      // still holds this signal may start further work, budget spent or not.
      controller.abort()
    }
  }

  return {
    registerEvaluator(evaluator: ShutdownEvaluator): void {
      evaluators.push(evaluator)
    },
    flushJournal(input: ShutdownDrainInput): Promise<boolean> {
      return execute(input, { journalOnly: true })
    },
    async raceDetached(input: ShutdownDrainInput, name: string, work: () => Promise<void>): Promise<boolean> {
      const now = input.now ?? Date.now
      const completedSteps = detachedSteps.get(input.sessionId) ?? []
      detachedSteps.set(input.sessionId, completedSteps)
      const settled = settleInline(work)
      const outcome = await raceAgainstBudget(settled, Math.max(0, input.deadlineAt - now()))
      if (outcome === BUDGET_EXPIRED) {
        // The handler returns here; the work keeps running so what it owns is still released.
        void settled.then((error: unknown) => {
          if (error === undefined) return
          options.logger?.warn("memory shutdown drain detached step failed", {
            step: name,
            reason: input.reason,
            sessionId: input.sessionId,
            error: String(error),
          })
        })
        options.logger?.warn("memory shutdown drain hit its budget", {
          step: name,
          reason: input.reason,
          sessionId: input.sessionId,
          remainingMs: Math.max(0, input.deadlineAt - now()),
          completedSteps: [...completedSteps],
        })
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
    },
    async run(input: ShutdownDrainInput, settings): Promise<void> {
      await execute(input, settings)
      detachedSteps.delete(input.sessionId)
    },
  }
}

/** Starts the work and turns its rejection into a value, so an abandoned step never goes unhandled. */
function settleInline(work: () => Promise<void>): Promise<unknown> {
  return work().then(
    () => undefined,
    (error: unknown) => error,
  )
}

/** The settled result (`undefined` on success, otherwise the error) or `BUDGET_EXPIRED`. */
async function raceAgainstBudget(settled: Promise<unknown>, remainingMs: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<typeof BUDGET_EXPIRED>((resolve) => {
    timer = setTimeout(() => resolve(BUDGET_EXPIRED), remainingMs)
  })
  const outcome = await Promise.race([settled, expired])
  if (timer !== undefined) clearTimeout(timer)
  return outcome
}

const BUDGET_EXPIRED = Symbol("shutdown-drain-budget-expired")
