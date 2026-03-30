import { describe, expect, it } from "bun:test"

import { createHeartbeatStatusRuntime as createHeartbeatStatusRuntimeUntyped } from "../../assets/custom-opencode/plugins/heartbeat-status.js"

type HeartbeatHook = (...args: any[]) => Promise<void>

type HeartbeatRuntime = {
  hooks: Record<string, HeartbeatHook>
  getSessionSnapshot: (sessionID: string) => any
}

const createHeartbeatStatusRuntime = createHeartbeatStatusRuntimeUntyped as (options: Record<string, unknown>) => HeartbeatRuntime

function createMockClient() {
  const toasts: Array<Record<string, unknown>> = []
  const logs: Array<Record<string, unknown>> = []

  return {
    client: {
      tui: {
        showToast: async ({ body }: { body: Record<string, unknown> }) => {
          toasts.push(body)
          return true
        },
      },
      app: {
        log: async ({ body }: { body: Record<string, unknown> }) => {
          logs.push(body)
          return true
        },
      },
    },
    logs,
    toasts,
  }
}

function createRuntime() {
  const mock = createMockClient()

  const runtime = createHeartbeatStatusRuntime({
    client: mock.client,
    now: () => 65_000,
    setIntervalFn: () => ({}) as ReturnType<typeof setInterval>,
    clearIntervalFn: () => {},
  })

  return {
    ...mock,
    hooks: runtime.hooks,
    runtime,
  }
}

describe("heartbeat status presenter", () => {
  it("keeps progress indeterminate without todo or percent signals while preserving agent and stage text", async () => {
    const { hooks, runtime } = createRuntime()

    await hooks["chat.message"]?.(
      {
        sessionID: "ses_status",
        agent: "sisyphus",
      },
      {
        message: { role: "user" },
        parts: [],
      },
    )

    await hooks["tool.execute.before"]?.(
      {
        sessionID: "ses_status",
        callID: "call_read",
        tool: "read",
      },
      {
        args: { filePath: "README.md" },
      },
    )

    const snapshot = runtime.getSessionSnapshot("ses_status")

    expect(snapshot.state).toBe("running")
    expect(snapshot.progress.kind).toBe("indeterminate")
    expect(snapshot.progress.source).toBe("none")
    expect(snapshot.progress.percent).toBeUndefined()
    expect(snapshot.statusText).toContain("sisyphus")
    expect(snapshot.statusText).toContain("Сейчас читает файлы и собирает контекст.")
    expect(snapshot.detailText).toContain("Точный процент пока неизвестен")
    expect(snapshot.detailText).not.toContain("%")
  })

  it("uses determinate progress only when todo counts provide a real numeric signal", async () => {
    const { hooks, runtime } = createRuntime()

    await hooks["chat.message"]?.(
      {
        sessionID: "ses_todos",
        agent: "atlas",
      },
      {
        message: { role: "user" },
        parts: [],
      },
    )

    await hooks.event?.({
      event: {
        type: "todo.updated",
        properties: {
          sessionID: "ses_todos",
          todos: [
            { status: "completed" },
            { status: "in_progress" },
            { status: "pending" },
            { status: "completed" },
          ],
        },
      },
    })

    const snapshot = runtime.getSessionSnapshot("ses_todos")

    expect(snapshot.progress.kind).toBe("determinate")
    expect(snapshot.progress.source).toBe("todo")
    expect(snapshot.progress.percent).toBe(50)
    expect(snapshot.detailText).toContain("Прогресс 50%")
    expect(snapshot.detailText).toContain("Выполнено 2 из 4 шагов")
  })

  it("exposes the named idle, retrying, completed, and failed states", async () => {
    const { hooks, runtime } = createRuntime()

    expect(runtime.getSessionSnapshot("ses_states").state).toBe("idle")

    await hooks["chat.message"]?.(
      {
        sessionID: "ses_states",
        agent: "prometheus",
      },
      {
        message: { role: "user" },
        parts: [],
      },
    )

    await hooks.event?.({
      event: {
        type: "session.status",
        properties: {
          sessionID: "ses_states",
          status: {
            type: "retry",
            attempt: 2,
            message: "network retry",
            next: 60_000,
          },
        },
      },
    })

    expect(runtime.getSessionSnapshot("ses_states").state).toBe("retrying")

    await hooks.event?.({
      event: {
        type: "session.idle",
        properties: {
          sessionID: "ses_states",
        },
      },
    })

    const completedSnapshot = runtime.getSessionSnapshot("ses_states")
    expect(completedSnapshot.state).toBe("completed")
    expect(completedSnapshot.progress.kind).toBe("determinate")
    expect(completedSnapshot.progress.percent).toBe(100)

    await hooks["chat.message"]?.(
      {
        sessionID: "ses_states",
        agent: "prometheus",
      },
      {
        message: { role: "user" },
        parts: [],
      },
    )

    await hooks.event?.({
      event: {
        type: "session.error",
        properties: {
          sessionID: "ses_states",
          error: {
            message: "upstream provider failed",
          },
        },
      },
    })

    const failedSnapshot = runtime.getSessionSnapshot("ses_states")
    expect(failedSnapshot.state).toBe("failed")
    expect(failedSnapshot.detailText).toContain("Причина: upstream provider failed.")
  })
})
