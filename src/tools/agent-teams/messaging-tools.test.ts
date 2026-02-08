/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BackgroundManager } from "../../features/background-agent"
import { createAgentTeamsTools } from "./tools"

interface TestToolContext {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
}

interface ResumeCall {
  sessionId: string
  prompt: string
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

function createManagerWithImmediateResume(): { manager: BackgroundManager; resumeCalls: ResumeCall[] } {
  const resumeCalls: ResumeCall[] = []
  let launchCount = 0

  const manager = {
    launch: async () => {
      launchCount += 1
      return { id: `bg-${launchCount}`, sessionID: `ses-worker-${launchCount}` }
    },
    getTask: () => undefined,
    resume: async (args: ResumeCall) => {
      resumeCalls.push(args)
      return { id: `resume-${resumeCalls.length}` }
    },
  } as unknown as BackgroundManager

  return { manager, resumeCalls }
}

function createManagerWithDeferredResume(): {
  manager: BackgroundManager
  resumeCalls: ResumeCall[]
  resolveAllResumes: () => void
} {
  const resumeCalls: ResumeCall[] = []
  const pendingResolves: Array<() => void> = []
  let launchCount = 0

  const manager = {
    launch: async () => {
      launchCount += 1
      return { id: `bg-${launchCount}`, sessionID: `ses-worker-${launchCount}` }
    },
    getTask: () => undefined,
    resume: (args: ResumeCall) => {
      resumeCalls.push(args)
      return new Promise<{ id: string }>((resolve) => {
        pendingResolves.push(() => resolve({ id: `resume-${resumeCalls.length}` }))
      })
    },
  } as unknown as BackgroundManager

  return {
    manager,
    resumeCalls,
    resolveAllResumes: () => {
      while (pendingResolves.length > 0) {
        const next = pendingResolves.shift()
        next?.()
      }
    },
  }
}

describe("agent-teams messaging tools", () => {
  let originalCwd: string
  let tempProjectDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tempProjectDir = mkdtempSync(join(tmpdir(), "agent-teams-messaging-"))
    process.chdir(tempProjectDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tempProjectDir, { recursive: true, force: true })
  })

  test("send_message rejects recipient team suffix mismatch", async () => {
    //#given
    const { manager, resumeCalls } = createManagerWithImmediateResume()
    const tools = createAgentTeamsTools(manager)
    const leadContext = createContext()
    await executeJsonTool(tools, "team_create", { team_name: "core" }, leadContext)
    await executeJsonTool(
      tools,
      "spawn_teammate",
      { team_name: "core", name: "worker_1", prompt: "Handle release prep", category: "quick" },
      leadContext,
    )

    //#when
    const mismatchedRecipient = await executeJsonTool(
      tools,
      "send_message",
      {
        team_name: "core",
        type: "message",
        recipient: "worker_1@other-team",
        summary: "sync",
        content: "Please update status.",
      },
      leadContext,
    ) as { error?: string }

    //#then
    expect(mismatchedRecipient.error).toBe("recipient_team_mismatch")
    expect(resumeCalls).toHaveLength(0)
  })

  test("broadcast schedules teammate resumes without serial await", async () => {
    //#given
    const { manager, resumeCalls, resolveAllResumes } = createManagerWithDeferredResume()
    const tools = createAgentTeamsTools(manager)
    const leadContext = createContext()
    await executeJsonTool(tools, "team_create", { team_name: "core" }, leadContext)

    for (const name of ["worker_1", "worker_2", "worker_3"]) {
      await executeJsonTool(
        tools,
        "spawn_teammate",
        { team_name: "core", name, prompt: "Handle release prep", category: "quick" },
        leadContext,
      )
    }

    //#when
    const broadcastPromise = executeJsonTool(
      tools,
      "send_message",
      { team_name: "core", type: "broadcast", summary: "sync", content: "Please update status." },
      leadContext,
    ) as Promise<{ success?: boolean; message?: string }>

    await Promise.resolve()
    await Promise.resolve()

    //#then
    expect(resumeCalls).toHaveLength(3)

    //#when
    resolveAllResumes()
    const broadcastResult = await broadcastPromise

    //#then
    expect(broadcastResult.success).toBe(true)
    expect(broadcastResult.message).toBe("broadcast_sent:3")
  })
})
