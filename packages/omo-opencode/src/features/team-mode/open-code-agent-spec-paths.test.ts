/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { getAgentDisplayName } from "../../shared/agent-display-names"
import { TeamModeConfigSchema } from "../../config/schema/team-mode"
import { loadAllTeamSpecs, loadTeamSpec } from "./team-registry/loader"
import { parseInlineTeamSpec } from "./tools/lifecycle-inline-spec"
import { DEFERRED_OPEN_CODE_AGENT_ELIGIBILITY } from "./open-code-agent-eligibility"

function createHardRejectAliasSpec(name: string) {
  return {
    name,
    leadAgentId: "lead",
    members: [{
      kind: "subagent_type",
      name: "lead",
      subagent_type: getAgentDisplayName("prometheus"),
    }],
  }
}

describe("OpenCode agent eligibility across Team spec paths", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true })
    }))
  })

  test("rejects a hard-reject display alias in an inline spec", () => {
    // given
    const spec = createHardRejectAliasSpec("inline-alias")

    // when
    let thrownError: unknown
    try {
      parseInlineTeamSpec(spec)
    } catch (error) {
      if (!(error instanceof Error)) throw error
      thrownError = error
    }

    // then
    expect(thrownError).toMatchObject({ code: "INELIGIBLE_AGENT" })
  })

  test("rejects a hard-reject display alias in named and listed specs", async () => {
    // given
    const rootDirectory = path.join(tmpdir(), `open-code-agent-spec-paths-${randomUUID()}`)
    temporaryDirectories.push(rootDirectory)
    const projectRoot = path.join(rootDirectory, "project")
    const userBaseDir = path.join(rootDirectory, "home", ".omo")
    const teamName = "stored-alias"
    const configPath = path.join(userBaseDir, "teams", teamName, "config.json")
    await mkdir(path.dirname(configPath), { recursive: true })
    await writeFile(configPath, `${JSON.stringify(createHardRejectAliasSpec(teamName), null, 2)}\n`)
    const config = TeamModeConfigSchema.parse({ base_dir: userBaseDir })
    const options = { eligibilityPolicy: DEFERRED_OPEN_CODE_AGENT_ELIGIBILITY }

    // when
    const namedSpec = expect(loadTeamSpec(teamName, config, projectRoot, options))
      .rejects.toMatchObject({ code: "INELIGIBLE_AGENT" })
    const listedSpecs = await loadAllTeamSpecs(config, projectRoot, options)

    // then
    await namedSpec
    expect(listedSpecs).toEqual([
      expect.objectContaining({
        name: teamName,
        error: expect.objectContaining({ code: "INELIGIBLE_AGENT" }),
      }),
    ])
  })
})
