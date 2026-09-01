/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { parseInlineTeamSpec } from "./lifecycle-inline-spec"
import { createTeamCreateTool } from "./lifecycle-create-tool"
import {
  backgroundManager,
  config,
  createTeamRunMock,
  createToolContext,
  listActiveTeamsMock,
  loadRuntimeStateMock,
  loadTeamSpecMock,
  mockClient,
  resetLifecycleTestState,
} from "./lifecycle-test-fixture"

describe("inline project agent validation", () => {
  test("allows an inline spec to carry an unknown project subagent type", () => {
    // given
    const rawSpec = {
      name: "inline-project-agents",
      leadAgentId: "lead",
      members: [
        { kind: "category", name: "lead", category: "deep", prompt: "Lead the inline project agent team." },
        { kind: "subagent_type", name: "worker", subagent_type: "project-worker" },
      ],
    }

    // when
    const spec = parseInlineTeamSpec(rawSpec)

    // then
    expect(spec.members[1]).toMatchObject({
      kind: "subagent_type",
      name: "worker",
      subagent_type: "project-worker",
    })
  })

  test("team_create rejects an inline spec whose explicit lead is an unknown project subagent type", async () => {
    // given: an inline spec that names a project (unknown) subagent as the team lead
    resetLifecycleTestState()
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
    const inlineSpec = {
      name: "inline-project-lead",
      leadAgentId: "lead",
      members: [
        { kind: "subagent_type", name: "lead", subagent_type: "project-worker" },
        { kind: "category", name: "worker", category: "quick", prompt: "Do the assigned work." },
      ],
    }

    // when
    const result = tool.execute({ inline_spec: inlineSpec }, createToolContext("lead-session"))

    // then: the explicit project/unknown lead must be rejected before any caller-lead reuse or member spawn
    await expect(result).rejects.toThrow("cannot be a team lead")
    expect(createTeamRunMock).not.toHaveBeenCalled()
  })

  test("team_create rejects inherited caller eligibility before explicit known-lead reuse", async () => {
    // given: constructor inherits a registry-shaped value through Object.prototype
    resetLifecycleTestState()
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
    const inlineSpec = {
      name: "inherited-caller-lead",
      leadAgentId: "lead",
      members: [
        { kind: "subagent_type", name: "lead", subagent_type: "sisyphus" },
        { kind: "category", name: "worker", category: "quick", prompt: "Do the assigned work." },
      ],
    }
    const toolContext = { ...createToolContext("lead-session"), agent: "constructor" }

    // when
    const result = tool.execute({ inline_spec: inlineSpec }, toolContext)

    // then
    await expect(result).rejects.toThrow("caller")
    expect(createTeamRunMock).not.toHaveBeenCalled()
  })
})
