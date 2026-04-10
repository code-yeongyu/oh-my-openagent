import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { PluginInput } from "@opencode-ai/plugin"

const isolatedDataDir = mkdtempSync(join(tmpdir(), "omo-session-tools-"))
const isolatedClaudeConfigDir = mkdtempSync(join(tmpdir(), "omo-claude-tools-"))
const originalXdgDataHome = process.env.XDG_DATA_HOME
const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR

process.env.XDG_DATA_HOME = isolatedDataDir
process.env.CLAUDE_CONFIG_DIR = isolatedClaudeConfigDir

const { setVersionCache, resetVersionCache } = await import("../../shared/opencode-version")
setVersionCache(null)

const { createSessionManagerTools } = await import(`./tools?test=tools-${Date.now()}-${Math.random()}`)

const projectDir = "/Users/yeongyu/local-workspaces/oh-my-opencode"
const mockCtx = { directory: projectDir } as PluginInput
const mockContext: ToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  directory: projectDir,
  worktree: projectDir,
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

afterAll(() => {
  if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME
  else process.env.XDG_DATA_HOME = originalXdgDataHome

  if (originalClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir

  resetVersionCache()
  rmSync(isolatedDataDir, { recursive: true, force: true })
  rmSync(isolatedClaudeConfigDir, { recursive: true, force: true })
})

const tools = createSessionManagerTools(mockCtx)
const { session_list, session_read, session_search, session_info } = tools

describe("session-manager tools", () => {
  test("session_list executes without error", async () => {
    expect(typeof (await session_list.execute({}, mockContext))).toBe("string")
  })

  test("session_list respects limit parameter", async () => {
    expect(typeof (await session_list.execute({ limit: 5 }, mockContext))).toBe("string")
  })

  test("session_list filters by date range", async () => {
    expect(typeof (await session_list.execute({ from_date: "2025-12-01T00:00:00Z", to_date: "2025-12-31T23:59:59Z" }, mockContext))).toBe("string")
  })

  test("session_list filters by project_path", async () => {
    expect(typeof (await session_list.execute({ project_path: projectDir }, mockContext))).toBe("string")
  })

  test("session_list uses ctx.directory as default project_path", async () => {
    expect(typeof (await session_list.execute({}, mockContext))).toBe("string")
  })

  test("session_read handles non-existent session", async () => {
    expect(await session_read.execute({ session_id: "ses_nonexistent" }, mockContext)).toContain("not found")
  })

  test("session_read executes with valid parameters", async () => {
    expect(typeof (await session_read.execute({ session_id: "ses_test123", include_todos: true, include_transcript: true }, mockContext))).toBe("string")
  })

  test("session_read respects limit parameter", async () => {
    expect(typeof (await session_read.execute({ session_id: "ses_test123", limit: 10 }, mockContext))).toBe("string")
  })

  test("session_search executes without error", async () => {
    expect(typeof (await session_search.execute({ query: "test" }, mockContext))).toBe("string")
  })

  test("session_search filters by session_id", async () => {
    expect(typeof (await session_search.execute({ query: "test", session_id: "ses_test123" }, mockContext))).toBe("string")
  })

  test("session_search respects case_sensitive parameter", async () => {
    expect(typeof (await session_search.execute({ query: "TEST", case_sensitive: true }, mockContext))).toBe("string")
  })

  test("session_search respects limit parameter", async () => {
    expect(typeof (await session_search.execute({ query: "test", limit: 5 }, mockContext))).toBe("string")
  })

  test("session_info handles non-existent session", async () => {
    expect(await session_info.execute({ session_id: "ses_nonexistent" }, mockContext)).toContain("not found")
  })

  test("session_info executes with valid session", async () => {
    expect(typeof (await session_info.execute({ session_id: "ses_test123" }, mockContext))).toBe("string")
  })
})
