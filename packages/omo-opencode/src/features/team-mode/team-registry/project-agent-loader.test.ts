/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import { loadTeamSpec } from "@oh-my-opencode/team-core/team-registry/loader"
import { createTeamCreateTool } from "../tools/lifecycle-create-tool"
import {
  backgroundManager,
  config,
  createSpec,
  createTeamRunMock,
  createToolContext,
  listActiveTeamsMock,
  loadRuntimeStateMock,
  loadTeamSpecMock,
  mockClient,
  resetLifecycleTestState,
} from "../tools/lifecycle-test-fixture"
import { createTeamListTool } from "../tools/query"

const temporaryDirectories: string[] = []

beforeEach(resetLifecycleTestState)

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("OpenCode team-registry loader", () => {
  test("allows a named spec to carry an unknown project subagent type", async () => {
    // given
    const root = path.join(tmpdir(), `project-agent-team-spec-${randomUUID()}`)
    temporaryDirectories.push(root)
    const projectRoot = path.join(root, "project")
    const baseDir = path.join(root, "home", ".omo")
    const configPath = path.join(baseDir, "teams", "project-agents", "config.json")
    await mkdir(path.dirname(configPath), { recursive: true })
    await writeFile(configPath, JSON.stringify({
      name: "project-agents",
      leadAgentId: "lead",
      members: [
        { kind: "category", name: "lead", category: "deep", prompt: "Lead the named project agent team." },
        { kind: "subagent_type", name: "worker", subagent_type: "project-worker" },
      ],
    }))

    // when
    const spec = await loadTeamSpec(
      "project-agents",
      TeamModeConfigSchema.parse({ base_dir: baseDir }),
      projectRoot,
      { allowUnknownSubagentTypes: true },
    )

    // then
    expect(spec.members[1]).toMatchObject({
      kind: "subagent_type",
      name: "worker",
      subagent_type: "project-worker",
    })
  })

  test("team_create explicitly defers named project-agent validation to runtime", async () => {
    // given
    const tool = createTeamCreateTool(
      config,
      mockClient,
      backgroundManager,
      undefined,
      undefined,
      {
        createTeamRun: createTeamRunMock,
        loadTeamSpec: loadTeamSpecMock,
        listActiveTeams: listActiveTeamsMock,
        loadRuntimeState: loadRuntimeStateMock,
      },
    )
    const toolContext = createToolContext("lead-session")

    // when
    await tool.execute({ teamName: "alpha-team" }, toolContext)

    // then
    expect(loadTeamSpecMock).toHaveBeenCalledWith(
      "alpha-team",
      config,
      "/project",
      {
        callerTeamLead: {
          displayName: "test-agent",
          isEligibleForTeamLead: false,
        },
        allowUnknownSubagentTypes: true,
      },
    )
  })

  test("team_list explicitly defers declared project-agent validation to runtime", async () => {
    // given
    const loadDeclaredSpec = mock(async () => createSpec())
    const tool = createTeamListTool(config, mockClient, {
      aggregateStatus: mock(async () => {
        throw new Error("aggregateStatus is not used by team_list")
      }),
      discoverTeamSpecs: mock(async () => [
        { name: "alpha-team", scope: "project" as const, path: "/project/.omo/teams/alpha-team/config.json" },
      ]),
      loadTeamSpec: loadDeclaredSpec,
      listActiveTeams: mock(async () => []),
    })

    // when
    await tool.execute({}, createToolContext("lead-session"))

    // then
    expect(loadDeclaredSpec).toHaveBeenCalledWith(
      "alpha-team",
      config,
      process.cwd(),
      { allowUnknownSubagentTypes: true },
    )
  })
})
