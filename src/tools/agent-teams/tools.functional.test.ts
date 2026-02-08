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

function createFailingLaunchManager(): { manager: BackgroundManager; cancelCalls: CancelCall[] } {
  const cancelCalls: CancelCall[] = []

  const manager = {
    launch: async () => ({ id: "bg-fail" }),
    getTask: () => ({
      id: "bg-fail",
      parentSessionID: "ses-main",
      parentMessageID: "msg-main",
      description: "failed launch",
      prompt: "prompt",
      agent: "sisyphus-junior",
      status: "error",
      error: "launch failed",
    }),
    resume: async () => ({ id: "resume-unused" }),
    cancelTask: async (taskId: string, options?: unknown) => {
      cancelCalls.push({ taskId, options })
      return true
    },
  } as unknown as BackgroundManager

  return { manager, cancelCalls }
}

function createContext(sessionID = "ses-main"): TestToolContext {
  return {
    sessionID,
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
    await executeJsonTool(
      tools,
      "spawn_teammate",
      {
        team_name: "core",
        name: "worker_1",
        prompt: "Handle release prep",
      },
      context,
    )

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

    //#when
    const clearedOwnerTask = await executeJsonTool(
      tools,
      "team_task_update",
      {
        team_name: "core",
        task_id: createdTask.id,
        owner: "",
      },
      context,
    ) as { owner?: string }

    //#then
    expect(clearedOwnerTask.owner).toBeUndefined()
  })

  test("rejects invalid task id input for task_get", async () => {
    //#given
    const { manager } = createMockManager()
    const tools = createAgentTeamsTools(manager)
    const context = createContext()

    await executeJsonTool(tools, "team_create", { team_name: "core" }, context)

    //#when
    const result = await executeJsonTool(
      tools,
      "team_task_get",
      { team_name: "core", task_id: "../../etc/passwd" },
      context,
    ) as { error?: string }

    //#then
    expect(result.error).toBe("task_id_invalid")
  })

  test("requires owner to be a team member when setting task owner", async () => {
    //#given
    const { manager } = createMockManager()
    const tools = createAgentTeamsTools(manager)
    const context = createContext()

    await executeJsonTool(tools, "team_create", { team_name: "core" }, context)
    const createdTask = await executeJsonTool(
      tools,
      "team_task_create",
      {
        team_name: "core",
        subject: "Investigate bug",
        description: "Investigate and report root cause",
      },
      context,
    ) as { id: string }

    //#when
    const result = await executeJsonTool(
      tools,
      "team_task_update",
      {
        team_name: "core",
        task_id: createdTask.id,
        owner: "ghost_user",
      },
      context,
    ) as { error?: string }

    //#then
    expect(result.error).toBe("owner_not_in_team")
  })

  test("allows assigning team-lead as task owner", async () => {
    //#given
    const { manager } = createMockManager()
    const tools = createAgentTeamsTools(manager)
    const context = createContext()

    await executeJsonTool(tools, "team_create", { team_name: "core" }, context)
    const createdTask = await executeJsonTool(
      tools,
      "team_task_create",
      {
        team_name: "core",
        subject: "Prepare checklist",
        description: "Prepare release checklist",
      },
      context,
    ) as { id: string }

    //#when
    const updated = await executeJsonTool(
      tools,
      "team_task_update",
      {
        team_name: "core",
        task_id: createdTask.id,
        owner: "team-lead",
      },
      context,
    ) as { owner?: string }

    const leadInbox = await executeJsonTool(
      tools,
      "read_inbox",
      {
        team_name: "core",
        agent_name: "team-lead",
        unread_only: true,
        mark_as_read: false,
      },
      context,
    ) as Array<{ summary?: string; text: string }>

    //#then
    expect(updated.owner).toBe("team-lead")
    expect(leadInbox.some((message) => message.summary === "task_assignment")).toBe(true)
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

    //#when
    const invalidSender = await executeJsonTool(
      tools,
      "send_message",
      {
        team_name: "core",
        type: "message",
        sender: "ghost_user",
        recipient: "worker_1",
        summary: "sync",
        content: "Please update status.",
      },
      context,
    ) as { error?: string }

    //#then
    expect(invalidSender.error).toBe("sender_context_mismatch")

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

  test("process_shutdown_approved cancels and removes teammate", async () => {
    //#given
    const { manager, cancelCalls } = createMockManager()
    const tools = createAgentTeamsTools(manager)
    const leadContext = createContext()

    await executeJsonTool(tools, "team_create", { team_name: "core" }, leadContext)
    await executeJsonTool(
      tools,
      "spawn_teammate",
      {
        team_name: "core",
        name: "worker_1",
        prompt: "Handle release prep",
      },
      leadContext,
    )

    //#when
    const shutdownResult = await executeJsonTool(
      tools,
      "process_shutdown_approved",
      {
        team_name: "core",
        agent_name: "worker_1",
      },
      leadContext,
    ) as { success: boolean }

    //#then
    expect(shutdownResult.success).toBe(true)
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
    const configAfterShutdown = await executeJsonTool(tools, "read_config", { team_name: "core" }, leadContext) as {
      members: Array<{ name: string }>
    }

    //#then
    expect(configAfterShutdown.members.some((member) => member.name === "worker_1")).toBe(false)
  })

  test("rolls back teammate and cancels background task when launch fails", async () => {
    //#given
    const { manager, cancelCalls } = createFailingLaunchManager()
    const tools = createAgentTeamsTools(manager)
    const context = createContext()
    await executeJsonTool(tools, "team_create", { team_name: "core" }, context)

    //#when
    const spawnResult = await executeJsonTool(
      tools,
      "spawn_teammate",
      {
        team_name: "core",
        name: "worker_1",
        prompt: "Handle release prep",
      },
      context,
    ) as { error?: string }

    //#then
    expect(spawnResult.error).toBe("teammate_launch_failed:launch failed")

    //#when
    const config = await executeJsonTool(tools, "read_config", { team_name: "core" }, context) as {
      members: Array<{ name: string }>
    }

    //#then
    expect(config.members.map((member) => member.name)).toEqual(["team-lead"])
    expect(cancelCalls).toHaveLength(1)
    expect(cancelCalls[0].taskId).toBe("bg-fail")
    expect(cancelCalls[0].options).toEqual(
      expect.objectContaining({
        source: "team_launch_failed",
        abortSession: true,
        skipNotification: true,
      }),
    )
    expect(existsSync(getTeamInboxPath("core", "worker_1"))).toBe(false)
  })

  test("returns explicit error on invalid model override format", async () => {
    //#given
    const { manager, launchCalls } = createMockManager()
    const tools = createAgentTeamsTools(manager)
    const context = createContext()
    await executeJsonTool(tools, "team_create", { team_name: "core" }, context)

    //#when
    const spawnResult = await executeJsonTool(
      tools,
      "spawn_teammate",
      {
        team_name: "core",
        name: "worker_1",
        prompt: "Handle release prep",
        model: "invalid-format",
      },
      context,
    ) as { error?: string }

    //#then
    expect(spawnResult.error).toBe("invalid_model_override_format")
    expect(launchCalls).toHaveLength(0)

    //#when
    const config = await executeJsonTool(tools, "read_config", { team_name: "core" }, context) as {
      members: Array<{ name: string }>
    }

    //#then
    expect(config.members.map((member) => member.name)).toEqual(["team-lead"])
  })

  test("keeps full model id suffix when override contains extra slashes", async () => {
    //#given
    const { manager, launchCalls } = createMockManager()
    const tools = createAgentTeamsTools(manager)
    const context = createContext()
    await executeJsonTool(tools, "team_create", { team_name: "core" }, context)

    //#when
    const spawnResult = await executeJsonTool(
      tools,
      "spawn_teammate",
      {
        team_name: "core",
        name: "worker_1",
        prompt: "Handle release prep",
        model: "openai/gpt-5.3-codex/reasoning",
      },
      context,
    ) as { name?: string; error?: string }

    //#then
    expect(spawnResult.error).toBeUndefined()
    expect(spawnResult.name).toBe("worker_1")
    expect(launchCalls).toHaveLength(1)
    expect(launchCalls[0].model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.3-codex/reasoning",
    })
  })

  test("read_inbox returns team_not_found for unknown team", async () => {
    //#given
    const { manager } = createMockManager()
    const tools = createAgentTeamsTools(manager)
    const context = createContext()

    //#when
    const result = await executeJsonTool(
      tools,
      "read_inbox",
      {
        team_name: "missing_team",
        agent_name: "team-lead",
      },
      context,
    ) as { error?: string }

    //#then
    expect(result.error).toBe("team_not_found")
  })

  test("read_inbox denies cross-member access for non-lead sessions", async () => {
    //#given
    const { manager } = createMockManager()
    const tools = createAgentTeamsTools(manager)
    const leadContext = createContext()

    await executeJsonTool(tools, "team_create", { team_name: "core" }, leadContext)
    await executeJsonTool(
      tools,
      "spawn_teammate",
      {
        team_name: "core",
        name: "worker_1",
        prompt: "Handle release prep",
      },
      leadContext,
    )

    const teammateContext = createContext("ses-worker-1")

    //#when
    const unauthorized = await executeJsonTool(
      tools,
      "read_inbox",
      {
        team_name: "core",
        agent_name: "team-lead",
      },
      teammateContext,
    ) as { error?: string }

    //#then
    expect(unauthorized.error).toBe("unauthorized_reader_session")

    //#when
    const ownInbox = await executeJsonTool(
      tools,
      "read_inbox",
      {
        team_name: "core",
        agent_name: "worker_1",
      },
      teammateContext,
    ) as unknown[]

    //#then
    expect(Array.isArray(ownInbox)).toBe(true)
  })

  test("allows lead session to rotate after restart using team-lead identity", async () => {
    //#given
    const { manager } = createMockManager()
    const tools = createAgentTeamsTools(manager)
    const originalLead = createContext("ses-main")
    await executeJsonTool(tools, "team_create", { team_name: "core" }, originalLead)

    const restartedLead = createContext("ses-restarted")

    //#when
    const sendResult = await executeJsonTool(
      tools,
      "send_message",
      {
        team_name: "core",
        type: "message",
        sender: "team-lead",
        recipient: "team-lead",
        summary: "restart",
        content: "Lead session migrated",
      },
      restartedLead,
    ) as { success?: boolean; error?: string }

    //#then
    expect(sendResult.error).toBeUndefined()
    expect(sendResult.success).toBe(true)

    //#when
    const config = await executeJsonTool(tools, "read_config", { team_name: "core" }, restartedLead) as {
      leadSessionId: string
    }

    //#then
    expect(config.leadSessionId).toBe("ses-restarted")
  })

  test("clears old inbox when teammate is removed then re-spawned", async () => {
    //#given
    const { manager } = createMockManager()
    const tools = createAgentTeamsTools(manager)
    const context = createContext()

    await executeJsonTool(tools, "team_create", { team_name: "core" }, context)
    await executeJsonTool(
      tools,
      "spawn_teammate",
      {
        team_name: "core",
        name: "worker_1",
        prompt: "First run",
      },
      context,
    )

    await executeJsonTool(
      tools,
      "send_message",
      {
        team_name: "core",
        type: "message",
        recipient: "worker_1",
        summary: "legacy",
        content: "legacy payload",
      },
      context,
    )

    await executeJsonTool(
      tools,
      "force_kill_teammate",
      {
        team_name: "core",
        agent_name: "worker_1",
      },
      context,
    )

    //#when
    await executeJsonTool(
      tools,
      "spawn_teammate",
      {
        team_name: "core",
        name: "worker_1",
        prompt: "Second run",
      },
      context,
    )

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
    ) as Array<{ text: string; summary?: string }>

    //#then
    expect(inbox.some((message) => message.text.includes("legacy payload"))).toBe(false)
    expect(inbox.some((message) => message.summary === "initial_prompt" && message.text.includes("Second run"))).toBe(true)
  })

  test("cannot add pending blockers to already in-progress task without status change", async () => {
    //#given
    const { manager } = createMockManager()
    const tools = createAgentTeamsTools(manager)
    const context = createContext()

    await executeJsonTool(tools, "team_create", { team_name: "core" }, context)

    const blocker = await executeJsonTool(
      tools,
      "team_task_create",
      {
        team_name: "core",
        subject: "Blocker",
        description: "Unfinished blocker",
      },
      context,
    ) as { id: string }

    const mainTask = await executeJsonTool(
      tools,
      "team_task_create",
      {
        team_name: "core",
        subject: "Main",
        description: "Main task",
      },
      context,
    ) as { id: string }

    await executeJsonTool(
      tools,
      "team_task_update",
      {
        team_name: "core",
        task_id: mainTask.id,
        status: "in_progress",
      },
      context,
    )

    //#when
    const result = await executeJsonTool(
      tools,
      "team_task_update",
      {
        team_name: "core",
        task_id: mainTask.id,
        add_blocked_by: [blocker.id],
      },
      context,
    ) as { error?: string }

    //#then
    expect(result.error).toBe(`blocked_by_incomplete:${blocker.id}:pending`)
  })

  test("binds sender to calling context and rejects sender spoofing", async () => {
    //#given
    const { manager } = createMockManager()
    const tools = createAgentTeamsTools(manager)
    const leadContext = createContext()
    await executeJsonTool(tools, "team_create", { team_name: "core" }, leadContext)
    await executeJsonTool(
      tools,
      "spawn_teammate",
      {
        team_name: "core",
        name: "worker_1",
        prompt: "Handle release prep",
      },
      leadContext,
    )

    const teammateContext = createContext("ses-worker-1")

    //#when
    const spoofed = await executeJsonTool(
      tools,
      "send_message",
      {
        team_name: "core",
        type: "message",
        sender: "team-lead",
        recipient: "worker_1",
        summary: "spoof",
        content: "I am lead",
      },
      teammateContext,
    ) as { error?: string }

    //#then
    expect(spoofed.error).toBe("sender_context_mismatch")

    //#when
    const validFromContext = await executeJsonTool(
      tools,
      "send_message",
      {
        team_name: "core",
        type: "message",
        recipient: "team-lead",
        summary: "update",
        content: "status from worker",
      },
      teammateContext,
    ) as { success?: boolean }

    //#then
    expect(validFromContext.success).toBe(true)
  })
})
