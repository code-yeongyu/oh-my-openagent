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

  test("ensureBaseDirs swallows EPERM from chmod and logs a warning instead of aborting team-mode init", async () => {
    // given: directories exist with permissive mode that chmod cannot tighten
    // (mirrors macOS network mount / non-owner / SIP cases reported in #4023).
    const baseDir = path.join(tmpdir(), `omo-test-eperm-${randomUUID()}`)
    temporaryDirectories.push(baseDir)
    await mkdir(baseDir, { recursive: true })
    await mkdir(path.join(baseDir, "teams"), { recursive: true })
    await mkdir(path.join(baseDir, "runtime"), { recursive: true })
    await mkdir(path.join(baseDir, "worktrees"), { recursive: true })

    const realFs = await import("node:fs/promises")
    let chmodCalls = 0
    mock.module("node:fs/promises", () => ({
      ...realFs,
      chmod: async (target: string) => {
        chmodCalls += 1
        const eperm = Object.assign(new Error(`EPERM: operation not permitted, chmod '${target}'`), {
          code: "EPERM",
          syscall: "chmod",
          path: target,
          errno: -1,
        })
        throw eperm
      },
    }))

    const { ensureBaseDirs: ensureBaseDirsWithMockedChmod } = await import("./paths")
    logCalls.splice(0)

    // when
    let thrown: unknown = null
    try {
      await ensureBaseDirsWithMockedChmod(baseDir)
    } catch (error) {
      thrown = error
    }

    // then: function does not throw, EPERM was reached, and one warning was logged.
    expect(thrown).toBeNull()
    expect(chmodCalls).toBeGreaterThan(0)
    const warnings = logCalls.filter(([message]) =>
      message === "team-mode: chmod refused on base directory; continuing with existing permissions"
    )
    expect(warnings.length).toBeGreaterThan(0)
    const firstWarning = warnings[0]?.[1] as { code?: string; path?: string } | undefined
    expect(firstWarning?.code).toBe("EPERM")
    expect(firstWarning?.path).toContain(baseDir)
  })
})
