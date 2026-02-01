import { describe, expect, test, mock } from "bun:test"
import { existsSync } from "node:fs"
import { createNotepadWriteGuardHook } from "./index"
import { HOOK_NAME, BLOCKED_MESSAGE } from "./constants"

// Mock node:fs existsSync
mock.module("node:fs", () => ({
  existsSync: (path: string) => {
    if (path.includes("exists.md")) return true
    if (path.includes("new.md")) return false
    return false
  }
}))

describe(HOOK_NAME, () => {
  function createMockPluginInput() {
    return {
      client: {},
      directory: "/tmp/test",
    } as any
  }

  test("should block Write on existing findings.md", async () => {
    const hook = createNotepadWriteGuardHook(createMockPluginInput())
    const input = { tool: "Write" }
    const output: any = { args: { filePath: "/path/to/exists.md/findings.md" } }

    await hook["tool.execute.before"](input, output)

    expect(output.blocked).toBe(true)
    expect(output.message).toBe(BLOCKED_MESSAGE)
  })

  test("should block Write on existing progress.md", async () => {
    const hook = createNotepadWriteGuardHook(createMockPluginInput())
    const input = { tool: "Write" }
    const output: any = { args: { filePath: "/path/to/exists.md/progress.md" } }

    await hook["tool.execute.before"](input, output)

    expect(output.blocked).toBe(true)
    expect(output.message).toBe(BLOCKED_MESSAGE)
  })

  test("should allow Write on non-existent findings.md (first-time creation)", async () => {
    const hook = createNotepadWriteGuardHook(createMockPluginInput())
    const input = { tool: "Write" }
    const output: any = { args: { filePath: "/path/to/new.md/findings.md" } }

    await hook["tool.execute.before"](input, output)

    expect(output.blocked).toBeUndefined()
    expect(output.message).toBeUndefined()
  })

  test("should not affect Write on other files", async () => {
    const hook = createNotepadWriteGuardHook(createMockPluginInput())
    const input = { tool: "Write" }
    const output: any = { args: { filePath: "/path/to/exists.md/other.md" } }

    await hook["tool.execute.before"](input, output)

    expect(output.blocked).toBeUndefined()
  })

  test("should not affect other tools", async () => {
    const hook = createNotepadWriteGuardHook(createMockPluginInput())
    const input = { tool: "Read" }
    const output: any = { args: { filePath: "/path/to/exists.md/findings.md" } }

    await hook["tool.execute.before"](input, output)

    expect(output.blocked).toBeUndefined()
  })

  test("should handle missing filePath gracefully", async () => {
    const hook = createNotepadWriteGuardHook(createMockPluginInput())
    const input = { tool: "Write" }
    const output: any = { args: {} }

    await hook["tool.execute.before"](input, output)

    expect(output.blocked).toBeUndefined()
  })
})
