/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { Member, TeamSpec } from "../types"
import { validateSpec } from "./validator"

function createSpec(subagentType: string): TeamSpec {
  const members: Member[] = [
    {
      kind: "category",
      name: "lead",
      category: "deep",
      prompt: "Lead the project agent validation work.",
      backendType: "in-process",
      isActive: true,
    },
    {
      kind: "subagent_type",
      name: "project-worker",
      subagent_type: subagentType,
      backendType: "in-process",
      isActive: true,
    },
  ]

  return {
    version: 1,
    name: "project-agent-team",
    createdAt: 1,
    leadAgentId: "lead",
    members,
  }
}

describe("ValidateSpecOptions", () => {
  test("rejects unknown subagent types by default", () => {
    // given
    const spec = createSpec("project-worker")

    // when
    const act = () => validateSpec(spec)

    // then
    expect(act).toThrow("Unknown subagent_type 'project-worker'.")
  })

  test("allows unknown subagent types only when explicitly enabled", () => {
    // given
    const spec = createSpec("project-worker")

    // when
    const act = () => validateSpec(spec, { allowUnknownSubagentTypes: true })

    // then
    expect(act).not.toThrow()
  })

  test("keeps hard-reject agents rejected when unknown types are allowed", () => {
    // given
    const spec = createSpec("oracle")

    // when
    const act = () => validateSpec(spec, { allowUnknownSubagentTypes: true })

    // then
    expect(act).toThrow("Agent 'oracle' is read-only")
  })
})
