/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BackgroundManager } from "../../features/background-agent"
import { createAgentTeamsTools } from "./tools"
import { getTeamDir, getTeamInboxPath, getTeamTaskDir } from "./paths"

interface LaunchCall {
  description: string
  prompt: string
  agent: string
  parentSessionID: string
  parentMessageID: string
  parentAgent?: string
  model?: {
    providerID: string
    modelID: string
  }
}

interface ResumeCall {
  sessionId: string
  prompt: string
  parentSessionID: string
  parentMessageID: string
  parentAgent?: string
}

interface CancelCall {
  taskId: string
  options?: unknown
}

interface MockManagerHandles {
  manager: BackgroundManager
  launchCalls: LaunchCall[]
  resumeCalls: ResumeCall[]
  cancelCalls: CancelCall[]
}

interface TestToolContext {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
}

function createMockManager(): MockManagerHandles {
  const launchCalls: LaunchCall[] = []
  const resumeCalls: ResumeCall[] = []
  const cancelCalls: CancelCall[] = []
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
    cancelTask: async (taskId: string, options?: unknown) => {
      cancelCalls.push({ taskId, options })
      return true
    },
  } as unknown as BackgroundManager

  return { manager, launchCalls, resumeCalls, cancelCalls }
}

function createContext(): TestToolContext {
  return {
    sessionID: "ses-main",
    messageID: "msg-main",
    agent: "sisyphus",
    abort: new AbortController().signal,
  }
}

async function executeJsonTool(
  tools: ReturnType<typeof createAgentTeamsTools>,
  toolName: keyof ReturnType<typeof createAgentTeamsTools>,
  args: Record<string, unknown>,
  context: TestToolContext,
): Promise<unknown> {
  const output = await tools[toolName].execute(args, context)
  return JSON.parse(output)
}

