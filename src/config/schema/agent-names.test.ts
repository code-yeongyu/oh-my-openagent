/// <reference path="../../../bun-test.d.ts" />

import { describe, expect, test } from "bun:test"
import { OhMyOpenCodeConfigSchema } from "./oh-my-opencode-config"

describe("OhMyOpenCodeConfigSchema disabled_skills", () => {
  test("accepts review-work, remove-ai-slops, and init-deep", () => {
    // given
    const config = {
      disabled_skills: ["review-work", "remove-ai-slops", "init-deep"],
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
      ])
    }
  })
})
