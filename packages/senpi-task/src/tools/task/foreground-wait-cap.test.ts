import { describe, expect, test } from "bun:test"

import type { StartResult } from "../../manager"
import type { TaskRecord } from "../../state"
import { CTX, createFakeManager, makeDeps } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"
import { waitForForegroundTask, type ForegroundWaitResult, type ScheduleDeadline } from "./foreground-wait"
import type { TaskToolContext } from "./types"

const TASK_ID = "st_00000900"

type Scheduled = { readonly delayMs: number; readonly fire: () => void }

function deadlineHarness(): { readonly scheduleDeadline: ScheduleDeadline; readonly scheduled: Scheduled[] } {
  const scheduled: Scheduled[] = []
  return {
    scheduled,
    scheduleDeadline: (callback, delayMs) => {
      scheduled.push({ delayMs, fire: callback })
      return () => {}
    },
  }
}

function contextWithBudget(budgetSeconds: number): TaskToolContext {
  return { ...CTX, getPromptCacheSafeWaitSeconds: () => budgetSeconds }
}

async function promoteAtDeadline(
  ctx: TaskToolContext,
  env: Readonly<Record<string, string | undefined>>,
): Promise<{ readonly delays: number[]; readonly result: ForegroundWaitResult; readonly promoted: string[] }> {
  const timer = deadlineHarness()
  const promoted: string[] = []
  const manager = createFakeManager({
    waitFor: () => new Promise<TaskRecord>(() => undefined),
    promoteToBackground: (taskId) => {
      promoted.push(taskId)
      return true
    },
  })
  const waiting = waitForForegroundTask({
    manager,
    taskId: TASK_ID,
    signal: undefined,
    ctx,
    env,
    scheduleDeadline: timer.scheduleDeadline,
  })
  const delays = timer.scheduled.map((deadline) => deadline.delayMs)
  timer.scheduled[0]?.fire()
  return { delays, result: await waiting, promoted }
}

describe("foreground wait cap", () => {
  test("#given a 1 h cache TTL budget from the context getter #when the wait starts #then the deadline is capped at 900 s and the promotion reports 900", async () => {
    // given
    const ctx = contextWithBudget(3570)

    // when
    const { delays, result, promoted } = await promoteAtDeadline(ctx, {})

    // then
    expect(delays).toEqual([900_000])
    expect(result).toEqual({ kind: "promoted", budgetSeconds: 900 })
    expect(promoted).toEqual([TASK_ID])
  })

  test("#given a 1 h cache TTL budget from the env bridge #when the wait starts #then the same 900 s cap applies", async () => {
    // given
    const env = { PI_PROMPT_CACHE_SAFE_WAIT_SECONDS: "3570" }

    // when
    const { delays, result } = await promoteAtDeadline(CTX, env)

    // then
    expect(delays).toEqual([900_000])
    expect(result).toEqual({ kind: "promoted", budgetSeconds: 900 })
  })

  test("#given a 5 min cache TTL budget #when the wait starts #then the budget is under the cap and is used as is", async () => {
    // given
    const ctx = contextWithBudget(270)

    // when
    const { delays, result } = await promoteAtDeadline(ctx, {})

    // then
    expect(delays).toEqual([270_000])
    expect(result).toEqual({ kind: "promoted", budgetSeconds: 270 })
  })

  test("#given a capped budget #when the task tool promotes the child #then the notice states the effective 900 s wait", async () => {
    // given
    const timer = deadlineHarness()
    let waitStarted = (): void => {}
    const started = new Promise<void>((resolve) => {
      waitStarted = resolve
    })
    const manager = createFakeManager({
      start: (): Promise<StartResult> =>
        Promise.resolve({ kind: "started", task_id: TASK_ID, status: "running", name: "capped-task" }),
      waitFor: () => {
        waitStarted()
        return new Promise<TaskRecord>(() => undefined)
      },
    })
    const execute = buildTaskExecute(makeDeps(manager), { env: {}, scheduleDeadline: timer.scheduleDeadline })
    const execution = execute("capped", { prompt: "long work", category: "quick" }, undefined, undefined, contextWithBudget(3570))
    await started

    // when
    timer.scheduled[0]?.fire()
    const output = await execution

    // then
    const content = output.content[0]
    const text = content?.type === "text" ? content.text : ""
    expect(text).toContain("(900s)")
    expect(text).not.toContain("3570")
  })
})
