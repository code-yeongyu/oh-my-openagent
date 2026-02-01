import { describe, expect, test, mock } from "bun:test"
import { createObservationWriteGuardHook } from "./index"
import { HOOK_NAME, BLOCKED_MESSAGE } from "./constants"

// Mock node:fs existsSync
mock.module("node:fs", () => ({
  existsSync: (path: string) => {
    if (path.includes("existing-observation")) return true
    if (path.includes("new-observation")) return false
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

  //#region Non-Write tools should not be intercepted
  test("should not intercept non-Write tools", async () => {
    //#given
    const hook = createObservationWriteGuardHook(createMockPluginInput())
    const input = { tool: "Read" }
    const output: any = { args: { filePath: "/project/continuous-learning/references/observations/existing-observation.md" } }

    //#when
    await hook["tool.execute.before"](input, output)

    //#then
    expect(output.blocked).toBeUndefined()
  })

  test("should not intercept Edit tool", async () => {
    //#given
    const hook = createObservationWriteGuardHook(createMockPluginInput())
    const input = { tool: "Edit" }
    const output: any = { args: { filePath: "/project/continuous-learning/references/observations/existing-observation.md" } }

    //#when
    await hook["tool.execute.before"](input, output)

    //#then
    expect(output.blocked).toBeUndefined()
  })
  //#endregion

  //#region Write to other paths should not be intercepted
  test("should not intercept Write to other paths", async () => {
    //#given
    const hook = createObservationWriteGuardHook(createMockPluginInput())
    const input = { tool: "Write" }
    const output: any = { args: { filePath: "/project/src/some-file.ts" } }

    //#when
    await hook["tool.execute.before"](input, output)

    //#then
    expect(output.blocked).toBeUndefined()
  })

  test("should not intercept Write to similar but different paths", async () => {
    //#given
    const hook = createObservationWriteGuardHook(createMockPluginInput())
    const input = { tool: "Write" }
    const output: any = { args: { filePath: "/project/observations/some-file.md" } }

    //#when
    await hook["tool.execute.before"](input, output)

    //#then
    expect(output.blocked).toBeUndefined()
  })
  //#endregion

  //#region Write to observations/ with non-existent file should be allowed
  test("should allow Write to observations/ when file does not exist (first-time creation)", async () => {
    //#given
    const hook = createObservationWriteGuardHook(createMockPluginInput())
    const input = { tool: "Write" }
    const output: any = { args: { filePath: "/project/continuous-learning/references/observations/new-observation.md" } }

    //#when
    await hook["tool.execute.before"](input, output)

    //#then
    expect(output.blocked).toBeUndefined()
    expect(output.message).toBeUndefined()
  })
  //#endregion

  //#region Write to observations/ with existing file should be blocked
  test("should block Write to observations/ when file already exists", async () => {
    //#given
    const hook = createObservationWriteGuardHook(createMockPluginInput())
    const input = { tool: "Write" }
    const output: any = { args: { filePath: "/project/continuous-learning/references/observations/existing-observation.md" } }

    //#when
    await hook["tool.execute.before"](input, output)

    //#then
    expect(output.blocked).toBe(true)
    expect(output.message).toBe(BLOCKED_MESSAGE)
  })

  test("should block Write with lowercase tool name", async () => {
    //#given
    const hook = createObservationWriteGuardHook(createMockPluginInput())
    const input = { tool: "write" }
    const output: any = { args: { filePath: "/project/continuous-learning/references/observations/existing-observation.md" } }

    //#when
    await hook["tool.execute.before"](input, output)

    //#then
    expect(output.blocked).toBe(true)
    expect(output.message).toBe(BLOCKED_MESSAGE)
  })
  //#endregion

  //#region Edge cases
  test("should handle missing filePath gracefully", async () => {
    //#given
    const hook = createObservationWriteGuardHook(createMockPluginInput())
    const input = { tool: "Write" }
    const output: any = { args: {} }

    //#when
    await hook["tool.execute.before"](input, output)

    //#then
    expect(output.blocked).toBeUndefined()
  })

  test("should handle missing args gracefully", async () => {
    //#given
    const hook = createObservationWriteGuardHook(createMockPluginInput())
    const input = { tool: "Write" }
    const output: any = {}

    //#when
    await hook["tool.execute.before"](input, output)

    //#then
    expect(output.blocked).toBeUndefined()
  })
  //#endregion
})
