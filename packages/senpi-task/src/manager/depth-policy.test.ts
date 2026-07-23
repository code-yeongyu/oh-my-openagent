import { describe, expect, test } from "bun:test"

import { decideDepthPolicy } from "./depth-policy"

describe("decideDepthPolicy", () => {
  test("#given a top-level child within max depth #when decided #then it is allowed", () => {
    // given
    const input = { childDepth: 1, maxDepth: 1, callerRole: "coordinator", lineage: "known" } as const

    // when
    const decision = decideDepthPolicy(input)

    // then
    expect(decision.allowed).toBe(true)
  })

  test("#given a child beyond max depth with no allowance #when decided #then it is denied", () => {
    // given
    const input = { childDepth: 2, maxDepth: 1, callerRole: "coordinator", lineage: "known" } as const

    // when
    const decision = decideDepthPolicy(input)

    // then
    expect(decision.allowed).toBe(false)
    if (decision.allowed) throw new Error("expected denial")
    expect(decision.reason).toBe("depth_exceeded")
  })

  test("#given a deeper child whose type is in allowed_subagents #when decided #then target narrowing cannot bypass depth", () => {
    // given
    const input = {
      childDepth: 3,
      maxDepth: 1,
      callerRole: "coordinator",
      lineage: "known",
      targetAgentType: "explorer",
      allowedSubagents: ["explorer"] as const,
    } as const

    // when
    const decision = decideDepthPolicy(input)

    // then
    expect(decision.allowed).toBe(false)
  })

  test("#given a deeper child whose type is NOT in allowed_subagents #when decided #then it is denied", () => {
    // given
    const input = {
      childDepth: 2,
      maxDepth: 1,
      callerRole: "coordinator",
      lineage: "known",
      targetAgentType: "writer",
      allowedSubagents: ["explorer"] as const,
    } as const

    // when
    const decision = decideDepthPolicy(input)

    // then
    expect(decision.allowed).toBe(false)
  })
})
