/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireLock } from "../../features/claude-tasks/storage"
import { getTeamDir } from "./paths"
import { createTeamConfig, deleteTeamData, teamExists } from "./team-config-store"

describe("agent-teams team config store", () => {
  let originalCwd: string
  let tempProjectDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tempProjectDir = mkdtempSync(join(tmpdir(), "agent-teams-config-store-"))
    process.chdir(tempProjectDir)
    createTeamConfig("core", "Core team", "ses-main", tempProjectDir, "sisyphus")
  })

  afterEach(() => {
    if (teamExists("core")) {
      deleteTeamData("core")
    }
    process.chdir(originalCwd)
    rmSync(tempProjectDir, { recursive: true, force: true })
  })

  test("deleteTeamData waits for team lock before removing team files", () => {
    //#given
    const lock = acquireLock(getTeamDir("core"))
    expect(lock.acquired).toBe(true)

    //#when
    const deleteWhileLocked = () => deleteTeamData("core")

    //#then
    expect(deleteWhileLocked).toThrow("team_lock_unavailable")
    expect(teamExists("core")).toBe(true)

    //#when
    lock.release()
    deleteTeamData("core")

    //#then
    expect(teamExists("core")).toBe(false)
  })
})
