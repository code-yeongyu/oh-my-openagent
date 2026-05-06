/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"

import type { ToolContext } from "@opencode-ai/plugin/tool"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import type { RuntimeState, TeamSpec } from "../types"

const runtimes = new Map<string, RuntimeState>()
let nextTeamRunNumber = 1

const lifecycleSpecifier = import.meta.resolve("./lifecycle")
const teamRuntimeCreateSpecifier = import.meta.resolve("../team-runtime/create")

function clone<TValue>(value: TValue): TValue {
  return structuredClone(value)
}

function createToolContext(sessionID: string, agent = "test-agent"): ToolContext {
  return {
    sessionID,
    messageID: randomUUID(),
    agent,
    directory: "/project",
    worktree: "/project",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => undefined,
  }
}

function createRuntimeState(spec: TeamSpec, leadSessionId: string, teamRunId: string): RuntimeState {
  return {
    version: 1,
    teamRunId,
    teamName: spec.name,
    specSource: "project",
    createdAt: 1,
    status: "active",
    leadSessionId,
    shutdownRequests: [],
    bounds: { maxMembers: 8, maxParallelMembers: 4, maxMessagesPerRun: 10000, maxWallClockMinutes: 120, maxMemberTurns: 500 },
    members: spec.members.map((member) => ({
      name: member.name,
      sessionId: member.name === spec.leadAgentId ? undefined : `${member.name}-session`,
      tmuxPaneId: undefined,
      agentType: member.name === spec.leadAgentId ? "leader" : "general-purpose",
      status: "running",
      color: member.color,
      worktreePath: member.worktreePath,
      lastInjectedTurnMarker: `turn:${member.name}`,
      pendingInjectedMessageIds: [`msg:${member.name}`],
    })),
  }
}

const createTeamRunMock = mock(async (spec: TeamSpec, leadSessionId: string) => {
  const teamRunId = `team-run-${nextTeamRunNumber++}`
  const runtimeState = createRuntimeState(spec, leadSessionId, teamRunId)
  runtimes.set(teamRunId, runtimeState)
  return clone(runtimeState)
})

function registerModuleMocks(): void {
  mock.module(teamRuntimeCreateSpecifier, () => ({ createTeamRun: createTeamRunMock }))
}

async function loadCreateTeamCreateTool(): Promise<typeof import("./lifecycle").createTeamCreateTool> {
  const module = await import(`${lifecycleSpecifier}?test=${randomUUID()}`)
  return module.createTeamCreateTool
}

function createConfig() {
  return TeamModeConfigSchema.parse({
    enabled: true,
    base_dir: path.join(tmpdir(), `team-mode-inline-spec-${randomUUID()}`),
  })
}

