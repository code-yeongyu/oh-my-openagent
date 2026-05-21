/// <reference path="../../../bun-test.d.ts" />

import { describe, expect, test } from "bun:test"
import { OhMyOpenCodeConfigSchema } from "./oh-my-opencode-config"

describe("OhMyOpenCodeConfigSchema disabled_skills", () => {
  test("accepts core, shared, runtime security, and non-coding writing builtin skills", () => {
    // given
    const config = {
      disabled_skills: [
        "review-work",
        "remove-ai-slops",
        "init-deep",
        "security-research",
        "security-review",
        "locale-aware-writing",
        "law-policy-writing",
      ],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_skills).toEqual([
        "review-work",
        "remove-ai-slops",
        "init-deep",
        "security-research",
        "security-review",
        "locale-aware-writing",
        "law-policy-writing",
      ])
    }
  })
})
