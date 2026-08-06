/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"

const ORACLE_REJECTION_MESSAGE =
  "Agent 'oracle' is read-only (cannot write files). Team members must write to mailbox inbox files. Use delegate-task with subagent_type: 'oracle' for read-only analysis instead."

const { TeamSpecValidationError, loadAllTeamSpecs, loadTeamSpec } = await import("./loader")

function createBaseSpec(teamName: string): {
  version: 1
  name: string
  description: string
  createdAt: number
  leadAgentId: string
  members: Array<Record<string, unknown>>
} {
  return {
    version: 1,
    name: teamName,
    description: `${teamName} description`,
    createdAt: Date.now(),
    leadAgentId: "lead",
    members: [
      { kind: "category", name: "lead", category: "deep", prompt: "implement the leader task" },
      { kind: "category", name: "reviewer", category: "quick", prompt: "review the current output" },
      { kind: "category", name: "tester", category: "deep", prompt: "verify the resulting behavior" },
    ],
  }
}

async function createTemporaryRoot(): Promise<string> {
  const directoryPath = path.join(tmpdir(), `team-mode-loader-${randomUUID()}`)
  await mkdir(directoryPath, { recursive: true })
  return directoryPath
}

function getFixturePaths(rootDirectory: string, teamName: string) {
  const projectRoot = path.join(rootDirectory, "project")
  const userBaseDir = path.join(rootDirectory, "home", ".omo")

  return {
    projectRoot,
    userBaseDir,
    projectConfigPath: path.join(projectRoot, ".omo", "teams", teamName, "config.json"),
    userConfigPath: path.join(userBaseDir, "teams", teamName, "config.json"),
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function createConfig(userBaseDir: string) {
  return TeamModeConfigSchema.parse({ base_dir: userBaseDir })
}

describe("team-registry loader", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true })
    }))
  })

  test("loads and validates a valid 3-member team spec", async () => {
    // given
    const rootDirectory = await createTemporaryRoot()
    temporaryDirectories.push(rootDirectory)
    const fixturePaths = getFixturePaths(rootDirectory, "alpha")
    await writeJsonFile(fixturePaths.userConfigPath, createBaseSpec("alpha"))

    // when
    const teamSpec = await loadTeamSpec("alpha", createConfig(fixturePaths.userBaseDir), fixturePaths.projectRoot)

    // then
    expect(teamSpec.name).toBe("alpha")
    expect(teamSpec.members).toHaveLength(3)
    expect(teamSpec.leadAgentId).toBe("lead")
  })

  test("defaults version when omitted from stored specs", async () => {
    // given
    const rootDirectory = await createTemporaryRoot()
    temporaryDirectories.push(rootDirectory)
    const fixturePaths = getFixturePaths(rootDirectory, "default-version")
    const { version: _version, ...teamSpecWithoutVersion } = createBaseSpec("default-version")
    await writeJsonFile(fixturePaths.userConfigPath, teamSpecWithoutVersion)

    // when
    const teamSpec = await loadTeamSpec("default-version", createConfig(fixturePaths.userBaseDir), fixturePaths.projectRoot)

    // then
    expect(teamSpec.version).toBe(1)
  })

  test("defaults createdAt from Date.now when omitted from stored specs", async () => {
    // given
    const originalDateNow = Date.now
    Date.now = () => 222_333_444
    const rootDirectory = await createTemporaryRoot()
    temporaryDirectories.push(rootDirectory)
    const fixturePaths = getFixturePaths(rootDirectory, "default-created-at")
    const { createdAt: _createdAt, ...teamSpecWithoutCreatedAt } = createBaseSpec("default-created-at")
    await writeJsonFile(fixturePaths.userConfigPath, teamSpecWithoutCreatedAt)

    try {
      // when
      const teamSpec = await loadTeamSpec("default-created-at", createConfig(fixturePaths.userBaseDir), fixturePaths.projectRoot)

      // then
      expect(teamSpec.createdAt).toBe(222_333_444)
    } finally {
      Date.now = originalDateNow
    }
  })

  test("derives leadAgentId and prepends lead shorthand to members", async () => {
    // given
    const rootDirectory = await createTemporaryRoot()
    temporaryDirectories.push(rootDirectory)
    const fixturePaths = getFixturePaths(rootDirectory, "lead-shorthand")
    await writeJsonFile(fixturePaths.userConfigPath, {
      name: "lead-shorthand",
      description: "team with shorthand lead",
      lead: { kind: "subagent_type", subagent_type: "sisyphus" },
      members: [
        { kind: "category", name: "scout-1", category: "deep", prompt: "Scout the src directory for auth patterns." },
        { kind: "category", name: "scout-2", category: "quick", prompt: "Scout tests for auth coverage." },
      ],
    })

    // when
    const teamSpec = await loadTeamSpec("lead-shorthand", createConfig(fixturePaths.userBaseDir), fixturePaths.projectRoot)

    // then
    expect(teamSpec.leadAgentId).toBe("lead")
    expect(teamSpec.members).toHaveLength(3)
    expect(teamSpec.members[0]).toMatchObject({ kind: "subagent_type", name: "lead", subagent_type: "sisyphus" })
  })

  test("derives leadAgentId from the only member when no lead hint exists", async () => {
    // given
    const rootDirectory = await createTemporaryRoot()
    temporaryDirectories.push(rootDirectory)
    const fixturePaths = getFixturePaths(rootDirectory, "solo")
    await writeJsonFile(fixturePaths.userConfigPath, {
      name: "solo",
      members: [{ kind: "category", name: "solo-lead", category: "deep", prompt: "Implement the assigned work for the solo team." }],
    })

    // when
    const teamSpec = await loadTeamSpec("solo", createConfig(fixturePaths.userBaseDir), fixturePaths.projectRoot)

    // then
    expect(teamSpec.leadAgentId).toBe("solo-lead")
    expect(teamSpec.members).toHaveLength(1)
  })

  test("rejects multi-member specs without any lead indicator with a helpful message", async () => {
    // given
    const rootDirectory = await createTemporaryRoot()
    temporaryDirectories.push(rootDirectory)
    const fixturePaths = getFixturePaths(rootDirectory, "missing-lead")
    await writeJsonFile(fixturePaths.userConfigPath, {
      name: "missing-lead",
      members: [
        { kind: "category", name: "member-1", category: "deep", prompt: "Implement the assigned work for member one." },
        { kind: "category", name: "member-2", category: "quick", prompt: "Review the assigned work for member one." },
      ],
    })

    // when
    let thrownError: unknown
    try {
      await loadTeamSpec("missing-lead", createConfig(fixturePaths.userBaseDir), fixturePaths.projectRoot)
    } catch (error) {
      thrownError = error
    }

    // then
    expect(thrownError).toMatchObject({
      name: TeamSpecValidationError.name,
      message: "Invalid team spec field 'leadAgentId': leadAgentId required (or write a `lead: {...}` field, or mark one member with `isLead: true`)",
      code: "INVALID_TEAM_SPEC",
      field: "leadAgentId",
    })
  })

  test("rejects oracle subagent members with the exact plan message", async () => {
    // given
    const rootDirectory = await createTemporaryRoot()
    temporaryDirectories.push(rootDirectory)
    const fixturePaths = getFixturePaths(rootDirectory, "oracle-team")
    const teamSpec = createBaseSpec("oracle-team")
    teamSpec.members = [{ kind: "subagent_type", name: "lead", subagent_type: "oracle" }]
    await writeJsonFile(fixturePaths.userConfigPath, teamSpec)

    // when
    let thrownError: unknown
    try {
      await loadTeamSpec("oracle-team", createConfig(fixturePaths.userBaseDir), fixturePaths.projectRoot)
    } catch (error) {
      thrownError = error
    }

    // then
    expect(thrownError).toMatchObject({
      name: TeamSpecValidationError.name,
      message: ORACLE_REJECTION_MESSAGE,
      code: "INELIGIBLE_AGENT",
      field: "subagent_type",
      memberName: "lead",
    })
  })

  test("prefers the project-scoped team spec when both scopes define the same name", async () => {
    // given
    const rootDirectory = await createTemporaryRoot()
    temporaryDirectories.push(rootDirectory)
    const fixturePaths = getFixturePaths(rootDirectory, "dup")
    const projectSpec = { ...createBaseSpec("dup"), description: "project-owned" }
    const userSpec = { ...createBaseSpec("dup"), description: "user-owned" }

    await writeJsonFile(fixturePaths.projectConfigPath, projectSpec)
    await writeJsonFile(fixturePaths.userConfigPath, userSpec)

    // when
    const teamSpec = await loadTeamSpec("dup", createConfig(fixturePaths.userBaseDir), fixturePaths.projectRoot)

    // then
    expect(teamSpec.description).toBe("project-owned")
  })

  test("returns malformed team specs as data during load-all startup", async () => {
    // given
    const rootDirectory = await createTemporaryRoot()
    temporaryDirectories.push(rootDirectory)
    const goodFixturePaths = getFixturePaths(rootDirectory, "good")
    const badFixturePaths = getFixturePaths(rootDirectory, "broken")

    await writeJsonFile(goodFixturePaths.userConfigPath, createBaseSpec("good"))
    await mkdir(path.dirname(badFixturePaths.userConfigPath), { recursive: true })
    await writeFile(badFixturePaths.userConfigPath, "{\n  invalid json\n")

    // when
    const results = await loadAllTeamSpecs(createConfig(goodFixturePaths.userBaseDir), goodFixturePaths.projectRoot)

    // then
    expect(results).toHaveLength(2)
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "good", scope: "user", spec: expect.objectContaining({ name: "good" }) }),
      expect.objectContaining({
        name: "broken",
        scope: "user",
        error: expect.objectContaining({ name: TeamSpecValidationError.name, code: "INVALID_JSON" }),
      }),
    ]))
  })

  test("rejects specs with more than 8 members", async () => {
    // given
    const rootDirectory = await createTemporaryRoot()
    temporaryDirectories.push(rootDirectory)
    const fixturePaths = getFixturePaths(rootDirectory, "too-many")
    const teamSpec = createBaseSpec("too-many")
    teamSpec.members = Array.from({ length: 9 }, (_, index) => ({
      kind: "category",
      name: `member-${index}`,
      category: "deep",
      prompt: `implement task number ${index}`,
    }))
    teamSpec.leadAgentId = "member-0"
    await writeJsonFile(fixturePaths.userConfigPath, teamSpec)

    // when
    let thrownError: unknown
    try {
      await loadTeamSpec("too-many", createConfig(fixturePaths.userBaseDir), fixturePaths.projectRoot)
    } catch (error) {
      thrownError = error
    }

    // then
    expect(thrownError).toMatchObject({
      name: TeamSpecValidationError.name,
      message: "Team 'too-many' exceeds max 8 members.",
      code: "TEAM_MEMBER_LIMIT_EXCEEDED",
      field: "members",
    })
  })
})
