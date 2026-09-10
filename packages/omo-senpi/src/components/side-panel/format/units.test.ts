import { describe, expect, test } from "bun:test"

import { compactBytes, compactCost, compactTokens, duration } from "./units"

describe("compactTokens", () => {
  test("#given values across magnitudes #when formatted #then the unit follows the size", () => {
    // given
    const values = [0, 999, 1_000, 1_234, 12_345, 999_999, 1_000_000, 1_250_000]

    // when
    const rendered = values.map(compactTokens)

    // then
    expect(rendered).toEqual(["0", "999", "1K", "1.2K", "12.3K", "1M", "1M", "1.3M"])
  })

  test("#given a negative or broken number #when formatted #then it reads as zero", () => {
    // given
    const values = [-5, Number.NaN, Number.POSITIVE_INFINITY]

    // when
    const rendered = values.map(compactTokens)

    // then
    expect(rendered).toEqual(["0", "0", "0"])
  })
})

describe("compactBytes", () => {
  test("#given byte counts #when formatted #then binary units are used", () => {
    // given
    const values = [0, 512, 1_024, 2_048, 1_048_576, 5_242_880]

    // when
    const rendered = values.map(compactBytes)

    // then
    expect(rendered).toEqual(["0B", "512B", "1KB", "2KB", "1MB", "5MB"])
  })
})

describe("duration", () => {
  test("#given elapsed spans #when formatted #then each magnitude keeps a fixed shape", () => {
    // given
    const values = [0, 12_000, 59_999, 60_000, 270_000, 3_600_000, 7_500_000]

    // when
    const rendered = values.map(duration)

    // then
    expect(rendered).toEqual(["0s", "12s", "59s", "1m00", "4m30", "1h00", "2h05"])
  })
})

describe("compactCost", () => {
  test("#given amounts #when formatted #then precision shrinks as the number grows", () => {
    // given
    const values = [0, 0.004, 1.239, 9.99, 12.34, 1_234.5]

    // when
    const rendered = values.map(compactCost)

    // then
    expect(rendered).toEqual(["$0", "$0.00", "$1.24", "$9.99", "$12.3", "$1235"])
  })
})
