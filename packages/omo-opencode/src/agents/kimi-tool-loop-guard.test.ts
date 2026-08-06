/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { KIMI_TOOL_LOOP_GUARD } from "./kimi-tool-loop-guard"
import { buildKimiK26SisyphusPrompt } from "./sisyphus/kimi-k2-6"
import { buildKimiK26SisyphusJuniorPrompt } from "./sisyphus-junior/kimi-k2-6"

// Kimi prompt builders embed the shared KIMI_TOOL_LOOP_GUARD artifact verbatim
// (sisyphus/kimi-k2-6.ts, sisyphus-junior/kimi-k2-6.ts). Assert the real
// artifact is present, not its wording.
describe("Kimi tool-call loop guardrails", () => {
  test("#given Kimi Sisyphus prompt #when built #then the shared tool-loop guard artifact is embedded", () => {
    const prompt = buildKimiK26SisyphusPrompt("opencode-go/kimi-k2.6", [])

    expect(prompt).toContain(KIMI_TOOL_LOOP_GUARD)
  })

  test("#given Kimi Sisyphus-Junior prompt #when built #then the shared tool-loop guard artifact is embedded", () => {
    const prompt = buildKimiK26SisyphusJuniorPrompt(false)

    expect(prompt).toContain(KIMI_TOOL_LOOP_GUARD)
  })
})
