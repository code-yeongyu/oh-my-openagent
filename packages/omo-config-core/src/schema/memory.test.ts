import { describe, expect, test } from "bun:test"

import {
  OmoMemorySettingsLayerSchema,
  OmoMemorySettingsSchema,
  type OmoMemorySettings,
} from "./memory"

const FULL_DEFAULTS: OmoMemorySettings = {
  enabled: true,
  agent: "auto",
  tool_exposure: "direct",
  reflection: {
    enabled: true,
    trigger: { step_count: 25, on_compaction: true },
    merge: "auto",
    category: "quick",
    timeout_minutes: 15,
    sandbox: "auto",
  },
  nudge: { enabled: true, every_user_turns: 10 },
  facts: { enabled: true, debounce_settles: 4 },
  dream: {
    enabled: true,
    idle_minutes: 30,
    min_hours_between: 24,
    shutdown_launch: true,
    auto_select_max: 5,
    auto_select_max_chars: 150000,
  },
  people: { enabled: true, max_entries: 40, max_entry_chars: 200 },
  soul: { edit_notice: true },
  write_notice: { enabled: true },
  sync: { enabled: true },
  search: { enabled: true },
  compile_warn_tokens: 30000,
  agents: {},
}

describe("OmoMemorySettingsSchema defaults", () => {
  test("#given an empty memory block #when parsed #then the pinned v2 defaults apply", () => {
    // given
    const input = {}

    // when
    const parsed = OmoMemorySettingsSchema.parse(input)

    // then
    expect(parsed).toEqual(FULL_DEFAULTS)
  })

  test("#given a fully specified memory block #when parsed #then every explicit value is preserved", () => {
    // given
    const input: OmoMemorySettings = {
      enabled: false,
      agent: "backend-lead",
      tool_exposure: "search",
      reflection: {
        enabled: false,
        trigger: { step_count: 25, on_compaction: false },
        merge: "integration",
        category: "deep",
        timeout_minutes: 30,
        sandbox: "required",
      },
      nudge: { enabled: false, every_user_turns: 5 },
      facts: { enabled: false, debounce_settles: 2 },
      dream: {
        enabled: false,
        idle_minutes: 0,
        min_hours_between: 12,
        shutdown_launch: false,
        auto_select_max: 3,
        auto_select_max_chars: 100000,
      },
      people: { enabled: false, max_entries: 20, max_entry_chars: 100 },
      soul: { edit_notice: false },
      write_notice: { enabled: false },
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

  test("#given step_count default #when parsing empty #then reflection step_count defaults to 25", () => {
    // given
    const input = {}

    // when
    const parsed = OmoMemorySettingsSchema.parse(input)

    // then
    expect(parsed.reflection.trigger.step_count).toBe(25)
    expect(parsed.reflection.enabled).toBe(true)
  })

  test("#given an explicit step_count of 0 #when parsed #then 0 is preserved (disables trigger)", () => {
    // given
    const input = { reflection: { trigger: { step_count: 0 } } }

    // when
    const parsed = OmoMemorySettingsSchema.parse(input)

    // then
    expect(parsed.reflection.trigger.step_count).toBe(0)
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

  test("#given write_notice defaults #when parsing empty #then the tool-result notice is enabled", () => {
    // given
    const input = {}

    // when
    const parsed = OmoMemorySettingsSchema.parse(input)

    // then
    expect(parsed.write_notice).toEqual({ enabled: true })
  })

  test("#given write_notice disabled #when parsed #then the explicit value is preserved", () => {
    // given
    const input = { write_notice: { enabled: false } }

    // when
    const parsed = OmoMemorySettingsSchema.parse(input)

    // then
    expect(parsed.write_notice.enabled).toBe(false)
  })

  test("#given write_notice with an unknown key #when parsed #then the strict schema rejects it", () => {
    // given
    const input = { write_notice: { bogus: true } }

    // when
    const result = OmoMemorySettingsSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
  })

  test("#given a per-agent write_notice override #when parsed #then the layer accepts it as a deep-partial", () => {
    // given
    const input = { write_notice: { enabled: false }, agents: { "backend-lead": { write_notice: { enabled: true } } } }

    // when
    const parsed = OmoMemorySettingsLayerSchema.parse(input)

    // then
    expect(parsed).toEqual(input)
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
