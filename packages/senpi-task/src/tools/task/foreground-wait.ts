import type { TaskManager } from "../../manager"
import type { TaskRecord } from "../../state"
import type { TaskToolContext } from "./types"

const PROMPT_CACHE_SAFE_WAIT_ENV = "PI_PROMPT_CACHE_SAFE_WAIT_SECONDS"

export type ScheduleDeadline = (callback: () => void, delayMs: number) => () => void

export type ForegroundWaitOptions = {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly scheduleDeadline?: ScheduleDeadline
}

export type ForegroundWaitResult =
  | { readonly kind: "completed"; readonly record: TaskRecord }
  | { readonly kind: "promoted"; readonly budgetSeconds: number }

export type ForegroundWaitInput = ForegroundWaitOptions & {
  readonly manager: TaskManager
  readonly taskId: string
  readonly signal: AbortSignal | undefined
  readonly ctx: TaskToolContext
}

const scheduleDeadline: ScheduleDeadline = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs)
  timer.unref?.()
  return () => clearTimeout(timer)
}

export function resolvePromptCacheSafeWaitSeconds(
  ctx: TaskToolContext,
  env: Readonly<Record<string, string | undefined>> = process.env,
): number | undefined {
  if (typeof ctx.getPromptCacheSafeWaitSeconds === "function") {
    return ctx.getPromptCacheSafeWaitSeconds()
  }
  const raw = env[PROMPT_CACHE_SAFE_WAIT_ENV]
  if (raw === undefined) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

export async function waitForForegroundTask(input: ForegroundWaitInput): Promise<ForegroundWaitResult> {
  const budgetSeconds = resolvePromptCacheSafeWaitSeconds(input.ctx, input.env ?? process.env)
  const waiting = input.manager
    .waitFor(input.taskId, { signal: input.signal })
    .then((record): ForegroundWaitResult => ({ kind: "completed", record }))
  if (budgetSeconds === undefined) return waiting

  let cancelDeadline = (): void => {}
  const deadline = new Promise<ForegroundWaitResult>((resolve) => {
    cancelDeadline = (input.scheduleDeadline ?? scheduleDeadline)(() => {
      input.manager.promoteToBackground(input.taskId)
      resolve({ kind: "promoted", budgetSeconds })
    }, budgetSeconds * 1_000)
  })

  try {
    return await Promise.race([waiting, deadline])
  } finally {
    cancelDeadline()
  }
}
