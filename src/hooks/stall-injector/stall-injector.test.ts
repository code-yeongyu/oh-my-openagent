import { describe, expect, mock, test } from "bun:test"

import type { BackgroundTask, TaskProgress } from "../../features/background-agent"
import { createStallInjectorHook } from "./stall-injector"

type ChatMessageHandler = ReturnType<typeof createStallInjectorHook>["chat.message"]
type ChatMessageOutput = Parameters<ChatMessageHandler>[1]

function makeTask(overrides: Partial<BackgroundTask> & { id: string }): BackgroundTask {
  return {
    agent: "sisyphus",
    status: "running",
    parentSessionId: "ses-1",
    parentMessageId: "msg-1",
    description: "test task",
    prompt: "test prompt",
    ...overrides,
  } as BackgroundTask
}

function makeProgress(overrides: Partial<TaskProgress>): TaskProgress {
  return {
    toolCalls: 1,
    lastUpdate: new Date(),
    ...overrides,
  }
}

describe("createStallInjectorHook", () => {
  test("#given task stalled 35s #when chat.message #then injects warning alert", async () => {
    // given
    const now = Date.now()
    const tasks = [
      makeTask({
        id: "task-1",
        agent: "hephaestus",
        progress: makeProgress({
          toolCalls: 5,
          lastTool: "grep",
          lastUpdate: new Date(now - 35_000),
        }),
      }),
    ]

    const getTasksByParentSession = mock((_sessionId: string) => tasks)
    const getConfig = mock(() => ({}))
    const hook = createStallInjectorHook({ getTasksByParentSession, getConfig })
    const output: ChatMessageOutput = { parts: [] }

    // when
    await hook["chat.message"]({ sessionID: "ses-1" }, output)

    // then
    expect(output.parts).toHaveLength(1)
    const text = output.parts[0].text ?? ""
    expect(text).toContain("[SUBAGENT STALL]")
    expect(text).toContain("hephaestus")
    expect(text).toContain("35s")
    expect(text).toContain("Task ID: task-1")
    expect(text).toContain("(last: grep)")
    expect(text).toContain('background_output(task_id="task-1")')
  })

  test("#given task stalled 125s #when chat.message #then injects critical alert", async () => {
    // given
    const now = Date.now()
    const tasks = [
      makeTask({
        id: "task-2",
        agent: "prometheus",
        progress: makeProgress({
          toolCalls: 12,
          lastTool: "Read",
          lastUpdate: new Date(now - 125_000),
        }),
      }),
    ]

    const getTasksByParentSession = mock((_sessionId: string) => tasks)
    const getConfig = mock(() => ({}))
    const hook = createStallInjectorHook({ getTasksByParentSession, getConfig })
    const output: ChatMessageOutput = { parts: [] }

    // when
    await hook["chat.message"]({ sessionID: "ses-1" }, output)

    // then
    expect(output.parts).toHaveLength(1)
    const text = output.parts[0].text ?? ""
    expect(text).toContain("[SUBAGENT STALL]")
    expect(text).toContain("prometheus")
    expect(text).toContain("2m5s")
    expect(text).toContain("(last: Read)")
  })

  test("#given task already alerted #when second chat.message #then suppresses duplicate alert", async () => {
    // given
    const now = Date.now()
    const tasks = [
      makeTask({
        id: "task-1",
        agent: "oracle",
        progress: makeProgress({
          toolCalls: 3,
          lastTool: "lsp_diagnostics",
          lastUpdate: new Date(now - 35_000),
        }),
      }),
    ]

    const getTasksByParentSession = mock((_sessionId: string) => tasks)
    const getConfig = mock(() => ({}))
    const hook = createStallInjectorHook({ getTasksByParentSession, getConfig })

    const output1: ChatMessageOutput = { parts: [] }
    await hook["chat.message"]({ sessionID: "ses-1" }, output1)
    expect(output1.parts).toHaveLength(1)

    const output2: ChatMessageOutput = { parts: [] }

    // when
    await hook["chat.message"]({ sessionID: "ses-1" }, output2)

    // then
    expect(output2.parts).toHaveLength(0)
  })

  test("#given 3 stalled tasks #when chat.message #then batches into single alert", async () => {
    // given
    const now = Date.now()
    const tasks: BackgroundTask[] = [
      makeTask({
        id: "task-a",
        agent: "atlas",
        progress: makeProgress({
          toolCalls: 2,
          lastTool: "glob",
          lastUpdate: new Date(now - 40_000),
        }),
      }),
      makeTask({
        id: "task-b",
        agent: "sisyphus-junior",
        progress: makeProgress({
          toolCalls: 7,
          lastTool: "grep",
          lastUpdate: new Date(now - 130_000),
        }),
      }),
      makeTask({
        id: "task-c",
        agent: "mom-s-son",
        progress: makeProgress({
          toolCalls: 1,
          lastTool: "Edit",
          lastUpdate: new Date(now - 50_000),
        }),
      }),
    ]

    const getTasksByParentSession = mock((_sessionId: string) => tasks)
    const getConfig = mock(() => ({}))
    const hook = createStallInjectorHook({ getTasksByParentSession, getConfig })
    const output: ChatMessageOutput = { parts: [] }

    // when
    await hook["chat.message"]({ sessionID: "ses-1" }, output)

    // then
    expect(output.parts).toHaveLength(1)
    const text = output.parts[0].text ?? ""
    expect(text).toContain("[SUBAGENT STALL]")
    expect(text).toContain("3 subagents stalled")
    expect(text).toContain("atlas")
    expect(text).toContain("sisyphus-junior")
    expect(text).toContain("mom-s-son")
    expect(text).toContain('background_output(task_id="<taskId>")')
  })

  test("#given task with recent progress 10s #when chat.message #then does not inject", async () => {
    // given
    const now = Date.now()
    const tasks = [
      makeTask({
        id: "task-1",
        agent: "explore",
        progress: makeProgress({
          toolCalls: 1,
          lastTool: "glob",
          lastUpdate: new Date(now - 10_000),
        }),
      }),
    ]

    const getTasksByParentSession = mock((_sessionId: string) => tasks)
    const getConfig = mock(() => ({}))
    const hook = createStallInjectorHook({ getTasksByParentSession, getConfig })
    const output: ChatMessageOutput = { parts: [] }

    // when
    await hook["chat.message"]({ sessionID: "ses-1" }, output)

    // then
    expect(output.parts).toHaveLength(0)
  })

  test("#given non-running task #when chat.message #then does not inject", async () => {
    // given
    const tasks = [
      makeTask({
        id: "task-1",
        agent: "metis",
        status: "completed",
        progress: makeProgress({
          toolCalls: 1,
          lastUpdate: new Date(Date.now() - 60_000),
        }),
      }),
    ]

    const getTasksByParentSession = mock((_sessionId: string) => tasks)
    const getConfig = mock(() => ({}))
    const hook = createStallInjectorHook({ getTasksByParentSession, getConfig })
    const output: ChatMessageOutput = { parts: [] }

    // when
    await hook["chat.message"]({ sessionID: "ses-1" }, output)

    // then
    expect(output.parts).toHaveLength(0)
  })

  test("#given task without progress or startedAt #when chat.message #then does not inject", async () => {
    // given
    const tasks = [
      makeTask({
        id: "task-1",
        agent: "librarian",
      }),
    ]

    const getTasksByParentSession = mock((_sessionId: string) => tasks)
    const getConfig = mock(() => ({}))
    const hook = createStallInjectorHook({ getTasksByParentSession, getConfig })
    const output: ChatMessageOutput = { parts: [] }

    // when
    await hook["chat.message"]({ sessionID: "ses-1" }, output)

    // then
    expect(output.parts).toHaveLength(0)
  })

  test("#given task with no progress but has startedAt #when chat.message #then uses startedAt for stall detection", async () => {
    // given
    const now = Date.now()
    const tasks = [
      makeTask({
        id: "task-1",
        agent: "sisyphus",
        startedAt: new Date(now - 40_000),
      }),
    ]

    const getTasksByParentSession = mock((_sessionId: string) => tasks)
    const getConfig = mock(() => ({}))
    const hook = createStallInjectorHook({ getTasksByParentSession, getConfig })
    const output: ChatMessageOutput = { parts: [] }

    // when
    await hook["chat.message"]({ sessionID: "ses-1" }, output)

    // then
    expect(output.parts).toHaveLength(1)
    const text = output.parts[0].text ?? ""
    expect(text).toContain("[SUBAGENT STALL]")
    expect(text).toContain("sisyphus")
    expect(text).toContain("(last: starting)")
  })

  test("#given custom config thresholds #when chat.message #then uses custom warning threshold", async () => {
    // given
    const now = Date.now()
    const tasks = [
      makeTask({
        id: "task-1",
        agent: "oracle",
        progress: makeProgress({
          toolCalls: 2,
          lastTool: "grep",
          lastUpdate: new Date(now - 15_000),
        }),
      }),
    ]

    const getTasksByParentSession = mock((_sessionId: string) => tasks)
    const getConfig = mock(() => ({
      stall_warning_after_ms: 10_000,
      stall_critical_after_ms: 120_000,
    }))

    const hook = createStallInjectorHook({ getTasksByParentSession, getConfig })
    const output: ChatMessageOutput = { parts: [] }

    // when
    await hook["chat.message"]({ sessionID: "ses-1" }, output)

    // then
    expect(output.parts).toHaveLength(1)
    expect(output.parts[0].text ?? "").toContain("oracle")
  })

  test("#given critical threshold below warning #when chat.message #then warning threshold remains first escalation", async () => {
    // given
    const now = Date.now()
    const tasks = [
      makeTask({
        id: "task-1",
        agent: "oracle",
        progress: makeProgress({
          toolCalls: 2,
          lastTool: "grep",
          lastUpdate: new Date(now - 20_000),
        }),
      }),
    ]

    const getTasksByParentSession = mock((_sessionId: string) => tasks)
    const getConfig = mock(() => ({
      stall_warning_after_ms: 30_000,
      stall_critical_after_ms: 10_000,
    }))

    const hook = createStallInjectorHook({ getTasksByParentSession, getConfig })
    const output: ChatMessageOutput = { parts: [] }

    // when
    await hook["chat.message"]({ sessionID: "ses-1" }, output)

    // then
    expect(output.parts).toHaveLength(0)
  })
})
