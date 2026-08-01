/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import {
  buildFallbackTipText,
  FALLBACK_ARCHITECT_TIP_TYPE,
  renderFallbackTip,
} from "./tip-message"
import { Theme } from "../../senpi-test-runtime"

const ANSI_ESCAPE_PATTERN = /\[/

const TEST_FG_COLORS = {
  accent: "#000000",
  bashMode: "#000000",
  border: "#000000",
  borderAccent: "#000000",
  borderMuted: "#000000",
  customMessageLabel: "#000000",
  customMessageText: "#000000",
  dim: "#000000",
  error: "#000000",
  mdCode: "#000000",
  mdCodeBlock: "#000000",
  mdCodeBlockBorder: "#000000",
  mdHeading: "#000000",
  mdHr: "#000000",
  mdLink: "#000000",
  mdLinkUrl: "#000000",
  mdListBullet: "#000000",
  mdQuote: "#000000",
  mdQuoteBorder: "#000000",
  muted: "#000000",
  success: "#000000",
  syntaxComment: "#000000",
  syntaxFunction: "#000000",
  syntaxKeyword: "#000000",
  syntaxNumber: "#000000",
  syntaxOperator: "#000000",
  syntaxPunctuation: "#000000",
  syntaxString: "#000000",
  syntaxType: "#000000",
  syntaxVariable: "#000000",
  text: "#000000",
  thinkingHigh: "#000000",
  thinkingLow: "#000000",
  thinkingMax: "#000000",
  thinkingMedium: "#000000",
  thinkingMinimal: "#000000",
  thinkingOff: "#000000",
  thinkingText: "#000000",
  thinkingXhigh: "#000000",
  toolDiffAdded: "#000000",
  toolDiffContext: "#000000",
  toolDiffRemoved: "#000000",
  toolOutput: "#000000",
  toolTitle: "#000000",
  userMessageText: "#000000",
  warning: "#000000",
} as const satisfies ConstructorParameters<typeof Theme>[0]
const TEST_BG_COLORS = {
  customMessageBg: "#000000",
  selectedBg: "#000000",
  toolErrorBg: "#000000",
  toolPendingBg: "#000000",
  toolSuccessBg: "#000000",
  userMessageBg: "#000000",
} as const satisfies ConstructorParameters<typeof Theme>[1]
const TEST_THEME = new Theme(TEST_FG_COLORS, TEST_BG_COLORS, "truecolor")

describe("fallback-architect tip message", () => {
  describe("#given the custom message type", () => {
    describe("#when a consumer reads it", () => {
      it("#then it is the wire value senpi persists", () => {
        expect(FALLBACK_ARCHITECT_TIP_TYPE).toBe("omo-fallback-architect:tip")
      })
    })
  })

  describe("#given a refusal fallback from fable 5 to a weaker model", () => {
    describe("#when the tip text is built", () => {
      const text = buildFallbackTipText({
        from: "anthropic/claude-fable-5",
        to: "anthropic/claude-opus-5",
      })
      const lines = text.split("\n")

      it("#then it names the actual fallback model", () => {
        expect(text).toContain("anthropic/claude-opus-5")
      })

      it("#then it says the refusal should not wear the user down because the essence is still reasoned through", () => {
        expect(text).toContain("should not wear you down")
        expect(text).toContain("reasons through its essence")
      })

      it("#then it points at the architect category for fable-5-grade depth", () => {
        expect(text).toContain("architect")
        expect(text).toContain("Fable-5-grade depth")
      })

      it("#then it ends with a pointer line containing give-me-tips", () => {
        expect(lines.at(-1)).toContain("give-me-tips")
      })
    })
  })

  describe("#given a persisted tip message", () => {
    describe("#when the renderer draws it", () => {
      const text = buildFallbackTipText({
        from: "anthropic/claude-fable-5",
        to: "anthropic/claude-opus-5",
      })
      const component = renderFallbackTip(
        { role: "custom", customType: FALLBACK_ARCHITECT_TIP_TYPE, content: text, display: true, timestamp: 0 },
        { expanded: false, outputPad: 0 },
        TEST_THEME,
      )
      const rendered = component?.render(2_000) ?? []

      it("#then the first line carries the Tip: label", () => {
        expect(rendered[0]).toContain("Tip:")
      })

      it("#then every line is dimmed through the theme", () => {
        for (const line of rendered) {
          expect(line).toMatch(ANSI_ESCAPE_PATTERN)
        }
      })

      it("#then the tip content survives rendering", () => {
        expect(rendered.join("\n")).toContain("anthropic/claude-opus-5")
        expect(rendered.join("\n")).toContain("give-me-tips")
      })
    })
  })
})
