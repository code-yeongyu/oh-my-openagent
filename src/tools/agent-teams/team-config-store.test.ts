/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireLock } from "../../features/claude-tasks/storage"
import { getTeamDir, getTeamTaskDir } from "./paths"
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

  test("deleteTeamData waits for task lock before removing task files", () => {
    //#given
    const lock = acquireLock(getTeamTaskDir("core"))
    expect(lock.acquired).toBe(true)

    try {
      //#when
      const deleteWhileLocked = () => deleteTeamData("core")

      //#then
      expect(deleteWhileLocked).toThrow("team_task_lock_unavailable")
      expect(teamExists("core")).toBe(true)
    } finally {
      lock.release()
    }

    //#when
    deleteTeamData("core")

    //#then
    expect(teamExists("core")).toBe(false)
  })
})
