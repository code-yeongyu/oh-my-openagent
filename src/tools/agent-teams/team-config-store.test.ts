/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireLock } from "../../features/claude-tasks/storage"
import { getTeamDir, getTeamTaskDir, getTeamsRootDir } from "./paths"
import {
  createTeamConfig,
  deleteTeamData,
  readTeamConfigOrThrow,
  teamExists,
  upsertTeammate,
  writeTeamConfig,
} from "./team-config-store"

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

    try {
      //#when
      const deleteWhileLocked = () => deleteTeamData("core")

      //#then
      expect(deleteWhileLocked).toThrow("team_lock_unavailable")
      expect(teamExists("core")).toBe(true)
    } finally {
      //#when
      lock.release()
    }

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

  test("deleteTeamData removes task files before deleting team directory", () => {
    //#given
    const taskDir = getTeamTaskDir("core")
    const teamDir = getTeamDir("core")
    const teamsRootDir = getTeamsRootDir()
    expect(existsSync(taskDir)).toBe(true)
    expect(existsSync(teamDir)).toBe(true)

    //#when
    chmodSync(teamsRootDir, 0o555)
    try {
      const deleteWithBlockedTeamParent = () => deleteTeamData("core")
      expect(deleteWithBlockedTeamParent).toThrow()
    } finally {
      chmodSync(teamsRootDir, 0o755)
    }

    //#then
    expect(existsSync(taskDir)).toBe(false)
    expect(existsSync(teamDir)).toBe(true)
  })

  test("deleteTeamData fails if team has active teammates", () => {
    //#given
    const config = readTeamConfigOrThrow("core")
    const updated = upsertTeammate(config, {
      agentId: "teammate@core",
      name: "teammate",
      agentType: "sisyphus",
      category: "test",
      model: "sisyphus",
      prompt: "test prompt",
      color: "#000000",
      planModeRequired: false,
      joinedAt: Date.now(),
      cwd: process.cwd(),
      subscriptions: [],
      backendType: "native",
      isActive: true,
      sessionID: "ses-sub",
    })
    writeTeamConfig("core", updated)

    //#when
    const deleteWithTeammates = () => deleteTeamData("core")

    //#then
    expect(deleteWithTeammates).toThrow("team_has_active_members")
    expect(teamExists("core")).toBe(true)

    //#when - cleanup teammate to allow afterEach to succeed
    const cleared = { ...updated, members: updated.members.filter(m => m.name === "team-lead") }
    writeTeamConfig("core", cleared)
    deleteTeamData("core")

    //#then
    expect(teamExists("core")).toBe(false)
  })

})
