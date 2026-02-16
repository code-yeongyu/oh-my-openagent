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

interface MockManagerHandles {
  manager: BackgroundManager
  launchCalls: Array<Record<string, unknown>>
}

function createMockManager(): MockManagerHandles {
  const launchCalls: Array<Record<string, unknown>> = []

  const manager = {
    launch: async (args: Record<string, unknown>) => {
      launchCalls.push(args)
      return { id: `bg-${launchCalls.length}`, sessionID: `ses-worker-${launchCalls.length}` }
    },
    getTask: () => undefined,
    resume: async () => ({ id: "resume-1" }),
    cancelTask: async () => true,
  } as unknown as BackgroundManager

  return { manager, launchCalls }
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

describe("agent-teams teammate tools", () => {
  let originalCwd: string
  let tempProjectDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tempProjectDir = mkdtempSync(join(tmpdir(), "agent-teams-teammate-tools-"))
    process.chdir(tempProjectDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tempProjectDir, { recursive: true, force: true })
  })

  test("spawn_teammate requires lead session authorization", async () => {
    //#given
    const { manager, launchCalls } = createMockManager()
    const tools = createAgentTeamsTools(manager)
    const leadContext = createContext("ses-lead")
    const teammateContext = createContext("ses-worker")

    await executeJsonTool(tools, "team_create", { team_name: "core" }, leadContext)

    //#when
    const unauthorized = await executeJsonTool(
      tools,
      "spawn_teammate",
      {
        team_name: "core",
        name: "worker_1",
        prompt: "Handle release prep",
        category: "quick",
      },
      teammateContext,
    ) as { error?: string }

    //#then
    expect(unauthorized.error).toBe("unauthorized_lead_session")
    expect(launchCalls).toHaveLength(0)
  })
})
