import { z } from "zod"
import type { BackgroundTaskConfig } from "../../config/schema/background-task"
import { createToolCallSignature } from "../background-agent/loop-detector"
import {
  DEFAULT_CIRCUIT_BREAKER_CONSECUTIVE_THRESHOLD,
  DEFAULT_CIRCUIT_BREAKER_ENABLED,
} from "../background-agent/constants"

/**
 * Couche 1 root fix for the silent-abort delegation loop.
 *
 * A malformed `task()` (empty prompt, or missing all of category/subagent_type/
 * task_id) used to fall through to `execute()` which returned a *plain string
 * error* as a successful tool result. The orchestrator never observed a
 * failure, so it re-dispatched the same broken call forever.
 *
 * This module enforces the contract PRE-DISPATCH (before any subagent session
 * is created). Invalid calls are rejected with a structured, actionable error
 * so the orchestrator sees the failure and can self-correct or fall back to
 * direct execution. A signature-based circuit breaker trips after
 * `consecutiveThreshold` identical failures to hard-stop a runaway loop.
 */

export const taskDispatchSchema = z
  .object({
    prompt: z.string().optional(),
    category: z.string().min(1).optional(),
    subagent_type: z.string().min(1).optional(),
    task_id: z.string().min(1).optional(),
    run_in_background: z.boolean().optional(),
    load_skills: z.array(z.string()).optional(),
    description: z.string().optional(),
    command: z.string().optional(),
  })
  .refine(
    (args) => Boolean(args.category) || Boolean(args.subagent_type) || Boolean(args.task_id),
    { message: "task() requires at least one of: category, subagent_type, or task_id" },
  )

export interface AntiLoopSettings {
  enabled: boolean
  consecutiveThreshold: number
}

export interface TaskDispatchValidationResult {
  ok: boolean
  cause?: string
  signature: string
  tripped: boolean
}

// Per-session failure counters keyed by `${sessionID}::${signature}`.
// In-memory only: a process restart clears it, which is acceptable because the
// breaker's primary job is to stop an *active* runaway loop, not to persist.
const failureCounts = new Map<string, Map<string, number>>()

export function resolveAntiLoopSettings(config?: BackgroundTaskConfig): AntiLoopSettings {
  return {
    enabled: config?.circuitBreaker?.enabled ?? DEFAULT_CIRCUIT_BREAKER_ENABLED,
    consecutiveThreshold:
      config?.circuitBreaker?.consecutiveThreshold ?? DEFAULT_CIRCUIT_BREAKER_CONSECUTIVE_THRESHOLD,
  }
}

export function validateTaskDispatch(
  sessionID: string,
  args: Record<string, unknown>,
  settings?: AntiLoopSettings,
): TaskDispatchValidationResult {
  const resolved = settings ?? {
    enabled: DEFAULT_CIRCUIT_BREAKER_ENABLED,
    consecutiveThreshold: DEFAULT_CIRCUIT_BREAKER_CONSECUTIVE_THRESHOLD,
  }
  const signature = createToolCallSignature("task", args)
  const parsed = taskDispatchSchema.safeParse(args)

  if (parsed.success) {
    // A valid dispatch breaks any consecutive-failure chain for this session.
    failureCounts.get(sessionID)?.clear()
    return { ok: true, signature, tripped: false }
  }

  const cause = parsed.error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "args"
      return `${path}: ${issue.message}`
    })
    .join("; ")

  if (!resolved.enabled) {
    // Breaker disabled: reject this single malformed call with a structured
    // cause, but do not accumulate (no trip behavior).
    return { ok: false, cause, signature, tripped: false }
  }

  const sessionCounts = failureCounts.get(sessionID) ?? new Map<string, number>()
  const next = (sessionCounts.get(signature) ?? 0) + 1
  sessionCounts.set(signature, next)
  failureCounts.set(sessionID, sessionCounts)
  return { ok: false, cause, signature, tripped: next >= resolved.consecutiveThreshold }
}

/**
 * Structured error surfaced to the orchestrator when a `task()` call is
 * rejected. On trip, includes an explicit fallback directive so the loop is
 * broken rather than re-dispatched.
 */
export function buildTaskDispatchError(cause: string, tripped: boolean): string {
  const header = "[task] pre-dispatch validation rejected the delegation"
  const body = `Cause: ${cause}.`
  const fallback = tripped
    ? " Circuit breaker TRIPPED: this malformed task() signature has failed repeatedly. Do NOT re-delegate the same broken call. Either fix the arguments (non-empty prompt + one of category/subagent_type/task_id) or execute the work directly in this session instead of delegating."
    : " Fix the arguments and retry once, or execute the work directly in this session."
  return `${header}. ${body}${fallback}`
}
