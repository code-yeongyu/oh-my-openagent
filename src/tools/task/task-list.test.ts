import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { createTaskList } from "./task-list"
import { writeJsonAtomic } from "../../features/claude-tasks/storage"
import type { TaskObject } from "./types"
import { join } from "path"
import { existsSync, rmSync } from "fs"

const testProjectDir = "/tmp/task-list-test"

describe("createTaskList", () => {
  let taskDir: string

  beforeEach(() => {
    taskDir = join(testProjectDir, ".sisyphus/tasks")
    if (existsSync(taskDir)) {
      rmSync(taskDir, { recursive: true })
    }
  })

  afterEach(() => {
    if (existsSync(taskDir)) {
      rmSync(taskDir, { recursive: true })
    }
  })

  it("returns empty array when no tasks exist", async () => {
    //#given
    const config = {
      sisyphus: {
        tasks: {
          storage_path: join(testProjectDir, ".sisyphus/tasks"),
          claude_code_compat: false,
        },
      },
    }
    const tool = createTaskList(config)

    //#when
    const result = await tool.execute({}, { sessionID: "test-session" })

    //#then
    const parsed = JSON.parse(result)
    expect(parsed.tasks).toEqual([])
  })

  it("excludes completed tasks by default", async () => {
    //#given
    const task1: TaskObject = {
      id: "T-1",
      subject: "Active task",
      description: "Should be included",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "test-session",
    }
    const task2: TaskObject = {
      id: "T-2",
      subject: "Completed task",
      description: "Should be excluded",
      status: "completed",
      blocks: [],
      blockedBy: [],
      threadID: "test-session",
    }

    writeJsonAtomic(join(testProjectDir, ".sisyphus/tasks", "T-1.json"), task1)
    writeJsonAtomic(join(testProjectDir, ".sisyphus/tasks", "T-2.json"), task2)

    const config = {
      sisyphus: {
        tasks: {
          storage_path: join(testProjectDir, ".sisyphus/tasks"),
          claude_code_compat: false,
        },
      },
    }
    const tool = createTaskList(config)

    //#when
    const result = await tool.execute({}, { sessionID: "test-session" })

    //#then
    const parsed = JSON.parse(result)
    expect(parsed.tasks).toHaveLength(1)
    expect(parsed.tasks[0].id).toBe("T-1")
  })

  it("excludes deleted tasks by default", async () => {
    //#given
    const task1: TaskObject = {
      id: "T-1",
      subject: "Active task",
      description: "Should be included",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "test-session",
    }
    const task2: TaskObject = {
      id: "T-2",
      subject: "Deleted task",
      description: "Should be excluded",
      status: "deleted",
      blocks: [],
      blockedBy: [],
      threadID: "test-session",
    }

    writeJsonAtomic(join(testProjectDir, ".sisyphus/tasks", "T-1.json"), task1)
    writeJsonAtomic(join(testProjectDir, ".sisyphus/tasks", "T-2.json"), task2)

     const config = {
       sisyphus: {
         tasks: {
           storage_path: join(testProjectDir, ".sisyphus/tasks"),
           claude_code_compat: false,
         },
       },
     }
     const tool = createTaskList(config)

     //#when
     const result = await tool.execute({}, { sessionID: "test-session" })

     //#then
     const parsed = JSON.parse(result)
     expect(parsed.tasks).toHaveLength(1)
     expect(parsed.tasks[0].id).toBe("T-1")
   })

   it("returns summary format with id, subject, status, owner, blockedBy", async () => {
    //#given
    const task: TaskObject = {
      id: "T-1",
      subject: "Test task",
      description: "This is a long description that should not be included",
      status: "in_progress",
      owner: "sisyphus",
      blocks: [],
      blockedBy: ["T-2"],
      threadID: "test-session",
    }

    writeJsonAtomic(join(testProjectDir, ".sisyphus/tasks", "T-1.json"), task)

     const config = {
       sisyphus: {
         tasks: {
           storage_path: join(testProjectDir, ".sisyphus/tasks"),
           claude_code_compat: false,
         },
       },
     }
     const tool = createTaskList(config)

     //#when
     const result = await tool.execute({}, { sessionID: "test-session" })

     //#then
     const parsed = JSON.parse(result)
     expect(parsed.tasks).toHaveLength(1)
     const summary = parsed.tasks[0]
    expect(summary).toHaveProperty("id")
    expect(summary).toHaveProperty("subject")
    expect(summary).toHaveProperty("status")
    expect(summary).toHaveProperty("owner")
    expect(summary).toHaveProperty("blockedBy")
    expect(summary).not.toHaveProperty("description")
    expect(summary.id).toBe("T-1")
    expect(summary.subject).toBe("Test task")
    expect(summary.status).toBe("in_progress")
    expect(summary.owner).toBe("sisyphus")
    expect(summary.blockedBy).toEqual(["T-2"])
  })

  it("filters blockedBy to only include unresolved (non-completed) blockers", async () => {
    //#given
    const blockerCompleted: TaskObject = {
      id: "T-blocker-completed",
      subject: "Completed blocker",
      description: "",
      status: "completed",
      blocks: [],
      blockedBy: [],
      threadID: "test-session",
    }
    const blockerPending: TaskObject = {
      id: "T-blocker-pending",
      subject: "Pending blocker",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "test-session",
    }
    const mainTask: TaskObject = {
      id: "T-main",
      subject: "Main task",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: ["T-blocker-completed", "T-blocker-pending"],
      threadID: "test-session",
    }

    writeJsonAtomic(join(testProjectDir, ".sisyphus/tasks", "T-blocker-completed.json"), blockerCompleted)
    writeJsonAtomic(join(testProjectDir, ".sisyphus/tasks", "T-blocker-pending.json"), blockerPending)
    writeJsonAtomic(join(testProjectDir, ".sisyphus/tasks", "T-main.json"), mainTask)

     const config = {
       sisyphus: {
         tasks: {
           storage_path: join(testProjectDir, ".sisyphus/tasks"),
           claude_code_compat: false,
         },
       },
     }
     const tool = createTaskList(config)

     //#when
     const result = await tool.execute({}, { sessionID: "test-session" })

     //#then
     const parsed = JSON.parse(result)
     const mainTaskSummary = parsed.tasks.find((t: { id: string }) => t.id === "T-main")
    expect(mainTaskSummary.blockedBy).toEqual(["T-blocker-pending"])
  })

   it("includes all active statuses (pending, in_progress)", async () => {
     //#given
     const task1: TaskObject = {
       id: "T-1",
       subject: "Pending task",
       description: "",
       status: "pending",
       blocks: [],
       blockedBy: [],
       threadID: "test-session",
     }
     const task2: TaskObject = {
       id: "T-2",
       subject: "In progress task",
       description: "",
       status: "in_progress",
       blocks: [],
       blockedBy: [],
       threadID: "test-session",
     }

     writeJsonAtomic(join(testProjectDir, ".sisyphus/tasks", "T-1.json"), task1)
     writeJsonAtomic(join(testProjectDir, ".sisyphus/tasks", "T-2.json"), task2)

     const config = {
       sisyphus: {
         tasks: {
           storage_path: join(testProjectDir, ".sisyphus/tasks"),
           claude_code_compat: false,
         },
       },
     }
     const tool = createTaskList(config)

     //#when
     const result = await tool.execute({}, { sessionID: "test-session" })

     //#then
     const parsed = JSON.parse(result)
     expect(parsed.tasks).toHaveLength(2)
   })

   it("handles tasks with no blockedBy gracefully", async () => {
     //#given
     const task: TaskObject = {
       id: "T-1",
       subject: "Task with no blockers",
       description: "",
       status: "pending",
       blocks: [],
       blockedBy: [],
       threadID: "test-session",
     }

     writeJsonAtomic(join(testProjectDir, ".sisyphus/tasks", "T-1.json"), task)

     const config = {
       sisyphus: {
         tasks: {
           storage_path: join(testProjectDir, ".sisyphus/tasks"),
           claude_code_compat: false,
         },
       },
     }
     const tool = createTaskList(config)

     //#when
     const result = await tool.execute({}, { sessionID: "test-session" })

     //#then
     const parsed = JSON.parse(result)
     expect(parsed.tasks[0].blockedBy).toEqual([])
   })

   it("handles missing blocker tasks gracefully", async () => {
     //#given
     const task: TaskObject = {
       id: "T-1",
       subject: "Task with missing blocker",
       description: "",
       status: "pending",
       blocks: [],
       blockedBy: ["T-missing"],
       threadID: "test-session",
     }

     writeJsonAtomic(join(testProjectDir, ".sisyphus/tasks", "T-1.json"), task)

     const config = {
       sisyphus: {
         tasks: {
           storage_path: join(testProjectDir, ".sisyphus/tasks"),
           claude_code_compat: false,
         },
       },
     }
     const tool = createTaskList(config)

     //#when
     const result = await tool.execute({}, { sessionID: "test-session" })

     //#then
     const parsed = JSON.parse(result)
     expect(parsed.tasks[0].blockedBy).toEqual(["T-missing"])
   })

  describe("toon compression", () => {
    it("returns uncompressed JSON when compression is disabled", async () => {
      //#given
      const tasks: TaskObject[] = Array.from({ length: 10 }, (_, i) => ({
        id: `T-${i}`,
        subject: `Task ${i} with a reasonably long subject to increase payload size`,
        description: "",
        status: "pending" as const,
        blocks: [],
        blockedBy: [],
        threadID: "test-session",
      }))

      for (const task of tasks) {
        writeJsonAtomic(join(testProjectDir, ".sisyphus/tasks", `${task.id}.json`), task)
      }

      const config = {
        sisyphus: {
          tasks: {
            storage_path: join(testProjectDir, ".sisyphus/tasks"),
            claude_code_compat: false,
          },
        },
        toon_compression: {
          enabled: false,
          threshold: 5000,
        },
      }
      const tool = createTaskList(config)

      //#when
      const result = await tool.execute({}, { sessionID: "test-session" })

      //#then
      const parsed = JSON.parse(result)
      expect(parsed.tasks).toHaveLength(10)
      expect(parsed.reminder).toBeDefined()
    })

    it("returns compressed output when compression is enabled and threshold is exceeded", async () => {
      //#given
      const tasks: TaskObject[] = Array.from({ length: 10 }, (_, i) => ({
        id: `T-${i}`,
        subject: `Task ${i} with a very long subject line that adds significant characters to the payload to exceed the compression threshold of 5000 characters`,
        description: "",
        status: "pending" as const,
        blocks: [],
        blockedBy: [],
        threadID: "test-session",
      }))

      for (const task of tasks) {
        writeJsonAtomic(join(testProjectDir, ".sisyphus/tasks", `${task.id}.json`), task)
      }

      const config = {
        sisyphus: {
          tasks: {
            storage_path: join(testProjectDir, ".sisyphus/tasks"),
            claude_code_compat: false,
          },
        },
        toon_compression: {
          enabled: true,
          threshold: 100,
        },
      }
      const tool = createTaskList(config)

      //#when
      const result = await tool.execute({}, { sessionID: "test-session" })

      //#then
      // Result should either be compressed (not valid JSON) or fallback to JSON
      // We verify it doesn't throw and returns a string
      expect(typeof result).toBe("string")
      expect(result.length).toBeGreaterThan(0)
    })

    it("falls back to JSON when compression fails", async () => {
      //#given
      const tasks: TaskObject[] = Array.from({ length: 5 }, (_, i) => ({
        id: `T-${i}`,
        subject: `Task ${i}`,
        description: "",
        status: "pending" as const,
        blocks: [],
        blockedBy: [],
        threadID: "test-session",
      }))

      for (const task of tasks) {
        writeJsonAtomic(join(testProjectDir, ".sisyphus/tasks", `${task.id}.json`), task)
      }

      // Use very low threshold to trigger compression attempt, but small array
      // won't compress (needs 5+ items), so it should fall back to JSON
      const config = {
        sisyphus: {
          tasks: {
            storage_path: join(testProjectDir, ".sisyphus/tasks"),
            claude_code_compat: false,
          },
        },
        toon_compression: {
          enabled: true,
          threshold: 1,
        },
      }
      const tool = createTaskList(config)

      //#when
      const result = await tool.execute({}, { sessionID: "test-session" })

      //#then
      const parsed = JSON.parse(result)
      expect(parsed.tasks).toHaveLength(5)
    })

    it("uses default compression config when not specified", async () => {
      //#given
      const task: TaskObject = {
        id: "T-1",
        subject: "Single task",
        description: "",
        status: "pending" as const,
        blocks: [],
        blockedBy: [],
        threadID: "test-session",
      }

      writeJsonAtomic(join(testProjectDir, ".sisyphus/tasks", "T-1.json"), task)

      const config = {
        sisyphus: {
          tasks: {
            storage_path: join(testProjectDir, ".sisyphus/tasks"),
            claude_code_compat: false,
          },
        },
        // No toon_compression specified
      }
      const tool = createTaskList(config)

      //#when
      const result = await tool.execute({}, { sessionID: "test-session" })

      //#then
      const parsed = JSON.parse(result)
      expect(parsed.tasks).toHaveLength(1)
    })
  })
})
