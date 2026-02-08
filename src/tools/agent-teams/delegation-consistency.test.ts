/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BackgroundManager } from "../../features/background-agent"
import { createAgentTeamsTools } from "./tools"

interface LaunchCall {
  description: string
  prompt: string
  agent: string
  parentSessionID: string
  parentMessageID: string
  parentAgent?: string
  parentModel?: {
    providerID: string
    modelID: string
    variant?: string
  }
}

interface ResumeCall {
  sessionId: string
  prompt: string
  parentSessionID: string
  parentMessageID: string
  parentAgent?: string
  parentModel?: {
    providerID: string
    modelID: string
    variant?: string
  }
}

interface ToolContextLike {
  sessionID: string
  messageID: string
  abort: AbortSignal
  agent?: string
}

function createMockManager(): {
  manager: BackgroundManager
  launchCalls: LaunchCall[]
  resumeCalls: ResumeCall[]
} {
  const launchCalls: LaunchCall[] = []
  const resumeCalls: ResumeCall[] = []
  const launchedTasks = new Map<string, { id: string; sessionID: string }>()
  let launchCount = 0

  const manager = {
    launch: async (args: LaunchCall) => {
      launchCount += 1
      launchCalls.push(args)
      const task = { id: `bg-${launchCount}`, sessionID: `ses-worker-${launchCount}` }
      launchedTasks.set(task.id, task)
      return task
    },
    getTask: (taskId: string) => launchedTasks.get(taskId),
    resume: async (args: ResumeCall) => {
      resumeCalls.push(args)
      return { id: `resume-${resumeCalls.length}` }
    },
  } as unknown as BackgroundManager

  return { manager, launchCalls, resumeCalls }
}

async function executeJsonTool(
  tools: ReturnType<typeof createAgentTeamsTools>,
  toolName: keyof ReturnType<typeof createAgentTeamsTools>,
  args: Record<string, unknown>,
  context: ToolContextLike,
): Promise<unknown> {
  const output = await tools[toolName].execute(args, context as any)
  return JSON.parse(output)
}

describe("agent-teams delegation consistency", () => {
  let originalCwd: string
  let tempProjectDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tempProjectDir = mkdtempSync(join(tmpdir(), "agent-teams-consistency-"))
    process.chdir(tempProjectDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tempProjectDir, { recursive: true, force: true })
  })

  test("team delegation forwards parent context like normal delegate-task", async () => {
    //#given
    const { manager, launchCalls, resumeCalls } = createMockManager()
    const tools = createAgentTeamsTools(manager)
    const leadContext: ToolContextLike = {
      sessionID: "ses-main",
      messageID: "msg-main",
      abort: new AbortController().signal,
    }

    await executeJsonTool(tools, "team_create", { team_name: "core" }, leadContext)

    //#when
    const spawnResult = await executeJsonTool(
      tools,
      "spawn_teammate",
      {
        team_name: "core",
        name: "worker_1",
        prompt: "Handle release prep",
        category: "quick",
      },
      leadContext,
    ) as { error?: string }

    //#then
    expect(spawnResult.error).toBeUndefined()
    expect(launchCalls).toHaveLength(1)
    expect(launchCalls[0].parentAgent).toBe("sisyphus")
    expect("parentModel" in launchCalls[0]).toBe(true)

    //#when
    const messageResult = await executeJsonTool(
      tools,
      "send_message",
      {
        team_name: "core",
        type: "message",
        recipient: "worker_1",
        summary: "sync",
        content: "Please update status.",
      },
      leadContext,
    ) as { error?: string }

    //#then
    expect(messageResult.error).toBeUndefined()
    expect(resumeCalls).toHaveLength(1)
    expect(resumeCalls[0].parentAgent).toBe("sisyphus")
    expect("parentModel" in resumeCalls[0]).toBe(true)
  })

  test("send_message accepts teammate agent_id as recipient", async () => {
    //#given
    const { manager, resumeCalls } = createMockManager()
    const tools = createAgentTeamsTools(manager)
    const leadContext: ToolContextLike = {
      sessionID: "ses-main",
      messageID: "msg-main",
      abort: new AbortController().signal,
    }

    await executeJsonTool(tools, "team_create", { team_name: "core" }, leadContext)
    await executeJsonTool(
      tools,
      "spawn_teammate",
      {
        team_name: "core",
        name: "worker_1",
        prompt: "Handle release prep",
        category: "quick",
      },
      leadContext,
    )

    //#when
    const messageResult = await executeJsonTool(
      tools,
      "send_message",
      {
        team_name: "core",
        type: "message",
        recipient: "worker_1@core",
        summary: "sync",
        content: "Please update status.",
      },
      leadContext,
    ) as { error?: string }

    //#then
    expect(messageResult.error).toBeUndefined()
    expect(resumeCalls).toHaveLength(1)
  })
})