describe("createTeamCreateTool inline_spec normalization", () => {
  afterEach(() => {
    mock.restore()
  })

  beforeEach(() => {
    mock.restore()
    registerModuleMocks()
    runtimes.clear()
    nextTeamRunNumber = 1
    createTeamRunMock.mockClear()
  })

  test("accepts inline_spec objects and auto-assigns missing member names", async () => {
    // given
    const createTeamCreateTool = await loadCreateTeamCreateTool()
    const config = createConfig()
    const teamCreateTool = createTeamCreateTool(config, {} as never)
    const inlineSpec = {
      name: "alpha-team",
      lead: { kind: "subagent_type", subagent_type: "sisyphus" },
      members: [
        { kind: "category", category: "quick", prompt: "Quick scout the workspace for entrypoints." },
        { kind: "subagent_type", subagent_type: "atlas" },
      ],
    }

    // when
    const result = JSON.parse(await teamCreateTool.execute({ inline_spec: inlineSpec }, createToolContext("lead-session")))
    const firstCall = createTeamRunMock.mock.calls[0]

    // then
    expect(firstCall?.[0]).toMatchObject({
      leadAgentId: "lead",
      members: [
        { name: "lead", kind: "subagent_type", subagent_type: "sisyphus" },
        { name: "quick-1", kind: "category", category: "quick" },
        { name: "atlas-1", kind: "subagent_type", subagent_type: "atlas" },
      ],
    })
    expect(firstCall?.[1]).toBe("lead-session")
    expect(result.runtimeState.members.map((member: { name: string }) => member.name)).toEqual(["lead", "quick-1", "atlas-1"])
  })

  test("accepts stringified inline_spec values from tool calling", async () => {
    // given
    const createTeamCreateTool = await loadCreateTeamCreateTool()
    const config = createConfig()
    const teamCreateTool = createTeamCreateTool(config, {} as never)
    const inlineSpec = JSON.stringify({
      name: "ccapi-explorers-v2",
      lead: { kind: "subagent_type", subagent_type: "sisyphus" },
      members: [
        { kind: "category", category: "quick", prompt: "Quick scout: survey ccapi workspace structure." },
        { kind: "category", category: "deep", prompt: "Deep dive ccapi-cf." },
        { kind: "category", category: "deep", prompt: "Deep dive ccapi-cf-proxy." },
      ],
    })

    // when
    const result = JSON.parse(await teamCreateTool.execute({ inline_spec: inlineSpec }, createToolContext("lead-session")))

    // then
    expect(result.runtimeState.members.map((member: { name: string }) => member.name)).toEqual(["lead", "quick-1", "deep-1", "deep-2"])
    expect(result.runtimeState.teamName).toBe("ccapi-explorers-v2")
  })

  test("accepts category members written with natural inline prompt fields", async () => {
    // given
    const createTeamCreateTool = await loadCreateTeamCreateTool()
    const config = createConfig()
    const teamCreateTool = createTeamCreateTool(config, {} as never)
    const inlineSpec = {
      name: "project-analysis-team",
      description: "Analyze the codebase from structure, core logic, and quality angles.",
      members: [
        {
          name: "structure-analyst",
          category: "quick",
          loadSkills: [],
          systemPrompt: "Focus on directory layouts, module boundaries, and architectural organization.",
        },
        {
          name: "core-logic-analyst",
          category: "quick",
          loadSkills: [],
          systemPrompt: "Focus on initialization flows, plugin architecture, hooks, tools, and MCP integration.",
        },
        {
          name: "quality-analyst",
          category: "quick",
          loadSkills: [],
          systemPrompt: "Focus on tests, CI/CD, build scripts, conventions, and anti-pattern enforcement.",
        },
      ],
    }

    // when
    await teamCreateTool.execute({ inline_spec: inlineSpec }, createToolContext("lead-session", "Sisyphus"))
    const firstCall = createTeamRunMock.mock.calls[0]

    // then
    expect(firstCall?.[0]).toMatchObject({
      leadAgentId: "lead",
      members: [
        { name: "lead", kind: "subagent_type" },
        { name: "structure-analyst", kind: "category", category: "quick", prompt: "Focus on directory layouts, module boundaries, and architectural organization." },
        { name: "core-logic-analyst", kind: "category", category: "quick", prompt: "Focus on initialization flows, plugin architecture, hooks, tools, and MCP integration." },
        { name: "quality-analyst", kind: "category", category: "quick", prompt: "Focus on tests, CI/CD, build scripts, conventions, and anti-pattern enforcement." },
      ],
    })
  })

  test("explains how to call team_create when arguments are empty", async () => {
    // given
    const createTeamCreateTool = await loadCreateTeamCreateTool()
    const config = createConfig()
    const teamCreateTool = createTeamCreateTool(config, {} as never)

    // when
    const result = teamCreateTool.execute({}, createToolContext("lead-session", "Sisyphus"))

    // then
    await expect(result).rejects.toThrow("team_create requires exactly one of teamName or inline_spec")
    await expect(result).rejects.toThrow("team_create({ inline_spec: { name:")
  })

  test("explains how to shape inline_spec when members are missing", async () => {
    // given
    const createTeamCreateTool = await loadCreateTeamCreateTool()
    const config = createConfig()
    const teamCreateTool = createTeamCreateTool(config, {} as never)

    // when
    const result = teamCreateTool.execute({ inline_spec: { name: "project-analysis-team" } }, createToolContext("lead-session", "Sisyphus"))

    // then
    await expect(result).rejects.toThrow("Invalid inline_spec for team_create")
    await expect(result).rejects.toThrow("members array")
  })

  test("accepts natural team and member names in inline_spec", async () => {
    // given
    const createTeamCreateTool = await loadCreateTeamCreateTool()
    const config = createConfig()
    const teamCreateTool = createTeamCreateTool(config, {} as never)
    const inlineSpec = {
      name: "Project Analysis Team",
      members: [
        { name: "Agent 1: Structure Analyst", category: "quick", prompt: "Analyze project structure and report concrete files." },
        { name: "Agent 2: Core Logic Analyst", category: "quick", prompt: "Analyze initialization flow and report concrete functions." },
        { name: "Agent 3: Quality/Process Analyst", category: "quick", prompt: "Analyze tests, builds, CI, and conventions." },
      ],
    }

    // when
    await teamCreateTool.execute({ inline_spec: inlineSpec }, createToolContext("lead-session", "Sisyphus"))
    const firstCall = createTeamRunMock.mock.calls[0]

    // then
    expect(firstCall?.[0]).toMatchObject({
      name: "project-analysis-team",
      members: [
        { name: "lead", kind: "subagent_type" },
        { name: "agent-1-structure-analyst", kind: "category", category: "quick" },
        { name: "agent-2-core-logic-analyst", kind: "category", category: "quick" },
        { name: "agent-3-quality-process-analyst", kind: "category", category: "quick" },
      ],
    })
  })

  test("accepts role and capabilities style members with the configured fallback category", async () => {
    // given
    const createTeamCreateTool = await loadCreateTeamCreateTool()
    const config = createConfig()
    const teamCreateTool = createTeamCreateTool(config, {} as never, undefined as never, undefined, {
      userCategories: {
        analysis: {},
      },
    })
    const inlineSpec = {
      name: "Project Analysis Team",
      members: [
        {
          name: "Agent 1: Structure Analyst",
          kind: "agent",
          role: "Structure Analyst",
          capabilities: ["directory layouts", "module boundaries"],
        },
        {
          name: "Agent 2: Core Logic Analyst",
          kind: "quick",
          role: "Core Logic Analyst",
          description: "Analyze initialization flow and plugin architecture.",
        },
        {
          name: "Agent 3: Quality/Process Analyst",
          role: "Quality/Process Analyst",
          responsibilities: ["tests", "builds", "CI/CD"],
        },
      ],
    }

    // when
    await teamCreateTool.execute({ inline_spec: inlineSpec }, createToolContext("lead-session", "Sisyphus"))
    const firstCall = createTeamRunMock.mock.calls[0]

    // then
    expect(firstCall?.[0]).toMatchObject({
      name: "project-analysis-team",
      members: [
        { name: "lead", kind: "subagent_type" },
        { name: "agent-1-structure-analyst", kind: "category", category: "analysis", prompt: "Role: Structure Analyst\ndirectory layouts, module boundaries" },
        { name: "agent-2-core-logic-analyst", kind: "category", category: "quick", prompt: "Role: Core Logic Analyst\nAnalyze initialization flow and plugin architecture." },
        { name: "agent-3-quality-process-analyst", kind: "category", category: "analysis", prompt: "Role: Quality/Process Analyst\ntests, builds, CI/CD" },
      ],
    })
  })
})
