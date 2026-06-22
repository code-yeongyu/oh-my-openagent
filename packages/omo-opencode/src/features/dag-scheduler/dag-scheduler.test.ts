import { describe, expect, test, mock } from "bun:test"
import { DagScheduler, type DagTask } from "./dag-scheduler"
import type { ExecutorContext, ParentContext } from "../../tools/delegate-task/executor-types"
import type { ToolContextWithMetadata } from "../../tools/delegate-task/types"

describe("DagScheduler", () => {
  test("should detect cycles in DAG", () => {
    const tasks: DagTask[] = [
      { id: "task1", agent: "coder", prompt: "A", dependencies: ["task2"] },
      { id: "task2", agent: "research", prompt: "B", dependencies: ["task1"] },
    ]

    const scheduler = new DagScheduler({
      tasks,
      executorCtx: {} as any,
      toolCtx: {} as any,
      parentContext: {} as any,
    })

    expect(scheduler.hasCycles()).toBe(true)
  })

  test("should detect no cycle in valid DAG", () => {
    const tasks: DagTask[] = [
      { id: "task1", agent: "coder", prompt: "A", dependencies: [] },
      { id: "task2", agent: "research", prompt: "B", dependencies: ["task1"] },
    ]

    const scheduler = new DagScheduler({
      tasks,
      executorCtx: {} as any,
      toolCtx: {} as any,
      parentContext: {} as any,
    })

    expect(scheduler.hasCycles()).toBe(false)
  })

  test("should run tasks in DAG order and propagate results", async () => {
    const tasks: DagTask[] = [
      { id: "task1", agent: "research", prompt: "A", dependencies: [] },
      { id: "task2", agent: "coder", prompt: "B", dependencies: ["task1"] },
    ]

    const taskHistory = new Map<string, { status: string; sessionId?: string }>()
    taskHistory.set("bg_1", { status: "pending", sessionId: "ses_child_1" })
    taskHistory.set("bg_2", { status: "pending", sessionId: "ses_child_2" })

    let launchCount = 0

    // Mock manager
    const manager = {
      launch: async (input: any) => {
        launchCount++
        const bgId = `bg_${launchCount}`
        // Verify prompt propagation in second task
        if (launchCount === 2) {
          expect(input.prompt).toContain("Deliverable from preceding task 'task1'")
          expect(input.prompt).toContain("Task Result for task1")
        }
        return {
          id: bgId,
          sessionId: `ses_child_${launchCount}`,
          description: input.description,
          agent: input.agent,
          status: "running",
        }
      },
      getTask: (id: string) => {
        // Automatically advance task states
        const t = taskHistory.get(id)
        if (t) {
          if (t.status === "pending") {
            t.status = "running"
          } else if (t.status === "running") {
            t.status = "completed"
          }
          return {
            id,
            sessionId: t.sessionId,
            status: t.status,
            startedAt: new Date(),
            completedAt: new Date(),
          }
        }
        return undefined
      },
      reserveSubagentSpawn: async () => ({
        spawnContext: { rootSessionID: "ses_root", childDepth: 1 },
        descendantCount: 1,
        commit: () => {},
        rollback: () => {},
      }),
    } as any

    const mockMessages = mock((input: any) => {
      const sessionId = input.path.id
      return Promise.resolve({
        data: [
          {
            info: { role: "assistant", time: "2026-06-22T06:00:00Z" },
            parts: [{ type: "text", text: `Task Result for ${sessionId === "ses_child_1" ? "task1" : "task2"}` }],
          },
        ],
      })
    })

    const client = {
      session: {
        messages: mockMessages,
        get: async () => ({ data: { directory: "/fake/dir" } }),
      },
    } as any

    const executorCtx: ExecutorContext = {
      manager,
      client,
      directory: "/fake/dir",
    }

    const toolCtx: ToolContextWithMetadata = {
      sessionID: "ses_parent",
      messageID: "msg_parent",
      agent: "sisyphus",
      abort: new AbortController().signal,
      metadata: () => {},
    }

    const parentContext: ParentContext = {
      sessionID: "ses_parent",
      messageID: "msg_parent",
    }

    const scheduler = new DagScheduler({
      tasks,
      executorCtx,
      toolCtx,
      parentContext,
    })

    const report = await scheduler.run()

    expect(launchCount).toBe(2)
    expect(report).toContain("Status: completed")
    expect(report).toContain("Task Result for task1")
    expect(report).toContain("Task Result for task2")
  })
})
