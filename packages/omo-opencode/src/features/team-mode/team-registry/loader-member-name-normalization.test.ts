/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import { resolveCallerTeamLead } from "../resolve-caller-team-lead"
import { loadTeamSpec } from "./loader"

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
    userConfigPath: path.join(userBaseDir, "teams", teamName, "config.json"),
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

describe("loadTeamSpec member name normalization", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true })
    }))
  })

  test("auto-assigns missing member names for specs on disk", async () => {
    // given
    const rootDirectory = await createTemporaryRoot()
    temporaryDirectories.push(rootDirectory)
    const fixturePaths = getFixturePaths(rootDirectory, "autoname")
    await writeJsonFile(fixturePaths.userConfigPath, {
      name: "autoname",
      lead: { kind: "subagent_type", subagent_type: "sisyphus" },
      members: [
        { kind: "category", category: "quick", prompt: "Quick scout the workspace structure." },
        { kind: "category", category: "deep", prompt: "Deep dive the runtime setup." },
        { kind: "category", category: "deep", prompt: "Deep dive the mailbox implementation." },
        { kind: "subagent_type", subagent_type: "atlas" },
      ],
    })

    // when
    const teamSpec = await loadTeamSpec("autoname", TeamModeConfigSchema.parse({ base_dir: fixturePaths.userBaseDir }), fixturePaths.projectRoot)

    // then
    expect(teamSpec.leadAgentId).toBe("lead")
    expect(teamSpec.members.map((member) => member.name)).toEqual(["lead", "quick-1", "deep-1", "deep-2", "atlas-1"])
  })

  test("injects the caller as lead for preset specs without explicit lead metadata", async () => {
    // given
    const rootDirectory = await createTemporaryRoot()
    temporaryDirectories.push(rootDirectory)
    const fixturePaths = getFixturePaths(rootDirectory, "caller-lead")
    await writeJsonFile(fixturePaths.userConfigPath, {
      name: "caller-lead",
      members: [
        { kind: "category", category: "quick", prompt: "Quick scout the workspace structure." },
        { kind: "subagent_type", subagent_type: "atlas" },
      ],
    })

    // when
    const teamSpec = await loadTeamSpec(
      "caller-lead",
      TeamModeConfigSchema.parse({ base_dir: fixturePaths.userBaseDir }),
      fixturePaths.projectRoot,
      { callerTeamLead: resolveCallerTeamLead("\u200BSisyphus - Ultraworker") },
    )

    // then
    expect(teamSpec.leadAgentId).toBe("lead")
    expect(teamSpec.members.map((member) => member.name)).toEqual(["lead", "quick-1", "atlas-1"])
  })
})
