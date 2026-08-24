/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { parseInlineTeamSpec } from "./lifecycle-inline-spec"

type MemberWithModel = { name: string; model?: string; reasoning_effort?: string }

function findMember(spec: { members: ReadonlyArray<unknown> }, name: string): MemberWithModel | undefined {
  return (spec.members as MemberWithModel[]).find((m) => m.name === name)
}

describe("team_create inline member model override", () => {
  test("#given an inline member object with model + reasoning_effort #then they survive the parse chain", () => {
    // when
    const spec = parseInlineTeamSpec({
      name: "probe-team",
      leadAgentId: "lead",
      members: [
        { kind: "subagent_type", name: "lead", subagent_type: "sisyphus" },
        { kind: "subagent_type", name: "scout", subagent_type: "sisyphus", model: "xai/grok-composer-2.5-fast", reasoning_effort: "xhigh" },
      ],
    })
    // then
    const scout = findMember(spec, "scout")
    expect(scout?.model).toBe("xai/grok-composer-2.5-fast")
    expect(scout?.reasoning_effort).toBe("xhigh")
  })

  test("#given a category member with model variant string #then it survives", () => {
    // when
    const spec = parseInlineTeamSpec({
      name: "probe-team",
      leadAgentId: "lead",
      members: [
        { kind: "subagent_type", name: "lead", subagent_type: "sisyphus" },
        { kind: "category", name: "worker", category: "quick", prompt: "do the assigned work", model: "openai/gpt-5.5 xhigh" },
      ],
    })
    // then
    expect(findMember(spec, "worker")?.model).toBe("openai/gpt-5.5 xhigh")
  })

  test("#given a stringified inline_spec with member model #then it survives (JSON-string path)", () => {
    // when
    const spec = parseInlineTeamSpec(JSON.stringify({
      name: "probe-team",
      leadAgentId: "lead",
      members: [
        { kind: "subagent_type", name: "lead", subagent_type: "sisyphus" },
        { kind: "subagent_type", name: "scout", subagent_type: "sisyphus", model: "openai/gpt-5.4-fast" },
      ],
    }))
    // then
    expect(findMember(spec, "scout")?.model).toBe("openai/gpt-5.4-fast")
  })

  test("#given a member without model #then no model is set (configured default preserved)", () => {
    // when
    const spec = parseInlineTeamSpec({
      name: "probe-team",
      leadAgentId: "lead",
      members: [
        { kind: "subagent_type", name: "lead", subagent_type: "sisyphus" },
        { kind: "subagent_type", name: "scout", subagent_type: "sisyphus" },
      ],
    })
    // then
    expect(findMember(spec, "scout")?.model).toBeUndefined()
  })
})
