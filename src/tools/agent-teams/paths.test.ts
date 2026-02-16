/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  getAgentTeamsRootDir,
  getTeamConfigPath,
  getTeamDir,
  getTeamInboxDir,
  getTeamInboxPath,
  getTeamTaskDir,
  getTeamTaskPath,
  getTeamsRootDir,
  getTeamTasksRootDir,
} from "./paths"

describe("agent-teams paths", () => {
  let originalCwd: string
  let tempProjectDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tempProjectDir = mkdtempSync(join(tmpdir(), "agent-teams-paths-"))
    process.chdir(tempProjectDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tempProjectDir, { recursive: true, force: true })
  })

  test("uses project-local .sisyphus directory as storage root", () => {
    //#given
    const expectedRoot = join(tempProjectDir, ".sisyphus", "agent-teams")

    //#when
    const root = getAgentTeamsRootDir()

    //#then
    expect(root).toBe(expectedRoot)
  })

  test("builds expected teams and tasks root directories", () => {
    //#given
    const expectedRoot = join(tempProjectDir, ".sisyphus", "agent-teams")

    //#when
    const teamsRoot = getTeamsRootDir()
    const tasksRoot = getTeamTasksRootDir()

    //#then
    expect(teamsRoot).toBe(join(expectedRoot, "teams"))
    expect(tasksRoot).toBe(join(expectedRoot, "tasks"))
  })

  test("builds team-scoped config, inbox, and task file paths", () => {
    //#given
    const teamName = "alpha_team"
    const agentName = "worker_1"
    const taskId = "T-123"
    const expectedTeamDir = join(getTeamsRootDir(), teamName)

    //#when
    const teamDir = getTeamDir(teamName)
    const configPath = getTeamConfigPath(teamName)
    const inboxDir = getTeamInboxDir(teamName)
    const inboxPath = getTeamInboxPath(teamName, agentName)
    const taskDir = getTeamTaskDir(teamName)
    const taskPath = getTeamTaskPath(teamName, taskId)

    //#then
    expect(teamDir).toBe(expectedTeamDir)
    expect(configPath).toBe(join(expectedTeamDir, "config.json"))
    expect(inboxDir).toBe(join(expectedTeamDir, "inboxes"))
    expect(inboxPath).toBe(join(expectedTeamDir, "inboxes", `${agentName}.json`))
    expect(taskDir).toBe(join(getTeamTasksRootDir(), teamName))
    expect(taskPath).toBe(join(getTeamTasksRootDir(), teamName, `${taskId}.json`))
  })
})
