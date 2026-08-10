import { describe, expect, test } from "bun:test"

import { OmoMemorySettingsLayerSchema, OmoMemorySettingsSchema, type OmoMemorySettings } from "./memory"

describe("OmoMemorySettingsSchema defaults", () => {
  test("#given an empty memory block #when parsed #then the pinned defaults apply", () => {
    // given
    const input = {}

    // when
    const parsed = OmoMemorySettingsSchema.parse(input)

    // then
    expect(parsed).toEqual({
      enabled: true,
      agent: "auto",
      tool_exposure: "direct",
      reflection: {
        trigger: { step_count: 0, on_compaction: true },
        merge: "auto",
        category: "quick",
        timeout_minutes: 15,
        sandbox: "auto",
      },
      sync: { enabled: true },
      search: { enabled: true },
      compile_warn_tokens: 30000,
      agents: {},
    })
  })

  test("#given a fully specified memory block #when parsed #then every explicit value is preserved", () => {
    // given
    const input: OmoMemorySettings = {
      enabled: false,
      agent: "backend-lead",
      tool_exposure: "search",
      reflection: {
        trigger: { step_count: 25, on_compaction: false },
        merge: "integration",
        category: "deep",
        timeout_minutes: 30,
        sandbox: "required",
      },
      sync: { remote: "file:///tmp/memory-mirror.git", enabled: true },
      search: { enabled: false },
      compile_warn_tokens: 50000,
      agents: {
        "backend-lead": {
          enabled: true,
          reflection: { trigger: { step_count: 10 }, category: "quick" },
        },
      },
    }

    // when
    const parsed = OmoMemorySettingsSchema.parse(input)

    // then
    expect(parsed).toEqual(input)
  })

  test("#given a negative reflection step count #when parsed #then validation fails at the trigger path", () => {
    // given
    const input = { reflection: { trigger: { step_count: -1 } } }

    // when
    const result = OmoMemorySettingsSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
    if (result.success) throw new Error("Expected memory settings parsing to fail")
    expect(result.error.issues.map((issue) => issue.path.join(".")).join(",")).toContain("reflection.trigger.step_count")
  })

  test("#given a non-boolean compaction trigger #when parsed #then validation fails at the trigger path", () => {
    // given
    const input = { reflection: { trigger: { on_compaction: "yes" } } }

    // when
    const result = OmoMemorySettingsSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
    if (result.success) throw new Error("Expected memory settings parsing to fail")
    expect(result.error.issues.map((issue) => issue.path.join(".")).join(",")).toContain("reflection.trigger.on_compaction")
  })

  test("#given unknown keys inside the memory block #when parsed #then the strict schema rejects them", () => {
    // given
    const rootUnknown = { enabled: true, bogus: true }
    const nestedUnknown = { reflection: { bogus: true } }

    // when
    const rootResult = OmoMemorySettingsSchema.safeParse(rootUnknown)
    const nestedResult = OmoMemorySettingsSchema.safeParse(nestedUnknown)

    // then
    expect(rootResult.success).toBe(false)
    expect(nestedResult.success).toBe(false)
  })
})

describe("OmoMemorySettingsLayerSchema", () => {
  test("#given a partial layer block #when parsed #then it remains a default-free deep-partial", () => {
    // given
    const input = { reflection: { category: "deep" } }

    // when
    const parsed = OmoMemorySettingsLayerSchema.parse(input)

    // then
    expect(parsed).toEqual({ reflection: { category: "deep" } })
  })

  test("#given an unknown layer key #when parsed #then the strict layer schema rejects it", () => {
    // given
    const input = { bogus: 1 }

    // when
    const result = OmoMemorySettingsLayerSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
  })
})

describe("OmoMemorySettingsSchema agents overrides", () => {
  test("#given per-agent overrides #when parsed #then they stay default-free deep-partials", () => {
    // given
    const input = {
      agents: {
        "backend-lead": { enabled: false, reflection: { trigger: { step_count: 10 } } },
      },
    }

    // when
    const parsed = OmoMemorySettingsSchema.parse(input)

    // then
    expect(parsed.agents["backend-lead"]).toEqual({
      enabled: false,
      reflection: { trigger: { step_count: 10 } },
    })
  })

  test("#given an unknown key inside an agent override #when parsed #then validation fails", () => {
    // given
    const input = { agents: { "backend-lead": { bogus: true } } }

    // when
    const result = OmoMemorySettingsSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
  })
})
