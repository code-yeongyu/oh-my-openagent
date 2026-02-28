import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import type { BackgroundTask } from "./types"
import type { BackgroundOutputClient } from "../../tools/background-task/clients"
import { writeTaskOutput } from "./task-output-writer"

const TEST_OUTPUT_DIR = ".sisyphus/task-outputs"

function createMockClient(
  messages: Array<{ role: string; time: string; parts: Array<{ type: string; text: string }> }>,
): BackgroundOutputClient {
  return {
    session: {
      messages: async () =>
        messages.map((m, i) => ({
          id: `msg_${i}`,
          info: { role: m.role, time: m.time },
          parts: m.parts,
        })),
    },
  }
}

function createErrorClient(errorMessage: string): BackgroundOutputClient {
  return {
    session: {
      messages: async () => ({ data: undefined, error: errorMessage }),
    },
  }
}

function createMockTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "bg_test_123",
    parentSessionID: "parent-session-456",
    parentMessageID: "parent-msg-789",
    description: "Test background task",
    prompt: "test prompt",
    agent: "oracle",
    status: "completed",
    sessionID: "session-abc",
    completedAt: new Date("2026-02-27T10:30:00Z"),
    ...overrides,
  } as BackgroundTask
}

describe("writeTaskOutput", () => {
  beforeEach(async () => {
    if (existsSync(TEST_OUTPUT_DIR)) {
      await rm(TEST_OUTPUT_DIR, { recursive: true })
    }
  })

  afterEach(async () => {
    if (existsSync(TEST_OUTPUT_DIR)) {
      await rm(TEST_OUTPUT_DIR, { recursive: true })
    }
  })

  describe("#given a completed task with session messages", () => {
    it("#then writes file with correct YAML frontmatter and transcript", async () => {
      const client = createMockClient([
        {
          role: "user",
          time: "2026-02-27T10:00:00Z",
          parts: [{ type: "text", text: "Analyze the codebase" }],
        },
        {
          role: "assistant",
          time: "2026-02-27T10:01:00Z",
          parts: [{ type: "text", text: "I'll analyze the codebase now." }],
        },
      ])
      const task = createMockTask()

      const result = await writeTaskOutput(task, client, ".")

      expect(result).toBe(`${TEST_OUTPUT_DIR}/bg_test_123.md`)
      expect(existsSync(result!)).toBe(true)

      const content = await readFile(result!, "utf-8")
      expect(content).toContain("---")
      expect(content).toContain("task_id: bg_test_123")
      expect(content).toContain("agent: oracle")
      expect(content).toContain("session_id: session-abc")
      expect(content).toContain("parent_session_id: parent-session-456")
      expect(content).toContain("status: completed")
      expect(content).toContain("completed_at: 2026-02-27T10:30:00.000Z")
      expect(content).toContain("[user] 2026-02-27T10:00:00.000Z")
      expect(content).toContain("Analyze the codebase")
      expect(content).toContain("[assistant] 2026-02-27T10:01:00.000Z")
      expect(content).toContain("I'll analyze the codebase now.")
    })
  })

  describe("#given a task with no sessionID", () => {
    it("#then returns null without writing any file", async () => {
      const client = createMockClient([])
      const task = createMockTask({ sessionID: undefined })

      const result = await writeTaskOutput(task, client, ".")

      expect(result).toBeNull()
      expect(existsSync(`${TEST_OUTPUT_DIR}/bg_test_123.md`)).toBe(false)
    })
  })

  describe("#given session messages return an error", () => {
    it("#then returns null without writing any file", async () => {
      const client = createErrorClient("Session not found")
      const task = createMockTask()

      const result = await writeTaskOutput(task, client, ".")

      expect(result).toBeNull()
      expect(existsSync(`${TEST_OUTPUT_DIR}/bg_test_123.md`)).toBe(false)
    })
  })

  describe("#given empty session messages", () => {
    it("#then writes file with frontmatter and empty transcript", async () => {
      const client = createMockClient([])
      const task = createMockTask()

      const result = await writeTaskOutput(task, client, ".")

      expect(result).toBe(`${TEST_OUTPUT_DIR}/bg_test_123.md`)
      expect(existsSync(result!)).toBe(true)

      const content = await readFile(result!, "utf-8")
      expect(content).toContain("task_id: bg_test_123")
      expect(content).toContain("agent: oracle")
      const afterFrontmatter = content.split("---")[2]
      expect(afterFrontmatter.trim()).toBe("")
    })
  })

  describe("#given the output directory does not exist", () => {
    it("#then creates the directory and writes the file", async () => {
      expect(existsSync(TEST_OUTPUT_DIR)).toBe(false)

      const client = createMockClient([
        {
          role: "assistant",
          time: "2026-02-27T10:00:00Z",
          parts: [{ type: "text", text: "Done." }],
        },
      ])
      const task = createMockTask()

      const result = await writeTaskOutput(task, client, ".")

      expect(result).toBe(`${TEST_OUTPUT_DIR}/bg_test_123.md`)
      expect(existsSync(TEST_OUTPUT_DIR)).toBe(true)
      expect(existsSync(result!)).toBe(true)
    })
  })

  describe("#given messages with reasoning parts", () => {
    it("#then includes reasoning text in the transcript", async () => {
      const client = createMockClient([
        {
          role: "assistant",
          time: "2026-02-27T10:00:00Z",
          parts: [
            { type: "reasoning", text: "Let me think about this..." },
            { type: "text", text: "Here is my answer." },
          ],
        },
      ])
      const task = createMockTask()

      const result = await writeTaskOutput(task, client, ".")

      const content = await readFile(result!, "utf-8")
      expect(content).toContain("Let me think about this...")
      expect(content).toContain("Here is my answer.")
    })
  })

  describe("#given messages are not in chronological order", () => {
    it("#then sorts messages by time in the transcript", async () => {
      const client = createMockClient([
        {
          role: "assistant",
          time: "2026-02-27T10:02:00Z",
          parts: [{ type: "text", text: "Second message" }],
        },
        {
          role: "user",
          time: "2026-02-27T10:00:00Z",
          parts: [{ type: "text", text: "First message" }],
        },
      ])
      const task = createMockTask()

      const result = await writeTaskOutput(task, client, ".")

      const content = await readFile(result!, "utf-8")
      const firstIdx = content.indexOf("First message")
      const secondIdx = content.indexOf("Second message")
      expect(firstIdx).toBeLessThan(secondIdx)
    })
  })

  describe("#given a task with no completedAt", () => {
    it("#then writes 'unknown' for completed_at in frontmatter", async () => {
      const client = createMockClient([])
      const task = createMockTask({ completedAt: undefined })

      const result = await writeTaskOutput(task, client, ".")

      const content = await readFile(result!, "utf-8")
      expect(content).toContain("completed_at: unknown")
    })
  })
})
