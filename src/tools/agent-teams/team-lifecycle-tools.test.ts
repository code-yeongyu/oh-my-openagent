/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BackgroundManager } from "../../features/background-agent"
import { getTeamDir } from "./paths"
import { createAgentTeamsTools } from "./tools"

interface TestToolContext {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
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

describe("agent-teams team lifecycle tools", () => {
  let originalCwd: string
  let tempProjectDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tempProjectDir = mkdtempSync(join(tmpdir(), "agent-teams-lifecycle-"))
    process.chdir(tempProjectDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tempProjectDir, { recursive: true, force: true })
  })

  test("team_delete requires lead session authorization", async () => {
    //#given
    const tools = createAgentTeamsTools({} as BackgroundManager)
    const leadContext = createContext("ses-main")
    await executeJsonTool(tools, "team_create", { team_name: "core" }, leadContext)

    //#when
    const unauthorized = await executeJsonTool(
      tools,
      "team_delete",
      { team_name: "core" },
      createContext("ses-intruder"),
    ) as { error?: string }

    //#then
    expect(unauthorized.error).toBe("unauthorized_lead_session")
    expect(existsSync(getTeamDir("core"))).toBe(true)
  })
})
