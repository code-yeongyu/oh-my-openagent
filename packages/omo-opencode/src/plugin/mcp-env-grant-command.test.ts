import { expect, mock, test } from "bun:test"
import { createCommandExecuteBeforeHandler } from "./command-execute-before"
import type { CreatedHooks } from "../create-hooks"
import { SkillMcpManager } from "../features/skill-mcp-manager"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"

test("grant command confirms only after the shared writer resolves", async () => {
  // given
  let finishWrite: (() => void) | undefined
  const write = new Promise<void>((resolve) => { finishWrite = resolve })
  const manager = new SkillMcpManager()
  const grant = mock(async () => { await write; return "Saved synthetic grant" })
  manager.grantEnvironment = grant
  const notifications: string[] = []
  const handler = createCommandExecuteBeforeHandler({
    directory: "/synthetic/project", hooks: unsafeTestValue<CreatedHooks>({}),
    mcpManager: manager, notify: (message) => notifications.push(message),
  })
  const output: { parts: { type: string; text?: string }[] } = { parts: [] }
  // when
  const done = handler({ command: "omo-mcp-env-grant", sessionID: "synthetic", arguments: "abc123 FIRST SECOND" }, output)
  // then
  expect(grant).toHaveBeenCalledWith("abc123", ["FIRST", "SECOND"])
  expect(output.parts).toEqual([])
  expect(notifications).toEqual([])
  finishWrite?.()
  await done
  expect(output.parts[0]?.text).toBe("Saved synthetic grant")
  expect(notifications).toEqual(["Saved synthetic grant"])
  await manager.disconnectAll()
})

test("grant command write rejection produces no success part or toast", async () => {
  // given
  const manager = new SkillMcpManager()
  manager.grantEnvironment = async () => { throw new Error("synthetic writer error") }
  const notifications: string[] = []
  const handler = createCommandExecuteBeforeHandler({
    directory: "/synthetic/project", hooks: unsafeTestValue<CreatedHooks>({}),
    mcpManager: manager, notify: (message) => notifications.push(message),
  })
  const output = { parts: [] }
  // when / then
  await expect(handler({
    command: "omo-mcp-env-grant", sessionID: "synthetic", arguments: "abc123 FIRST",
  }, output)).rejects.toThrow("synthetic writer error")
  expect(output.parts).toEqual([])
  expect(notifications).toEqual([])
  await manager.disconnectAll()
})
