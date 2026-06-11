import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ALWAYS_ON_UTILITY_TOOL_NAMES, registerAlwaysOnUtilityTools } from "./always-on-tools"
import type { TargetToolDefinition } from "./tool-registration"

let tempDirectory: string

beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "omo-host-tools-"))
})

afterEach(() => {
  rmSync(tempDirectory, { recursive: true, force: true })
})

function getText(result: { content: readonly Array<{ type: string; text?: string }> }): string {
  const first = result.content[0]
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error("expected text tool result")
  }
  return first.text
}

describe("registerAlwaysOnUtilityTools", () => {
  test("#given Pi target registry #when registering utility tools #then every Chunk 7 tool name is present", () => {
    // given
    const tools = new Map<string, TargetToolDefinition>()

    // when
    registerAlwaysOnUtilityTools({
      host: "pi",
      cwd: tempDirectory,
      registry: {
        registerTool: (tool) => {
          tools.set(tool.name, tool)
        },
      },
    })

    // then
    expect([...tools.keys()].sort()).toEqual([...ALWAYS_ON_UTILITY_TOOL_NAMES].sort())
  })

  test("#given registered read-only tool #when executing glob #then target wrapper returns matching file output", async () => {
    // given
    mkdirSync(join(tempDirectory, "src"), { recursive: true })
    writeFileSync(join(tempDirectory, "src", "target-file.txt"), "content", "utf-8")
    const tools = new Map<string, TargetToolDefinition>()
    registerAlwaysOnUtilityTools({
      host: "oh-my-pi",
      cwd: tempDirectory,
      registry: {
        registerTool: (tool) => {
          tools.set(tool.name, tool)
        },
      },
    })

    // when
    const result = await tools.get("glob")?.execute("call-1", { pattern: "**/*.txt" })

    // then
    expect(result?.isError).toBeUndefined()
    expect(result ? getText(result) : "").toContain("target-file.txt")
  })

  test("#given registered session tool #when executing session_list for empty project #then target wrapper returns no-session output", async () => {
    // given
    const tools = new Map<string, TargetToolDefinition>()
    registerAlwaysOnUtilityTools({
      host: "pi",
      cwd: tempDirectory,
      registry: {
        registerTool: (tool) => {
          tools.set(tool.name, tool)
        },
      },
    })

    // when
    const result = await tools.get("session_list")?.execute("call-1", { project_path: tempDirectory })

    // then
    expect(result?.isError).toBeUndefined()
    expect(result ? getText(result) : "").toBe("No sessions found.")
  })

  test("#given registered background task #when output is requested #then target manager reports completion", async () => {
    // given
    const tools = new Map<string, TargetToolDefinition>()
    const manager = new (await import("./background-manager")).TargetBackgroundManager()
    const task = manager.start(async () => "done")
    registerAlwaysOnUtilityTools({
      host: "oh-my-pi",
      cwd: tempDirectory,
      backgroundManager: manager,
      registry: {
        registerTool: (tool) => {
          tools.set(tool.name, tool)
        },
      },
    })

    // when
    await Bun.sleep(0)
    const result = await tools.get("background_output")?.execute("call-1", { task_id: task.id })

    // then
    expect(result?.isError).toBe(false)
    expect(result ? getText(result) : "").toContain("completed")
  })
})
