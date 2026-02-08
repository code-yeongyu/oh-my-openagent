/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTeamConfig, deleteTeamData } from "./team-config-store"
import { createTeamTask, deleteTeamTaskFile, readTeamTask } from "./team-task-store"

describe("agent-teams task store", () => {
  let originalCwd: string
  let tempProjectDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tempProjectDir = mkdtempSync(join(tmpdir(), "agent-teams-task-store-"))
    process.chdir(tempProjectDir)
    createTeamConfig("core", "Core team", "ses-main", tempProjectDir, "sisyphus")
  })

  afterEach(() => {
    deleteTeamData("core")
    process.chdir(originalCwd)
    rmSync(tempProjectDir, { recursive: true, force: true })
  })

  test("creates and reads a task", () => {
    //#given
    const created = createTeamTask("core", "Subject", "Description")

    //#when
    const loaded = readTeamTask("core", created.id)

    //#then
    expect(loaded?.id).toBe(created.id)
    expect(loaded?.subject).toBe("Subject")
  })

  test("rejects invalid team name and task id", () => {
    //#then
    expect(() => readTeamTask("../../etc", "T-1")).toThrow("team_name_invalid")
    expect(() => readTeamTask("core", "../../passwd")).toThrow("task_id_invalid")
    expect(() => deleteTeamTaskFile("core", "../../passwd")).toThrow("task_id_invalid")
  })
})
