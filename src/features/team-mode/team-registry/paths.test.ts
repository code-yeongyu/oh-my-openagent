/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"

const logCalls: Array<[string, unknown?]> = []

mock.module("../../../shared/logger", () => ({
  log: (message: string, data?: unknown) => {
    logCalls.push([message, data])
  },
}))

const { discoverTeamSpecs, ensureBaseDirs, resolveBaseDir } = await import("./paths")

async function createTemporaryRoot(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "team-mode-paths-"))
}

describe("paths", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    logCalls.splice(0)
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true })
    }))
  })

  test("resolveBaseDir defaults to ~/.omo", () => {
    // given
    const config = TeamModeConfigSchema.parse({ base_dir: undefined })

    // when
    const resolvedBaseDir = resolveBaseDir(config)

    // then
    expect(resolvedBaseDir).toBe(path.join(homedir(), ".omo"))
  })

  test("resolveBaseDir honors override", () => {
    // given
    const config = TeamModeConfigSchema.parse({ base_dir: "/tmp/test-abc" })

    // when
    const resolvedBaseDir = resolveBaseDir(config)

    // then
    expect(resolvedBaseDir).toBe("/tmp/test-abc")
  })

  test("discoverTeamSpecs prefers project scope", async () => {
    // given
    const rootDirectory = await createTemporaryRoot()
    temporaryDirectories.push(rootDirectory)

    const projectRoot = path.join(rootDirectory, "project")
    const userBaseDir = path.join(rootDirectory, "home", ".omo")
    const projectTeamDir = path.join(projectRoot, ".omo", "teams", "foo")
    const userTeamDir = path.join(userBaseDir, "teams", "foo")

    await mkdir(projectTeamDir, { recursive: true })
    await mkdir(userTeamDir, { recursive: true })

    await writeFile(path.join(projectTeamDir, "config.json"), "{}")
    await writeFile(path.join(userTeamDir, "config.json"), "{}")
    logCalls.splice(0)

    // when
    const teamSpecs = await discoverTeamSpecs(TeamModeConfigSchema.parse({ base_dir: userBaseDir }), projectRoot)

    // then
    expect(teamSpecs).toEqual([
      {
        name: "foo",
        scope: "project",
        path: path.join(projectTeamDir, "config.json"),
      },
    ])
    expect(logCalls).toEqual([
      [
        "team-spec collision",
        {
          event: "team-spec-collision",
          teamName: "foo",
          projectPath: path.join(projectTeamDir, "config.json"),
          userPath: path.join(userTeamDir, "config.json"),
        },
      ],
    ])
  })

  test("ensureBaseDirs creates all dirs with mode 0700", async () => {
    // given
    const baseDir = path.join(tmpdir(), `omo-test-${randomUUID()}`)

    // when
    await ensureBaseDirs(baseDir)
    await ensureBaseDirs(baseDir)

    // then
    const directoryPaths = [
      baseDir,
      path.join(baseDir, "teams"),
      path.join(baseDir, "runtime"),
      path.join(baseDir, "worktrees"),
    ]

    for (const directoryPath of directoryPaths) {
      const directoryStat = await stat(directoryPath)
      expect(directoryStat.isDirectory()).toBe(true)
      expect(directoryStat.mode & 0o777).toBe(0o700)
    }
  })
})
