import { describe, expect, it } from "bun:test"
import { OhMyOpenCodeConfigSchema } from "./oh-my-opencode-config"

describe("OhMyOpenCodeConfigSchema team_mode", () => {
  it("accepts team_mode when provided", () => {
    // given
    const rawConfig = {
      team_mode: {
        enabled: true,
        max_parallel_members: 2,
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(rawConfig)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.team_mode).toMatchObject({
        enabled: true,
        max_parallel_members: 2,
      })
    }
  })

  it("allows team_mode omission", () => {
    // given
    const rawConfig = {}

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(rawConfig)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.team_mode).toBeUndefined()
    }
  })
})
