import { describe, expect, test } from "bun:test"
import { hasBunTestSummary } from "./assert-test-summary"

describe("bun test summary detection", () => {
  test("#given completed bun test output #when checking for a summary #then it is accepted", () => {
    // given
    const output = `bun test v1.3.12 (700fc117)

 28 pass
 0 fail
Ran 28 tests across 1 file. [64.00ms]
`

    // when
    const hasSummary = hasBunTestSummary(output)

    // then
    expect(hasSummary).toBe(true)
  })

  test("#given banner-only bun test output #when checking for a summary #then it is rejected", () => {
    // given
    const output = "bun test v1.3.12 (700fc117)\n"

    // when
    const hasSummary = hasBunTestSummary(output)

    // then
    expect(hasSummary).toBe(false)
  })

  test("#given zero-count summary output #when checking for a summary #then it is rejected", () => {
    // given
    const output = "Ran 0 tests across 0 files. [1.00ms]\n"

    // when
    const hasSummary = hasBunTestSummary(output)

    // then
    expect(hasSummary).toBe(false)
  })
})
