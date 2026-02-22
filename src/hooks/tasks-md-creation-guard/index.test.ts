/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { _resetForTesting, setMainSession, subagentSessions } from "../../features/claude-code-session-state"
import { createTasksMdCreationGuardHook } from "./index"

interface HookOutput {
  args: { filePath: string; content: string }
  blocked?: boolean
  message?: string
}

interface ToolBeforeInput {
  tool: string
  sessionID?: string
  callID?: string
}

interface ToolAfterInput {
  tool: string
  sessionID?: string
}

interface ToolAfterOutput {
  metadata?: Record<string, unknown>
}

describe("createTasksMdCreationGuardHook", () => {
  let tempDir: string
  let hook: ReturnType<typeof createTasksMdCreationGuardHook>

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tasks-md-guard-test-"))
    hook = createTasksMdCreationGuardHook({ directory: tempDir } as PluginInput)
    _resetForTesting()
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    _resetForTesting()
  })

  test("blocks creation when creating-changes not used", async () => {
    //#given
    const input: ToolBeforeInput = { tool: "Write", sessionID: "main", callID: "call_1" }
    const output: HookOutput = { args: { filePath: "changes/plan-a/tasks.md", content: "- [ ] Task" } }

    //#when
    const result = hook["tool.execute.before"]?.(input, output)

    //#then
    await expect(result).resolves.toBeUndefined()
    expect(output.blocked).toBe(true)
    expect(output.message).toContain("creating-changes")
  })

  test("allows subagent after main session used creating-changes", async () => {
    //#given
    setMainSession("main")
    subagentSessions.add("atlas")
    const skillInput: ToolAfterInput = { tool: "skill", sessionID: "main" }
    const skillOutput: ToolAfterOutput = { metadata: { name: "creating-changes" } }
    await hook["tool.execute.after"]?.(skillInput, skillOutput)

    const input: ToolBeforeInput = { tool: "Write", sessionID: "atlas", callID: "call_1" }
    const output: HookOutput = { args: { filePath: "changes/plan-a/tasks.md", content: "- [ ] Task" } }

    //#when
    const result = hook["tool.execute.before"]?.(input, output)

    //#then
    await expect(result).resolves.toBeUndefined()
    expect(output.blocked).toBeUndefined()
  })

  test("allows main after subagent used creating-changes", async () => {
    //#given
    setMainSession("main")
    subagentSessions.add("atlas")
    const skillInput: ToolAfterInput = { tool: "skill", sessionID: "atlas" }
    const skillOutput: ToolAfterOutput = { metadata: { skillName: "creating-changes" } }
    await hook["tool.execute.after"]?.(skillInput, skillOutput)

    const input: ToolBeforeInput = { tool: "Write", sessionID: "main", callID: "call_1" }
    const output: HookOutput = { args: { filePath: "changes/plan-a/tasks.md", content: "- [ ] Task" } }

    //#when
    const result = hook["tool.execute.before"]?.(input, output)

    //#then
    await expect(result).resolves.toBeUndefined()
    expect(output.blocked).toBeUndefined()
  })
})
