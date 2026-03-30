import { describe, expect, it } from "bun:test"

import { createHeartbeatStatusRuntime as createHeartbeatStatusRuntimeUntyped } from "../../assets/custom-opencode/plugins/heartbeat-status.js"

type HeartbeatHook = (...args: any[]) => Promise<void>

type HeartbeatRuntime = {
  hooks: Record<string, HeartbeatHook>
  getSessionSnapshot: (sessionID: string) => any
}

const createHeartbeatStatusRuntime = createHeartbeatStatusRuntimeUntyped as (options: Record<string, unknown>) => HeartbeatRuntime

function createRuntime() {
  const runtime = createHeartbeatStatusRuntime({
    client: {
      tui: {
        showToast: async () => true,
      },
      app: {
        log: async () => true,
      },
    },
    now: () => 90_000,
    setIntervalFn: () => ({}) as ReturnType<typeof setInterval>,
    clearIntervalFn: () => {},
  })

  return {
    hooks: runtime.hooks,
    runtime,
  }
}

describe("heartbeat waiting-for-subagents flow", () => {
  it("transitions running to waiting_for_subagents and back to running on background_output resume", async () => {
    const { hooks, runtime } = createRuntime()

    await hooks["chat.message"]?.(
      {
        sessionID: "ses_waiting",
        agent: "sisyphus",
      },
      {
        message: { role: "user" },
        parts: [],
      },
    )

    await hooks["tool.execute.before"]?.(
      {
        sessionID: "ses_waiting",
        callID: "call_task_before",
        tool: "task",
      },
      {
        args: {
          description: "inspect files",
        },
      },
    )

    expect(runtime.getSessionSnapshot("ses_waiting").state).toBe("running")

    await hooks["tool.execute.after"]?.(
      {
        sessionID: "ses_waiting",
        callID: "call_task_after",
        tool: "task",
        args: {
          description: "inspect files",
        },
      },
      {
        title: "Delegated",
        output: "spawned",
        metadata: {
          task_id: "task_123",
        },
      },
    )

    const waitingSnapshot = runtime.getSessionSnapshot("ses_waiting")

    expect(waitingSnapshot.state).toBe("waiting_for_subagents")
    expect(waitingSnapshot.progress.kind).toBe("indeterminate")
    expect(waitingSnapshot.progress.source).toBe("none")
    expect(waitingSnapshot.progress.percent).toBeUndefined()
    expect(waitingSnapshot.statusText).toContain("sisyphus")
    expect(waitingSnapshot.statusText).toContain("Сейчас ждёт результат фоновой задачи от подагента.")
    expect(waitingSnapshot.detailText).toContain("агент ждёт результат подагента")

    await hooks["tool.execute.before"]?.(
      {
        sessionID: "ses_waiting",
        callID: "call_background_before",
        tool: "background_output",
      },
      {
        args: {
          task_id: "task_123",
        },
      },
    )

    const resumedSnapshot = runtime.getSessionSnapshot("ses_waiting")

    expect(resumedSnapshot.state).toBe("running")
    expect(resumedSnapshot.progress.kind).toBe("indeterminate")
    expect(resumedSnapshot.statusText).toContain("Сейчас забирает результат фоновой задачи, чтобы возобновить работу.")

    await hooks["tool.execute.after"]?.(
      {
        sessionID: "ses_waiting",
        callID: "call_background_after",
        tool: "background_output",
        args: {
          task_id: "task_123",
        },
      },
      {
        title: "Background output",
        output: "done",
        metadata: {
          status: "completed",
        },
      },
    )

    const afterResumeSnapshot = runtime.getSessionSnapshot("ses_waiting")

    expect(afterResumeSnapshot.state).toBe("running")
    expect(afterResumeSnapshot.statusText).toContain("Сейчас возобновляет работу после ответа подагента.")
  })
})
