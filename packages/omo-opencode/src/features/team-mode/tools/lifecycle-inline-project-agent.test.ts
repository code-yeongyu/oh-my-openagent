/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { parseInlineTeamSpec } from "./lifecycle-inline-spec"

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
})
