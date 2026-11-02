import { describe, expect, test } from "bun:test"

import { contrastRatio, readRootTokens, resolveColor } from "./design-tokens"

const INKS = ["--ink-0", "--ink-1", "--ink-2", "--ink-3"] as const

describe("form control boundary token", () => {
  test.each(INKS)(
    "#given the --input token that draws form control borders #when drawn on %s #then it meets the 3:1 non-text contrast of WCAG 1.4.11",
    (ink) => {
      const tokens = readRootTokens()

      const ratio = contrastRatio(resolveColor(tokens, "--input"), resolveColor(tokens, ink))

      expect(ratio).toBeGreaterThanOrEqual(3)
    },
  )
})
