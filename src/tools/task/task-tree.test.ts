import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { createTaskTree } from "./task-tree"
import { writeJsonAtomic } from "../../features/claude-tasks/storage"
import type { TaskObject } from "./types"
import { join } from "path"
import { existsSync, rmSync } from "fs"

const testProjectDir = "/tmp/task-tree-test"
const taskDir = join(testProjectDir, ".sisyphus/tasks")

describe("createTaskTree", () => {
  beforeEach(() => {
    if (existsSync(taskDir)) {
      rmSync(taskDir, { recursive: true })
    }
  })

  afterEach(() => {
    if (existsSync(taskDir)) {
      rmSync(taskDir, { recursive: true })
    }
  })

  it("returns empty message when no tasks exist", async () => {
    const config = {
      sisyphus: {
        tasks: {
          storage_path: taskDir,
          claude_code_compat: false,
        },
      },
    }
    const tool = createTaskTree(config)

    const result = await tool.execute({}, { sessionID: "test-session", messageID: "", agent: "", abort: new AbortController().signal })

    expect(result).toContain("No tasks found")
  })

  it("renders flat tasks with numbering", async () => {
    const task1: TaskObject = {
      id: "T-1",
      subject: "First task",
      description: "",
      status: "pending",
      blockedBy: [],
      blocks: [],
      threadID: "thread-1",
    }
    const task2: TaskObject = {
      id: "T-2",
      subject: "Second task",
      description: "",
      status: "completed",
      blockedBy: [],
      blocks: [],
      threadID: "thread-1",
    }

    writeJsonAtomic(join(taskDir, "T-1.json"), task1)
    writeJsonAtomic(join(taskDir, "T-2.json"), task2)

    const config = {
      sisyphus: {
        tasks: {
          storage_path: taskDir,
          claude_code_compat: false,
        },
      },
    }
    const tool = createTaskTree(config)

    const result = await tool.execute({}, { sessionID: "test-session", messageID: "", agent: "", abort: new AbortController().signal })

    expect(result).toContain("1. First task")
    expect(result).toContain("2. Second task")
    expect(result).toContain("[ ] 1. First task (pending)")
    expect(result).toContain("[x] 2. Second task (completed)")
  })

  it("renders nested hierarchy with dot numbering", async () => {
    const parent: TaskObject = {
      id: "T-parent",
      subject: "Parent Task",
      description: "",
      status: "pending",
      blockedBy: [],
      blocks: [],
      threadID: "thread-1",
    }
    const child1: TaskObject = {
      id: "T-child1",
      subject: "Child A",
      description: "",
      status: "completed",
      blockedBy: [],
      blocks: [],
      parentID: "T-parent",
      threadID: "thread-1",
    }
    const child2: TaskObject = {
      id: "T-child2",
      subject: "Child B",
      description: "",
      status: "in_progress",
      blockedBy: [],
      blocks: [],
      parentID: "T-parent",
      threadID: "thread-1",
    }
    const grandchild: TaskObject = {
      id: "T-grandchild",
      subject: "Grandchild",
      description: "",
      status: "pending",
      blockedBy: [],
      blocks: [],
      parentID: "T-child2",
      threadID: "thread-1",
    }

    writeJsonAtomic(join(taskDir, "T-parent.json"), parent)
    writeJsonAtomic(join(taskDir, "T-child1.json"), child1)
    writeJsonAtomic(join(taskDir, "T-child2.json"), child2)
    writeJsonAtomic(join(taskDir, "T-grandchild.json"), grandchild)

    const config = {
      sisyphus: {
        tasks: {
          storage_path: taskDir,
          claude_code_compat: false,
        },
      },
    }
    const tool = createTaskTree(config)

    const result = await tool.execute({}, { sessionID: "test-session", messageID: "", agent: "", abort: new AbortController().signal })

    expect(result).toContain("1. Parent Task (pending)")
    expect(result).toContain("1.1. Child A (completed)")
    expect(result).toContain("1.2. Child B (in_progress)")
    expect(result).toContain("1.2.1. Grandchild (pending)")
    expect(result).toMatch(/^  - \[x\] 1\.1\./m)
  })

  it("excludes deleted tasks", async () => {
    const task1: TaskObject = {
      id: "T-1",
      subject: "Active task",
      description: "",
      status: "pending",
      blockedBy: [],
      blocks: [],
      threadID: "thread-1",
    }
    const task2: TaskObject = {
      id: "T-2",
      subject: "Deleted task",
      description: "",
      status: "deleted",
      blockedBy: [],
      blocks: [],
      threadID: "thread-1",
    }

    writeJsonAtomic(join(taskDir, "T-1.json"), task1)
    writeJsonAtomic(join(taskDir, "T-2.json"), task2)

    const config = {
      sisyphus: {
        tasks: {
          storage_path: taskDir,
          claude_code_compat: false,
        },
      },
    }
    const tool = createTaskTree(config)

    const result = await tool.execute({}, { sessionID: "test-session", messageID: "", agent: "", abort: new AbortController().signal })

    expect(result).toContain("1. Active task")
    expect(result).not.toContain("Deleted task")
  })

  it("includes orphaned tasks in dedicated section", async () => {
    const rootTask: TaskObject = {
      id: "T-root",
      subject: "Root Task",
      description: "",
      status: "pending",
      blockedBy: [],
      blocks: [],
      threadID: "thread-1",
    }
    const orphan: TaskObject = {
      id: "T-orphan",
      subject: "Orphan Task",
      description: "",
      status: "pending",
      blockedBy: [],
      blocks: [],
      parentID: "T-nonexistent",
      threadID: "thread-1",
    }

    writeJsonAtomic(join(taskDir, "T-root.json"), rootTask)
    writeJsonAtomic(join(taskDir, "T-orphan.json"), orphan)

    const config = {
      sisyphus: {
        tasks: {
          storage_path: taskDir,
          claude_code_compat: false,
        },
      },
    }
    const tool = createTaskTree(config)

    const result = await tool.execute({}, { sessionID: "test-session", messageID: "", agent: "", abort: new AbortController().signal })

    expect(result).toContain("## Orphaned Tasks")
    expect(result).toContain("Orphan Task")
    expect(result).toContain("parent 'T-nonexistent' not found")
  })

  it("uses correct checkbox for status", async () => {
    const pending: TaskObject = {
      id: "T-pending",
      subject: "Pending Task",
      description: "",
      status: "pending",
      blockedBy: [],
      blocks: [],
      threadID: "thread-1",
    }
    const inProgress: TaskObject = {
      id: "T-in-progress",
      subject: "In Progress Task",
      description: "",
      status: "in_progress",
      blockedBy: [],
      blocks: [],
      threadID: "thread-1",
    }
    const completed: TaskObject = {
      id: "T-completed",
      subject: "Completed Task",
      description: "",
      status: "completed",
      blockedBy: [],
      blocks: [],
      threadID: "thread-1",
    }

    writeJsonAtomic(join(taskDir, "T-pending.json"), pending)
    writeJsonAtomic(join(taskDir, "T-in-progress.json"), inProgress)
    writeJsonAtomic(join(taskDir, "T-completed.json"), completed)

    const config = {
      sisyphus: {
        tasks: {
          storage_path: taskDir,
          claude_code_compat: false,
        },
      },
    }
    const tool = createTaskTree(config)

    const result = await tool.execute({}, { sessionID: "test-session", messageID: "", agent: "", abort: new AbortController().signal })

    expect(result).toContain("[x] 1. Completed Task (completed)")
    expect(result).toContain("[ ] 2. In Progress Task (in_progress)")
    expect(result).toContain("[ ] 3. Pending Task (pending)")
  })

  it("snapshot test: complex hierarchy with mixed statuses", async () => {
    const tasks: TaskObject[] = [
      {
        id: "T-task1",
        subject: "Setup infrastructure",
        description: "",
        status: "completed",
        blockedBy: [],
        blocks: [],
        threadID: "thread-1",
      },
      {
        id: "T-task2",
        subject: "Implement auth",
        description: "",
        status: "in_progress",
        blockedBy: [],
        blocks: [],
        threadID: "thread-1",
      },
      {
        id: "T-task2a",
        subject: "JWT implementation",
        description: "",
        status: "completed",
        blockedBy: [],
        blocks: [],
        parentID: "T-task2",
        threadID: "thread-1",
      },
      {
        id: "T-task2b",
        subject: "OAuth2 integration",
        description: "",
        status: "in_progress",
        blockedBy: [],
        blocks: [],
        parentID: "T-task2",
        threadID: "thread-1",
      },
      {
        id: "T-task2b1",
        subject: "Google provider",
        description: "",
        status: "pending",
        blockedBy: [],
        blocks: [],
        parentID: "T-task2b",
        threadID: "thread-1",
      },
      {
        id: "T-task2b2",
        subject: "GitHub provider",
        description: "",
        status: "completed",
        blockedBy: [],
        blocks: [],
        parentID: "T-task2b",
        threadID: "thread-1",
      },
      {
        id: "T-task3",
        subject: "Write tests",
        description: "",
        status: "pending",
        blockedBy: [],
        blocks: [],
        threadID: "thread-1",
      },
    ]

    for (const task of tasks) {
      writeJsonAtomic(join(taskDir, `${task.id}.json`), task)
    }

    const config = {
      sisyphus: {
        tasks: {
          storage_path: taskDir,
          claude_code_compat: false,
        },
      },
    }
    const tool = createTaskTree(config)

    const result = await tool.execute({}, { sessionID: "test-session", messageID: "", agent: "", abort: new AbortController().signal })

    expect(result).toMatchSnapshot()
  })
})