describe("agent-teams tools functional", () => {
  let originalCwd: string
  let tempProjectDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tempProjectDir = mkdtempSync(join(tmpdir(), "agent-teams-tools-"))
    process.chdir(tempProjectDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tempProjectDir, { recursive: true, force: true })
  })

  test("team_create/read_config/delete work with project-local storage", async () => {
    //#given
    const { manager } = createMockManager()
    const tools = createAgentTeamsTools(manager)
    const context = createContext()

    //#when
    const created = await executeJsonTool(
      tools,
      "team_create",
      { team_name: "core", description: "Core team" },
      context,
    ) as { team_name: string; team_file_path: string; lead_agent_id: string }

    //#then
    expect(created.team_name).toBe("core")
    expect(created.lead_agent_id).toBe("team-lead@core")
    expect(created.team_file_path).toBe(join(tempProjectDir, ".sisyphus", "agent-teams", "teams", "core", "config.json"))
    expect(existsSync(created.team_file_path)).toBe(true)
    expect(existsSync(getTeamInboxPath("core", "team-lead"))).toBe(true)

    //#when
    const config = await executeJsonTool(tools, "read_config", { team_name: "core" }, context) as {
      name: string
      members: Array<{ name: string }>
    }

    //#then
    expect(config.name).toBe("core")
    expect(config.members.map((member) => member.name)).toEqual(["team-lead"])

    //#when
    const deleted = await executeJsonTool(tools, "team_delete", { team_name: "core" }, context) as {
      success: boolean
    }

    //#then
    expect(deleted.success).toBe(true)
    expect(existsSync(getTeamDir("core"))).toBe(false)
    expect(existsSync(getTeamTaskDir("core"))).toBe(false)
  })

  test("task tools create/update/get/list and emit assignment inbox message", async () => {
    //#given
    const { manager } = createMockManager()
    const tools = createAgentTeamsTools(manager)
    const context = createContext()

    await executeJsonTool(tools, "team_create", { team_name: "core" }, context)

    //#when
    const createdTask = await executeJsonTool(
      tools,
      "team_task_create",
      {
        team_name: "core",
        subject: "Draft release notes",
        description: "Prepare release notes for next publish.",
      },
      context,
    ) as { id: string; status: string }

    //#then
    expect(createdTask.id).toMatch(/^T-[a-f0-9-]+$/)
    expect(createdTask.status).toBe("pending")

    //#when
    const updatedTask = await executeJsonTool(
      tools,
      "team_task_update",
      {
        team_name: "core",
        task_id: createdTask.id,
        owner: "worker_1",
        status: "in_progress",
      },
      context,
    ) as { owner?: string; status: string }

    //#then
    expect(updatedTask.owner).toBe("worker_1")
    expect(updatedTask.status).toBe("in_progress")

    //#when
    const fetchedTask = await executeJsonTool(
      tools,
      "team_task_get",
      { team_name: "core", task_id: createdTask.id },
      context,
    ) as { id: string; owner?: string }
    const listedTasks = await executeJsonTool(tools, "team_task_list", { team_name: "core" }, context) as Array<{ id: string }>
    const inbox = await executeJsonTool(
      tools,
      "read_inbox",
      {
        team_name: "core",
        agent_name: "worker_1",
        unread_only: true,
        mark_as_read: false,
      },
      context,
    ) as Array<{ summary?: string; text: string }>

    //#then
    expect(fetchedTask.id).toBe(createdTask.id)
    expect(fetchedTask.owner).toBe("worker_1")
    expect(listedTasks.some((task) => task.id === createdTask.id)).toBe(true)
    expect(inbox.some((message) => message.summary === "task_assignment")).toBe(true)
    const assignment = inbox.find((message) => message.summary === "task_assignment")
    expect(assignment).toBeDefined()
    const payload = JSON.parse(assignment!.text) as { type: string; taskId: string }
    expect(payload.type).toBe("task_assignment")
    expect(payload.taskId).toBe(createdTask.id)
  })

  test("spawn_teammate + send_message + force_kill_teammate execute end-to-end", async () => {
    //#given
    const { manager, launchCalls, resumeCalls, cancelCalls } = createMockManager()
    const tools = createAgentTeamsTools(manager)
    const context = createContext()

    await executeJsonTool(tools, "team_create", { team_name: "core" }, context)

    //#when
    const spawned = await executeJsonTool(
      tools,
      "spawn_teammate",
      {
        team_name: "core",
        name: "worker_1",
        prompt: "Handle release prep",
      },
      context,
    ) as { name: string; session_id: string; task_id: string }

    //#then
    expect(spawned.name).toBe("worker_1")
    expect(spawned.session_id).toBe("ses-worker-1")
    expect(spawned.task_id).toBe("bg-1")
    expect(launchCalls).toHaveLength(1)
    expect(launchCalls[0]).toMatchObject({
      description: "[team:core] worker_1",
      agent: "sisyphus-junior",
      parentSessionID: "ses-main",
      parentMessageID: "msg-main",
      parentAgent: "sisyphus",
    })

    //#when
    const sent = await executeJsonTool(
      tools,
      "send_message",
      {
        team_name: "core",
        type: "message",
        recipient: "worker_1",
        summary: "sync",
        content: "Please update status.",
      },
      context,
    ) as { success: boolean }

    //#then
    expect(sent.success).toBe(true)
    expect(resumeCalls).toHaveLength(1)
    expect(resumeCalls[0].sessionId).toBe("ses-worker-1")

    //#given
    const createdTask = await executeJsonTool(
      tools,
      "team_task_create",
      {
        team_name: "core",
        subject: "Follow-up",
        description: "Collect teammate update",
      },
      context,
    ) as { id: string }
    await executeJsonTool(
      tools,
      "team_task_update",
      {
        team_name: "core",
        task_id: createdTask.id,
        owner: "worker_1",
        status: "in_progress",
      },
      context,
    )

    //#when
    const killed = await executeJsonTool(
      tools,
      "force_kill_teammate",
      {
        team_name: "core",
        agent_name: "worker_1",
      },
      context,
    ) as { success: boolean }

    //#then
    expect(killed.success).toBe(true)
    expect(cancelCalls).toHaveLength(1)
    expect(cancelCalls[0].taskId).toBe("bg-1")
    expect(cancelCalls[0].options).toEqual(
      expect.objectContaining({
        source: "team_force_kill",
        abortSession: true,
        skipNotification: true,
      }),
    )

    //#when
    const configAfterKill = await executeJsonTool(tools, "read_config", { team_name: "core" }, context) as {
      members: Array<{ name: string }>
    }
    const taskAfterKill = await executeJsonTool(
      tools,
      "team_task_get",
      {
        team_name: "core",
        task_id: createdTask.id,
      },
      context,
    ) as { owner?: string; status: string }

    //#then
    expect(configAfterKill.members.some((member) => member.name === "worker_1")).toBe(false)
    expect(taskAfterKill.owner).toBeUndefined()
    expect(taskAfterKill.status).toBe("pending")
  })
})
