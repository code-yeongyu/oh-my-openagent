/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"

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
} from "./lifecycle-test-fixture"
import { createTeamCreateTool } from "./lifecycle"

const teamCreateTool = createTeamCreateTool(
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

describe("team_create caller authority", () => {
  beforeEach(() => {
    resetLifecycleTestState()
  })

  for (const [pathName, args] of [
    ["named", { teamName: "alpha-team" }],
    ["inline", { inline_spec: createSpec() }],
  ] as const) {
    test(`denies a project-agent caller on the ${pathName} path`, async () => {
      // given
      const toolContext = {
        ...createToolContext("project-agent-session"),
        agent: "repository-reviewer",
      }

      // when
      const result = teamCreateTool.execute(args, toolContext)

      // then
      await expect(result).rejects.toThrow()
      expect(createTeamRunMock).not.toHaveBeenCalled()
    })

    test(`denies a mismatched leadSessionId on the ${pathName} path`, async () => {
      // given
      const toolContext = createToolContext("caller-session")

      // when
      const result = teamCreateTool.execute({ ...args, leadSessionId: "different-session" }, toolContext)

      // then
      await expect(result).rejects.toThrow()
      expect(createTeamRunMock).not.toHaveBeenCalled()
    })
  }
})
