import { describe, expect, test } from "bun:test"

import {
  createQuestionVisibilityWatchdog,
  createSessionMessageQuestionProbe,
  QUESTION_VISIBILITY_DEFAULT_GRACE_MS,
  type PendingQuestionProbeResult,
} from "./watchdog"

type ManualScheduler = {
  runAll: () => Promise<void>
  scheduledCount: () => number
}

function createManualScheduler(): ManualScheduler & {
  schedule: (callback: () => void, ms: number) => () => void
} {
  const callbacks: Array<() => void> = []
  return {
    schedule: (callback) => {
      callbacks.push(callback)
      return () => {
        const index = callbacks.indexOf(callback)
        if (index !== -1) callbacks.splice(index, 1)
      }
    },
    runAll: async () => {
      const pending = [...callbacks]
      callbacks.length = 0
      for (const callback of pending) callback()
    },
    scheduledCount: () => callbacks.length,
  }
}

function waitingProbe(): PendingQuestionProbeResult {
  return { state: "waiting" }
}

function resolvedProbe(): PendingQuestionProbeResult {
  return { state: "resolved" }
}

describe("createQuestionVisibilityWatchdog", () => {
  test("#given question stays pending past grace #when grace elapses #then one visibility toast is shown", async () => {
    const scheduler = createManualScheduler()
    const toasts: string[] = []
    const watchdog = createQuestionVisibilityWatchdog({
      probeQuestionToolState: async () => waitingProbe(),
      showToast: async (body) => {
        toasts.push(body)
      },
      schedule: scheduler.schedule,
    })

    watchdog.onQuestionExecuted({ sessionID: "ses_parent", callID: "call_q1" })
    expect(toasts).toHaveLength(0)

    await scheduler.runAll()

    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toContain("ses_parent")
    watchdog.dispose()
  })

  test("#given question resolves within grace #when grace elapses #then no toast is shown", async () => {
    const scheduler = createManualScheduler()
    const toasts: string[] = []
    const watchdog = createQuestionVisibilityWatchdog({
      probeQuestionToolState: async () => resolvedProbe(),
      showToast: async (body) => {
        toasts.push(body)
      },
      schedule: scheduler.schedule,
    })

    watchdog.onQuestionExecuted({ sessionID: "ses_parent", callID: "call_q2" })
    await scheduler.runAll()

    expect(toasts).toHaveLength(0)
    watchdog.dispose()
  })

  test("#given duplicate registrations for the same call #when grace elapses once #then exactly one toast is shown", async () => {
    const scheduler = createManualScheduler()
    const toasts: string[] = []
    const watchdog = createQuestionVisibilityWatchdog({
      probeQuestionToolState: async () => waitingProbe(),
      showToast: async (body) => {
        toasts.push(body)
      },
      schedule: scheduler.schedule,
    })

    watchdog.onQuestionExecuted({ sessionID: "ses_parent", callID: "call_dup" })
    watchdog.onQuestionExecuted({ sessionID: "ses_parent", callID: "call_dup" })
    expect(scheduler.scheduledCount()).toBe(1)

    await scheduler.runAll()

    expect(toasts).toHaveLength(1)
    watchdog.dispose()
  })

  test("#given distinct calls register #when grace elapses #then each pending call is probed separately", async () => {
    const scheduler = createManualScheduler()
    const toasts: string[] = []
    const probes: string[] = []
    const watchdog = createQuestionVisibilityWatchdog({
      probeQuestionToolState: async (ref) => {
        probes.push(`${ref.sessionID}:${ref.callID ?? ""}`)
        return waitingProbe()
      },
      showToast: async (body) => {
        toasts.push(body)
      },
      schedule: scheduler.schedule,
    })

    watchdog.onQuestionExecuted({ sessionID: "ses_a", callID: "call_a" })
    watchdog.onQuestionExecuted({ sessionID: "ses_b", callID: "call_b" })
    await scheduler.runAll()

    expect(probes).toEqual(["ses_a:call_a", "ses_b:call_b"])
    expect(toasts).toHaveLength(2)
    watchdog.dispose()
  })

  test("#given dispose runs before grace #when grace would elapse #then nothing is probed or shown", async () => {
    const scheduler = createManualScheduler()
    const toasts: string[] = []
    let probed = false
    const watchdog = createQuestionVisibilityWatchdog({
      probeQuestionToolState: async () => {
        probed = true
        return waitingProbe()
      },
      showToast: async (body) => {
        toasts.push(body)
      },
      schedule: scheduler.schedule,
    })

    watchdog.onQuestionExecuted({ sessionID: "ses_parent", callID: "call_gone" })
    watchdog.dispose()
    await scheduler.runAll()

    expect(probed).toBe(false)
    expect(toasts).toHaveLength(0)
  })

  test("#given probe fails #when grace elapses #then watchdog stays silent and does not throw", async () => {
    const scheduler = createManualScheduler()
    const toasts: string[] = []
    const watchdog = createQuestionVisibilityWatchdog({
      probeQuestionToolState: async () => {
        throw new Error("messages fetch failed")
      },
      showToast: async (body) => {
        toasts.push(body)
      },
      schedule: scheduler.schedule,
    })

    watchdog.onQuestionExecuted({ sessionID: "ses_parent", callID: "call_err" })
    await scheduler.runAll()

    expect(toasts).toHaveLength(0)
    watchdog.dispose()
  })

  test("#given no custom grace configured #when created #then default grace is exported and positive", () => {
    expect(QUESTION_VISIBILITY_DEFAULT_GRACE_MS).toBeGreaterThan(0)
  })

  test("#given probe built from a client #when probing a running question part #then directory query is sent and state is waiting", async () => {
    const calls: Array<Record<string, unknown>> = []
    const client = {
      session: {
        messages: async (args: Record<string, unknown>) => {
          calls.push(args)
          return {
            data: [
              {
                info: { role: "user" },
                parts: [{ type: "text", text: "start" }],
              },
              {
                info: { role: "assistant", finish: "tool-calls" },
                parts: [
                  {
                    type: "tool",
                    tool: "question",
                    callID: "call_q9",
                    state: { status: "running" },
                  },
                ],
              },
            ],
          }
        },
      },
    }

    const probe = createSessionMessageQuestionProbe(client, "/tmp/proj")
    const result = await probe({ sessionID: "ses_dir", callID: "call_q9" })

    expect(result.state).toBe("waiting")
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      path: { id: "ses_dir" },
      query: { directory: "/tmp/proj" },
    })
  })

  test("#given probe built from a client #when question part already completed #then state is resolved", async () => {
    const client = {
      session: {
        messages: async () => ({
          data: [
            {
              info: { role: "assistant", finish: "tool-calls" },
              parts: [
                {
                  type: "tool",
                  tool: "question",
                  callID: "call_done",
                  state: { status: "completed" },
                },
              ],
            },
          ],
        }),
      },
    }

    const probe = createSessionMessageQuestionProbe(client)
    const result = await probe({ sessionID: "ses_x", callID: "call_done" })

    expect(result.state).toBe("resolved")
  })
})
