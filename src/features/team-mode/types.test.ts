import { describe, expect, test } from "bun:test"
import {
  AGENT_ELIGIBILITY_REGISTRY,
  CategoryMemberSchema,
  MemberSchema,
  SubagentMemberSchema,
} from "./types"

describe("team-mode types", () => {
  test("member category branch parses and narrows", () => {
    // given
    const member = { kind: "category", name: "m1", category: "deep", prompt: "impl X" }

    // when
    const result = MemberSchema.safeParse(member)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toMatchObject(member)
      expect(result.data).toMatchObject({ kind: "category", category: "deep" })
    }
  })

  test("both kinds rejected", () => {
    // given
    const member = {
      kind: "category",
      name: "m1",
      category: "deep",
      subagent_type: "sisyphus",
      prompt: "impl X",
    }

    // when
    const result = MemberSchema.safeParse(member)

    // then
    expect(result.success).toBe(false)
  })

  test("category requires prompt", () => {
    // given
    const member = { kind: "category", name: "m1", category: "deep" }

    // when
    const result = CategoryMemberSchema.safeParse(member)

    // then
    expect(result.success).toBe(false)
  })

  test("eligibility registry shape", () => {
    // given
    const entries = Object.entries(AGENT_ELIGIBILITY_REGISTRY)

    // when
    const verdictCounts = entries.reduce(
      (counts, [, value]) => {
        counts[value.verdict] += 1
        return counts
      },
      { eligible: 0, conditional: 0, "hard-reject": 0 },
    )

    // then
    expect(entries).toHaveLength(11)
    expect(verdictCounts).toEqual({ eligible: 3, conditional: 1, "hard-reject": 7 })
    expect(AGENT_ELIGIBILITY_REGISTRY.hephaestus.rejectionMessage).toBe(
      "Agent 'hephaestus' lacks teammate permission. Either apply D-36 (add teammate: \"allow\" in tool-config-handler.ts) or use subagent_type: \"sisyphus\" instead.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY.oracle.rejectionMessage).toBe(
      "Agent 'oracle' is read-only (cannot write files). Team members must write to mailbox inbox files. Use delegate-task with subagent_type: 'oracle' for read-only analysis instead.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY.librarian.rejectionMessage).toBe(
      "Agent 'librarian' is read-only (write/edit denied). Cannot write to mailbox as team member. Use delegate-task for research queries instead.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY.explore.rejectionMessage).toBe(
      "Agent 'explore' is read-only (write/edit denied). Cannot write to mailbox as team member. Use delegate-task for codebase exploration instead.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY["multimodal-looker"].rejectionMessage).toBe(
      "Agent 'multimodal-looker' has read-only tool access (only 'read' allowed). Cannot write to mailbox as team member.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY.metis.rejectionMessage).toBe(
      "Agent 'metis' is read-only (pre-planning consultant). Cannot write to mailbox as team member. Use delegate-task for pre-planning analysis instead.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY.momus.rejectionMessage).toBe(
      "Agent 'momus' is read-only (plan reviewer). Cannot write to mailbox as team member. Use delegate-task for plan review instead.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY.prometheus.rejectionMessage).toBe(
      "Agent 'prometheus' is plan-mode-only; can only write to .sisyphus/*.md (enforced by prometheusMdOnly hook). Cannot write to team mailbox. Use category: 'plan' instead.",
    )
    expect(CategoryMemberSchema).toBeDefined()
    expect(SubagentMemberSchema).toBeDefined()
  })
})
