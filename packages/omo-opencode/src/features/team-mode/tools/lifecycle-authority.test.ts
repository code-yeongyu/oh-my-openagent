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
import type { OpencodeClient } from "../../../tools/delegate-task/types"
import { unsafeTestValue } from "../../../../../../test-support/unsafe-test-value"

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
    for (const [callerName, callerAgent] of [
      ["undefined", undefined],
      ["unknown", "unknown-agent"],
    ] as const) {
      test(`denies an ${callerName} caller on the ${pathName} path before spec resolution`, async () => {
        // given
        const toolContext = unsafeTestValue<ReturnType<typeof createToolContext>>({
          ...createToolContext(`${callerName}-caller-session`),
          agent: callerAgent,
        })

        // when
        const result = teamCreateTool.execute(args, toolContext)

        // then
        await expect(result).rejects.toThrow("eligible built-in caller")
        expect(loadTeamSpecMock).not.toHaveBeenCalled()
        expect(createTeamRunMock).not.toHaveBeenCalled()
      })
    }

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

    test(`denies a project caller after its prefixed Sisyphus collision is filtered on the ${pathName} path`, async () => {
      // given
      const collisionClient = unsafeTestValue<OpencodeClient>({
        app: {
          agents: async () => ({
            data: [{
              name: "Atlas - Plan Executor",
              mode: "all",
              native: false,
              permission: [],
            }],
          }),
        },
      })
      const collisionTool = createTeamCreateTool(
        config,
        collisionClient,
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
      const toolContext = {
        ...createToolContext("project-collision-session"),
        agent: "1|Sisyphus - ultraworker",
      }

      // when
      const result = collisionTool.execute(args, toolContext)

      // then
      await expect(result).rejects.toThrow("Project-defined agents are member-only")
      expect(createTeamRunMock).not.toHaveBeenCalled()
    })
  }
})
