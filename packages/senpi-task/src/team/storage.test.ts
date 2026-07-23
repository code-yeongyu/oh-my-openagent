import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import type { StateDirConfig } from "../store"
import { StatePermissionsError } from "../store/state-permissions"
import {
  ensureTeamRuntimeDirs,
  resolveProjectTeamSpecPath,
  resolveTeamMemberInboxDir,
  resolveTeamRuntimeDirs,
  teamStorageBaseDir,
} from "./storage"

const created: string[] = []

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "senpi-task-team-storage-"))
  created.push(dir)
  return dir
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("team storage layout", () => {
  test("#given a project state dir config #when the base dir is resolved #then it lands under the senpi-task state dir", () => {
    // given
    const projectDir = makeProjectDir()
    const config: StateDirConfig = { project_dir: projectDir }

    // when
    const baseDir = teamStorageBaseDir(config)

    // then
    expect(baseDir).toBe(join(projectDir, ".omo", "senpi-task", "teams"))
  })

  test("#given a team run id #when runtime dirs are resolved #then runtime and tasks dirs live under the base dir", () => {
    // given
    const projectDir = makeProjectDir()
    const config: StateDirConfig = { project_dir: projectDir }
    const teamRunId = "11111111-1111-1111-1111-111111111111"

    // when
    const dirs = resolveTeamRuntimeDirs(config, teamRunId)

    // then
    expect(dirs.baseDir).toBe(join(projectDir, ".omo", "senpi-task", "teams"))
    expect(dirs.runtimeDir).toBe(join(dirs.baseDir, "runtime", teamRunId))
    expect(dirs.tasksDir).toBe(join(dirs.baseDir, "runtime", teamRunId, "tasks"))
    expect(resolveTeamMemberInboxDir(config, teamRunId, "finder")).toBe(
      join(dirs.baseDir, "runtime", teamRunId, "inboxes", "finder"),
    )
  })

  test("#given the discovery-only project spec path #when resolved #then it maps to the omo-compatible .omo/teams path", () => {
    // given
    const projectDir = makeProjectDir()

    // when
    const specPath = resolveProjectTeamSpecPath(projectDir, "research-team")

    // then
    expect(specPath).toBe(join(projectDir, ".omo", "teams", "research-team", "config.json"))
    expect(specPath.includes(`${sep}senpi-task${sep}`)).toBe(false)
  })

  test("#given a team run #when runtime dirs are ensured #then the directories are created at the right paths", async () => {
    // given
    const projectDir = makeProjectDir()
    const config: StateDirConfig = { project_dir: projectDir }
    const teamRunId = "22222222-2222-2222-2222-222222222222"

    // when
    const dirs = await ensureTeamRuntimeDirs(config, teamRunId, ["finder", "quick-1"])

    // then
    expect(existsSync(dirs.runtimeDir)).toBe(true)
    expect(existsSync(dirs.tasksDir)).toBe(true)
    expect(existsSync(resolveTeamMemberInboxDir(config, teamRunId, "finder"))).toBe(true)
    expect(existsSync(resolveTeamMemberInboxDir(config, teamRunId, "quick-1"))).toBe(true)
  })

  test.skipIf(process.platform === "win32")("#given a symlinked team base #when runtime storage is ensured #then the external target is unchanged", async () => {
    // given
    const projectDir = makeProjectDir()
    const config: StateDirConfig = { project_dir: projectDir }
    const stateDir = join(projectDir, ".omo", "senpi-task")
    const outsideDir = join(projectDir, "outside-team")
    mkdirSync(stateDir, { recursive: true })
    mkdirSync(outsideDir, { mode: 0o755 })
    symlinkSync(outsideDir, join(stateDir, "teams"))

    // when / then
    await expect(ensureTeamRuntimeDirs(config, "44444444-4444-4444-4444-444444444444", ["finder"]))
      .rejects.toBeInstanceOf(StatePermissionsError)
    expect(statSync(outsideDir).mode & 0o777).toBe(0o755)
  })
})
