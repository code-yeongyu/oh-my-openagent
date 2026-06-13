import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerTargetTaskTools, TARGET_TASK_TOOL_NAMES } from "./task-tools"
import type { TargetToolDefinition } from "./tool-registration"
import { TargetBackgroundManager } from "./background-manager"

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "omo-target-tasks-"))
})

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

function tools(runAgent?: Parameters<typeof registerTargetTaskTools>[0]["runAgent"]): Map<string, TargetToolDefinition> {
  const result = new Map<string, TargetToolDefinition>()
  registerTargetTaskTools({
    host: "pi",
    cwd,
    registry: { registerTool: (tool) => result.set(tool.name, tool) },
    runAgent,
  })
  return result
}

function text(result: { content: readonly Array<{ type: string; text?: string }> }): string {
  const item = result.content[0]
  if (!item || item.type !== "text" || typeof item.text !== "string") throw new Error("expected text result")
  return item.text
}

describe("registerTargetTaskTools", () => {
  test("#given background delegation #when task starts #then output is observable through target manager", async () => {
    const tools = new Map<string, TargetToolDefinition>()
    const backgroundManager = new TargetBackgroundManager()
    registerTargetTaskTools({
      host: "pi",
      cwd,
      backgroundManager,
      registry: { registerTool: (tool) => tools.set(tool.name, tool) },
      runAgent: async () => ({ text: "background done", stderr: "", exitCode: 0 }),
    })

    const result = await tools.get("task")?.execute("bg", {
      prompt: "work",
      subagent_type: "sisyphus",
      run_in_background: true,
    })
    const details = result?.details as { taskID?: string } | undefined
    await Bun.sleep(0)

    expect(details?.taskID).toStartWith("bg_")
    expect(backgroundManager.get(details?.taskID ?? "")).toMatchObject({ status: "completed", output: "background done" })
  })

  test("#given a stale completion notifier #when background work completes #then task output survives without an unhandled rejection", async () => {
    const manager = new TargetBackgroundManager()
    const task = manager.start(
      async () => "completed output",
      async () => {
        throw new Error("stale extension context")
      },
    )

    await Bun.sleep(0)

    expect(manager.get(task.id)).toMatchObject({
      status: "completed",
      output: "completed output",
      notificationError: "stale extension context",
    })
  })

  test("#given running background tasks #when manager shuts down #then every task is cancelled", async () => {
    const manager = new TargetBackgroundManager()
    const run = (signal: AbortSignal) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })
      })
    const first = manager.start(run)
    const second = manager.start(run)

    expect(manager.cancelAll()).toBe(2)
    await Bun.sleep(0)

    expect(manager.get(first.id)?.status).toBe("cancelled")
    expect(manager.get(second.id)?.status).toBe("cancelled")
  })

  test("#given target adapter #when registering task tools #then complete task surface is present", () => {
    expect([...tools().keys()].sort()).toEqual([...TARGET_TASK_TOOL_NAMES].sort())
  })

  test("#given target task storage #when creating getting updating and listing #then CRUD round trip succeeds", async () => {
    const registry = tools()
    const created = JSON.parse(text(await registry.get("task_create")!.execute("create", { subject: "Port target tasks" })))
    const id = created.task.id as string
    const fetched = JSON.parse(text(await registry.get("task_get")!.execute("get", { id })))
    const updated = JSON.parse(
      text(await registry.get("task_update")!.execute("update", { id, status: "in_progress", owner: "sisyphus" })),
    )
    const listed = JSON.parse(text(await registry.get("task_list")!.execute("list", {})))

    expect(fetched.task.subject).toBe("Port target tasks")
    expect(updated.task.status).toBe("in_progress")
    expect(listed.tasks).toHaveLength(1)
  })

  test("#given target subprocess runner #when delegating by named agent and category #then both routes execute", async () => {
    const routes: string[] = []
    const registry = tools(async (route) => {
      routes.push(`${route.agent.name}:${route.category ?? "agent"}`)
      return { text: route.agent.policy, exitCode: 0, stderr: "" }
    })
    const named = await registry.get("task")!.execute("delegate", {
      prompt: "inspect",
      subagent_type: "oracle",
    })
    const category = await registry.get("call_omo_agent")!.execute("delegate-category", {
      prompt: "fix",
      category: "quick",
    })

    expect(text(named)).toBe("read-only")
    expect(text(category)).toBe("full")
    expect(routes).toEqual(["oracle:agent", "sisyphus-junior:quick"])
  })
})
