/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { createFallbackArchitectComponent } from "./index"
import { friendlyModelName, renderFallbackArchitectNotice } from "./notice"
import { Theme } from "../../senpi-test-runtime"

const FABLE = { provider: "anthropic", id: "claude-fable-5" }
const OPUS = { provider: "anthropic", id: "claude-opus-5" }
const KIMI = { provider: "apitopia", id: "kimi-k3-unlocked" }

// Wire contract asserted as a literal on purpose: this is the customType the TUI renderer and the
// desktop app will key on, so a silent rename must fail here.
const NOTICE_TYPE = "omo-fallback-architect:notice"

async function setup(): Promise<FakeExtensionAPI> {
  const pi = new FakeExtensionAPI()
  const logger: ComponentLogger = { info() {}, warn() {}, error() {} }
  const ctx: ComponentContext = { logger, config: { getFlag: (name) => pi.getFlag(name) } }
  const component = createFallbackArchitectComponent({ hasArchitectCategory: () => true })
  await component.register(pi, ctx)
  return pi
}

async function armRefusalFallback(pi: FakeExtensionAPI): Promise<void> {
  await pi.dispatch(
    "message_end",
    { type: "message_end", message: { role: "assistant", stopReason: "error", stopDetails: { type: "refusal" } } },
    { cwd: "/tmp/project" },
  )
  await pi.dispatch(
    "model_select",
    { type: "model_select", model: OPUS, previousModel: FABLE, source: "fallback" },
    { cwd: "/tmp/project" },
  )
}

function notices(pi: FakeExtensionAPI): Record<string, unknown>[] {
  return pi.messages.map((call) => call.message).filter((m) => m["customType"] === NOTICE_TYPE)
}

const NOTICE_THEME = new Theme({
  accent: "#000000", bashMode: "#000000", border: "#000000", borderAccent: "#000000", borderMuted: "#000000",
  customMessageLabel: "#000000", customMessageText: "#000000", dim: "#000000", error: "#000000", mdCode: "#000000",
  mdCodeBlock: "#000000", mdCodeBlockBorder: "#000000", mdHeading: "#000000", mdHr: "#000000", mdLink: "#000000",
  mdLinkUrl: "#000000", mdListBullet: "#000000", mdQuote: "#000000", mdQuoteBorder: "#000000", muted: "#000000",
  success: "#000000", syntaxComment: "#000000", syntaxFunction: "#000000", syntaxKeyword: "#000000", syntaxNumber: "#000000",
  syntaxOperator: "#000000", syntaxPunctuation: "#000000", syntaxString: "#000000", syntaxType: "#000000", syntaxVariable: "#000000",
  text: "#000000", thinkingHigh: "#000000", thinkingLow: "#000000", thinkingMax: "#000000", thinkingMedium: "#000000",
  thinkingMinimal: "#000000", thinkingOff: "#000000", thinkingText: "#000000", thinkingXhigh: "#000000", toolDiffAdded: "#000000",
  toolDiffContext: "#000000", toolDiffRemoved: "#000000", toolOutput: "#000000", toolTitle: "#000000", userMessageText: "#000000",
  warning: "#000000",
}, {
  customMessageBg: "#000000", selectedBg: "#000000", toolErrorBg: "#000000", toolPendingBg: "#000000", toolSuccessBg: "#000000",
  userMessageBg: "#000000",
}, "truecolor")

describe("fallback-architect notice", () => {
  describe("#given a refusal driven fallback off fable 5", () => {
    describe("#when the directive arms", () => {
      it("#then exactly one visible upgrade notice carries structured details", async () => {
        const pi = await setup()
        await armRefusalFallback(pi)

        const emitted = notices(pi)
        expect(emitted).toHaveLength(1)
        expect(emitted[0]?.["display"]).toBe(true)
        expect(emitted[0]?.["details"]).toEqual({
          from: "anthropic/claude-fable-5",
          to: "anthropic/claude-opus-5",
        })
        expect(String(emitted[0]?.["content"])).toContain('task(category: "architect")')
      })

      it("#then a TUI renderer is registered for the notice type", async () => {
        const pi = await setup()
        expect(pi.messageRenderers.some((r) => r.customType === NOTICE_TYPE)).toBe(true)
      })
    })

    describe("#when the chain falls back a second time from the weaker model", () => {
      it("#then no second notice is emitted", async () => {
        const pi = await setup()
        await armRefusalFallback(pi)
        await pi.dispatch(
          "message_end",
          { type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "Request timed out." } },
          { cwd: "/tmp/project" },
        )
        await pi.dispatch(
          "model_select",
          { type: "model_select", model: KIMI, previousModel: OPUS, source: "fallback" },
          { cwd: "/tmp/project" },
        )

        expect(notices(pi)).toHaveLength(1)
      })
    })
  })

  describe("#given structured fallback details", () => {
    it("#when rendered #then the notice uses the custom-message background block", () => {
      const component = renderFallbackArchitectNotice(
        { role: "custom", customType: NOTICE_TYPE, content: "", display: true, timestamp: 0, details: { from: FABLE.id, to: KIMI.id } },
        { expanded: false, outputPad: 0 },
        NOTICE_THEME,
      )
      const lines = component?.render(100) ?? []
      expect(lines).toHaveLength(5)
      expect(lines.every((line) => line.includes("\u001b[48;2;0;0;0m"))).toBe(true)
    })
  })

  describe("#given known and unknown model selectors", () => {
    describe("#when friendly names are derived", () => {
      it("#then known models map to display names and unknown ones keep their id", () => {
        expect(friendlyModelName("apitopia/kimi-k3-unlocked")).toBe("Kimi K3 (max)")
        expect(friendlyModelName("anthropic/claude-fable-5")).toBe("Fable 5")
        expect(friendlyModelName("omo-mock/mock-weak")).toBe("mock-weak")
      })
    })
  })
})
