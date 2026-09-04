/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

import { TeamModeConfigSchema } from "../config"
import { discoverTeamSpecs, ensureBaseDirs, getInboxDir, getRuntimeStateDir, getTasksDir, getTeamSpecPath, getWorktreeDir, resolveBaseDir } from "./paths"

const logCalls: Array<[string, unknown?]> = []

function captureLog(message: string, data?: unknown): void {
  logCalls.push([message, data])
}

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

  test("#given base dir starts with tilde #when resolving team base dir #then it expands to the user home directory", () => {
    // given
    const config = TeamModeConfigSchema.parse({ base_dir: "~/.omo" })

    // when
    const resolvedBaseDir = resolveBaseDir(config)

    // then
    expect(resolvedBaseDir).toBe(path.join(homedir(), ".omo"))
  })

  test("#given team runtime ids contain traversal #when runtime paths are built #then they are rejected before escaping base dir", () => {
    // given
    const baseDir = "/tmp/omo-contained"

    // when
    const runtimeStatePath = () => getRuntimeStateDir(baseDir, "../../escape")
    const inboxPath = () => getInboxDir(baseDir, "run-1", "../../escape")
    const tasksPath = () => getTasksDir(baseDir, "../../escape")
    const worktreePath = () => getWorktreeDir(baseDir, "run-1", "../../escape")

    // then
    expect(runtimeStatePath).toThrow("team path escapes base directory")
    expect(inboxPath).toThrow("team path escapes base directory")
    expect(tasksPath).toThrow("team path escapes base directory")
    expect(worktreePath).toThrow("team path escapes base directory")
  })

  test("#given team names contain traversal #when spec paths are built #then they are rejected before escaping scope roots", () => {
    // given
    const baseDir = "/tmp/omo-contained"
    const projectRoot = "/tmp/project-contained"

    // when
    const userSpecPath = () => getTeamSpecPath(baseDir, "../../escape", "user")
    const projectSpecPath = () => getTeamSpecPath(baseDir, "../../escape", "project", projectRoot)

    // then
    expect(userSpecPath).toThrow("team path escapes base directory")
    expect(projectSpecPath).toThrow("team path escapes base directory")
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
    const teamSpecs = await discoverTeamSpecs(TeamModeConfigSchema.parse({ base_dir: userBaseDir }), projectRoot, {
      log: captureLog,
    })

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
      if (process.platform !== "win32") {
        expect(directoryStat.mode & 0o777).toBe(0o700)
      }
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

    let chmodCalls = 0
    const chmodWithEperm: typeof chmod = async (target, _mode): Promise<void> => {
      chmodCalls += 1
      const eperm = Object.assign(new Error(`EPERM: operation not permitted, chmod '${target}'`), {
        code: "EPERM",
        syscall: "chmod",
        path: target,
        errno: -1,
      })
      throw eperm
    }
    logCalls.splice(0)

    // when
    const ensuredBaseDirectories = ensureBaseDirs(baseDir, {
      chmod: chmodWithEperm,
      log: captureLog,
      mkdir,
      stat,
    })

    // then: function does not throw, EPERM was reached, and one warning was logged.
    await expect(ensuredBaseDirectories).resolves.toBeUndefined()
    expect(chmodCalls).toBeGreaterThan(0)
    const warnings = logCalls.filter(([message]) =>
      message === "team-mode: chmod refused on base directory; continuing with existing permissions"
    )
    expect(warnings.length).toBeGreaterThan(0)
    const firstWarning = warnings[0]?.[1]
    expect(firstWarning).toBeObject()
    if (typeof firstWarning !== "object" || firstWarning === null) {
      throw new Error("expected warning metadata")
    }
    expect("code" in firstWarning ? firstWarning.code : undefined).toBe("EPERM")
    expect("path" in firstWarning ? firstWarning.path : undefined).toContain(baseDir)
  })
})
