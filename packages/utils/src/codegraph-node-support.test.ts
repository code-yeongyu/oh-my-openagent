import { describe, expect, it } from "bun:test"

import {
  CODEGRAPH_BLOCKED_NODE_MAJOR,
  CODEGRAPH_MIN_NODE_MAJOR,
  CODEGRAPH_UNSAFE_NODE_ENV,
  buildCodegraphNodeSkipHint,
  evaluateCodegraphNodeSupport,
} from "./codegraph/node-support"

describe("evaluateCodegraphNodeSupport", () => {
  it("#given a supported Node major #when evaluated #then it is supported with no reason", () => {
    // given
    const nodeVersion = "22.14.0"

    // when
    const support = evaluateCodegraphNodeSupport({ env: {}, nodeVersion })

    // then
    expect(support.supported).toBe(true)
    expect(support.major).toBe(22)
    expect(support.reason).toBeUndefined()
  })

  it("#given a Node major at or above the blocked floor #when evaluated #then it is unsupported as too-new", () => {
    // given
    const nodeVersion = "v26.3.0"

    // when
    const support = evaluateCodegraphNodeSupport({ env: {}, nodeVersion })

    // then
    expect(support.supported).toBe(false)
    expect(support.major).toBe(26)
    expect(support.reason).toBe("too-new")
  })

  it("#given a Node major below the minimum #when evaluated #then it is unsupported as too-old", () => {
    // given
    const nodeVersion = "18.20.4"

    // when
    const support = evaluateCodegraphNodeSupport({ env: {}, nodeVersion })

    // then
    expect(support.supported).toBe(false)
    expect(support.major).toBe(18)
    expect(support.reason).toBe("too-old")
  })

  it("#given an unsupported Node but the unsafe override is set #when evaluated #then it is forced supported", () => {
    // given
    const nodeVersion = "26.3.0"

    // when
    const support = evaluateCodegraphNodeSupport({
      env: { [CODEGRAPH_UNSAFE_NODE_ENV]: "1" },
      nodeVersion,
    })

    // then
    expect(support.supported).toBe(true)
    expect(support.override).toBe(true)
    expect(support.reason).toBe("too-new")
  })

  it("#given an unparseable Node version #when evaluated #then it is treated as too-old and skipped", () => {
    // given
    const nodeVersion = "not-a-version"

    // when
    const support = evaluateCodegraphNodeSupport({ env: {}, nodeVersion })

    // then
    expect(support.supported).toBe(false)
    expect(support.reason).toBe("too-old")
  })
})

describe("buildCodegraphNodeSkipHint", () => {
  it("#given a too-new evaluation #when building the hint #then it is a single line naming the override and a safe range", () => {
    // given
    const support = evaluateCodegraphNodeSupport({ env: {}, nodeVersion: "26.3.0" })

    // when
    const hint = buildCodegraphNodeSkipHint(support)

    // then
    expect(hint.endsWith("\n")).toBe(true)
    expect(hint.trimEnd().includes("\n")).toBe(false)
    expect(hint).toContain("CodeGraph MCP skipped")
    expect(hint).toContain(CODEGRAPH_UNSAFE_NODE_ENV)
    expect(hint).toContain(String(CODEGRAPH_MIN_NODE_MAJOR))
    expect(hint).toContain(String(CODEGRAPH_BLOCKED_NODE_MAJOR - 1))
  })

  it("#given a too-old evaluation #when building the hint #then it names the minimum supported major", () => {
    // given
    const support = evaluateCodegraphNodeSupport({ env: {}, nodeVersion: "18.0.0" })

    // when
    const hint = buildCodegraphNodeSkipHint(support)

    // then
    expect(hint).toContain("too old")
    expect(hint).toContain(String(CODEGRAPH_MIN_NODE_MAJOR))
  })
})
