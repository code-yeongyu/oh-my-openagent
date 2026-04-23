import { describe, expect, test } from "bun:test"
import {
  AGENT_ELIGIBILITY_REGISTRY,
  CategoryMemberSchema,
  MemberSchema,
  SubagentMemberSchema,
} from "./types"

describe("team-mode types", () => {
  test("member category branch parses and narrows", () => {
    //#given
    const member = { kind: "category", name: "m1", category: "deep", prompt: "impl X" }

    //#when
    const result = MemberSchema.safeParse(member)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toMatchObject(member)
      expect(result.data).toMatchObject({ kind: "category", category: "deep" })
    }
  })

  test("both kinds rejected", () => {
    //#given
    const member = {
      kind: "category",
      name: "m1",
      category: "deep",
      subagent_type: "morpheus",
      prompt: "impl X",
    }

    //#when
    const result = MemberSchema.safeParse(member)

    //#then
    expect(result.success).toBe(false)
  })

  test("category requires prompt", () => {
    //#given
    const member = { kind: "category", name: "m1", category: "deep" }

    //#when
    const result = CategoryMemberSchema.safeParse(member)

    //#then
    expect(result.success).toBe(false)
  })

  test("eligibility registry shape", () => {
    //#given
    const entries = Object.entries(AGENT_ELIGIBILITY_REGISTRY)

    //#when
    const verdictCounts = entries.reduce(
      (counts, [, value]) => {
        counts[value.verdict] += 1
        return counts
      },
      { eligible: 0, conditional: 0, "hard-reject": 0 },
    )

    //#then
    expect(entries).toHaveLength(12)
    expect(verdictCounts).toEqual({ eligible: 4, conditional: 0, "hard-reject": 8 })
    expect(AGENT_ELIGIBILITY_REGISTRY.morpheus.verdict).toBe("eligible")
    expect(AGENT_ELIGIBILITY_REGISTRY.keymaker.verdict).toBe("eligible")
    expect(AGENT_ELIGIBILITY_REGISTRY.architect.verdict).toBe("eligible")
    expect(AGENT_ELIGIBILITY_REGISTRY.cipher.verdict).toBe("eligible")
    expect(AGENT_ELIGIBILITY_REGISTRY.oracle.rejectionMessage).toBe(
      "Agent 'oracle' is read-only (strategic planner). Team members must write to mailbox inbox files. Use delegate-task with subagent_type: 'oracle' for read-only analysis instead.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY.merovingian.rejectionMessage).toBe(
      "Agent 'merovingian' is read-only (consultation/debugging). Cannot write to mailbox as team member. Use delegate-task for consultation queries instead.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY.operator.rejectionMessage).toBe(
      "Agent 'operator' is read-only (docs/GitHub search). Cannot write to mailbox as team member. Use delegate-task for documentation queries instead.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY.trinity.rejectionMessage).toBe(
      "Agent 'trinity' is read-only (codebase grep). Cannot write to mailbox as team member. Use delegate-task for codebase exploration instead.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY.seraph.rejectionMessage).toBe(
      "Agent 'seraph' is read-only (pre-planning analysis). Cannot write to mailbox as team member. Use delegate-task for pre-planning analysis instead.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY.smith.rejectionMessage).toBe(
      "Agent 'smith' is read-only (plan validator). Cannot write to mailbox as team member. Use delegate-task for plan validation instead.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY.niobe.rejectionMessage).toBe(
      "Agent 'niobe' is read-only (research specialist). Cannot write to mailbox as team member. Use delegate-task for research queries instead.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY.sentinel.rejectionMessage).toBe(
      "Agent 'sentinel' is read-only (security auditor). Cannot write to mailbox as team member. Use delegate-task for security analysis instead.",
    )
    expect(CategoryMemberSchema).toBeDefined()
    expect(SubagentMemberSchema).toBeDefined()
  })
})
