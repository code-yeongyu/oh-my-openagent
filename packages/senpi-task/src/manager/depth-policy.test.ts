import { describe, expect, test } from "bun:test"

import { decideDepthPolicy } from "./depth-policy"

describe("decideDepthPolicy", () => {
  test("#given a top-level child within max depth #when decided #then it is allowed", () => {
    // given
    const input = { childDepth: 1, maxDepth: 1 }

    // when
    const decision = decideDepthPolicy(input)

    // then
    expect(decision.allowed).toBe(true)
  })

  test("#given a child beyond max depth with no allowance #when decided #then it is denied", () => {
    // given
    const input = { childDepth: 2, maxDepth: 1 }

    // when
    const decision = decideDepthPolicy(input)

    // then
    expect(decision.allowed).toBe(false)
    if (decision.allowed) throw new Error("expected denial")
    expect(decision.reason).toContain("2")
    expect(decision.reason).toContain("1")
  })

  test("#given a deeper child whose type is in allowed_subagents #when decided #then it is allowed", () => {
    // given
    const input = {
      childDepth: 3,
      maxDepth: 1,
      targetAgentType: "explorer",
      allowedSubagents: ["explorer"] as const,
    }

    // when
    const decision = decideDepthPolicy(input)

    // then
    expect(decision.allowed).toBe(true)
    if (!decision.allowed) throw new Error("expected allowance")
    expect(decision.reason).toBe("allowed-subagent")
  })

  test("#given a deeper child whose type is NOT in allowed_subagents #when decided #then it is denied", () => {
    // given
    const input = {
      childDepth: 2,
      maxDepth: 1,
      targetAgentType: "writer",
      allowedSubagents: ["explorer"] as const,
    }

    // when
    const decision = decideDepthPolicy(input)

    // then
    expect(decision.allowed).toBe(false)
  })
})
