import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"

let lastDirectoryArg: string | undefined

mock.module("./storage", () => ({
  getMainSessions: async ({ directory }: { directory?: string }) => {
    lastDirectoryArg = directory
    return []
  },
  getAllSessions: async () => [],
  getSessionInfo: async () => null,
  readSessionMessages: async () => [],
  readSessionTodos: async () => [],
  sessionExists: () => false,
}))

const { session_list } = await import("./tools")

function createMockContext(directory: string): ToolContext {
  return {
    sessionID: "test-session",
    messageID: "test-message",
    agent: "test-agent",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

describe("session-manager tools directory resolution", () => {
  beforeEach(() => {
    lastDirectoryArg = undefined
  })

  test("session_list uses tool context directory by default", async () => {
    const context = createMockContext("/expected/context-directory")

    await session_list.execute({}, context)

    expect(lastDirectoryArg).toBe("/expected/context-directory")
  })

  test("session_list prefers explicit project_path over tool context directory", async () => {
    const context = createMockContext("/expected/context-directory")

    await session_list.execute({ project_path: "/explicit/project-path" }, context)

    expect(lastDirectoryArg).toBe("/explicit/project-path")
  })
})
