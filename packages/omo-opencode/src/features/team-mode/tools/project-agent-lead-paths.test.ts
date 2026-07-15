/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { resolveCallerTeamLead, shouldReuseCallerLeadSession } from "../resolve-caller-team-lead"
import { parseInlineTeamSpec } from "./lifecycle-inline-spec"

const PROJECT_AGENT_MEMBER = {
  kind: "subagent_type",
  name: "repository-reviewer",
  subagent_type: "repository-reviewer",
} as const

const BUILTIN_MEMBER = {
  kind: "subagent_type",
  name: "builtin-worker",
  subagent_type: "atlas",
} as const

describe("project agent lead normalization", () => {
  for (const [pathName, inlineSpec, options] of [
    ["explicit leadAgentId", {
      name: "explicit-project-lead",
      leadAgentId: "repository-reviewer",
      members: [PROJECT_AGENT_MEMBER, BUILTIN_MEMBER],
    }, undefined],
    ["explicit lead object", {
      name: "object-project-lead",
      lead: PROJECT_AGENT_MEMBER,
      members: [BUILTIN_MEMBER],
    }, undefined],
    ["member isLead flag", {
      name: "flag-project-lead",
      members: [{ ...PROJECT_AGENT_MEMBER, isLead: true }, BUILTIN_MEMBER],
    }, undefined],
    ["singleton normalization", {
      name: "singleton-project-lead",
      members: [PROJECT_AGENT_MEMBER],
    }, undefined],
    ["eight-member normalization", {
      name: "normalized-project-lead",
      members: [
        PROJECT_AGENT_MEMBER,
        ...Array.from({ length: 7 }, (_, index) => ({
          kind: "category" as const,
          name: `worker-${index + 1}`,
          category: "quick",
          prompt: `Complete independent task ${index + 1}.`,
        })),
      ],
    }, { callerTeamLead: { agentTypeId: "sisyphus", displayName: "Sisyphus", isEligibleForTeamLead: true } }],
  ] as const) {
    test(`keeps the project agent identifiable for member-only rejection after ${pathName}`, () => {
      // when
      const spec = parseInlineTeamSpec(inlineSpec, options)

      // then
      const lead = spec.members.find((member) => member.name === spec.leadAgentId)
      expect(lead).toMatchObject({ kind: "subagent_type", subagent_type: "repository-reviewer" })
    })
  }

  test("never treats a project agent caller as a reusable lead", () => {
    // given
    const caller = resolveCallerTeamLead("repository-reviewer")
    const spec = parseInlineTeamSpec({
      name: "builtin-lead",
      leadAgentId: "builtin-worker",
      members: [BUILTIN_MEMBER, PROJECT_AGENT_MEMBER],
    })

    // when
    const reusesCaller = shouldReuseCallerLeadSession(spec, caller.agentTypeId)

    // then
    expect(caller).toEqual({ displayName: "repository-reviewer", isEligibleForTeamLead: false })
    expect(reusesCaller).toBe(false)
  })
})
