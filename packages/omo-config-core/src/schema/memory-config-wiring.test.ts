import { describe, expect, test } from "bun:test"

import { resolveOmoConfigView } from "../index"
import { OmoConfigSchema } from "./config"

describe("memory config wiring", () => {
  test("#given a root memory block #when the config parses #then defaults materialize once", () => {
    // given
    const config = { memory: {} }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    expect(result.data.memory?.enabled).toBe(true)
    expect(result.data.memory?.reflection.enabled).toBe(true)
    expect(result.data.memory?.reflection.category).toBe("quick")
    expect(result.data.memory?.reflection.trigger).toEqual({ step_count: 25, on_compaction: true })
    expect(result.data.memory?.nudge).toEqual({ enabled: true, every_user_turns: 10 })
    expect(result.data.memory?.facts).toEqual({ enabled: true, debounce_settles: 4 })
    expect(result.data.memory?.dream).toEqual({
      enabled: true,
      idle_minutes: 30,
      min_hours_between: 24,
      shutdown_launch: true,
      auto_select_max: 5,
      auto_select_max_chars: 150000,
    })
    expect(result.data.memory?.people).toEqual({ enabled: true, max_entries: 40, max_entry_chars: 200 })
    expect(result.data.memory?.soul).toEqual({ edit_notice: true })
  })

  test("#given memory blocks in harness and profile overlays #when parsed #then they stay default-free", () => {
    // given
    const config = {
      memory: { reflection: { timeout_minutes: 20 } },
      "[senpi]": { memory: { reflection: { category: "deep" } } },
      profiles: { focused: { memory: { search: { enabled: false } } } },
    }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    expect(result.data["[senpi]"]?.memory).toEqual({ reflection: { category: "deep" } })
    expect(result.data.profiles.focused?.memory).toEqual({ search: { enabled: false } })
  })

  test("#given an unknown key inside a profile memory block #when parsed #then the config rejects it", () => {
    // given
    const config = { profiles: { focused: { memory: { bogus: 1 } } } }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })
})

describe("memory profile and harness deep-merge", () => {
  test("#given base and senpi memory blocks #when folding the harness view #then memory deep-merges", () => {
    // given
    const config = {
      memory: { enabled: true, reflection: { timeout_minutes: 20, category: "deep" } },
      "[senpi]": { memory: { reflection: { category: "quick" } } },
    }

    // when
    const result = resolveOmoConfigView({ config, harness: "senpi" })

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.config["memory"]).toEqual({
      enabled: true,
      reflection: { timeout_minutes: 20, category: "quick" },
    })
  })

  test("#given base harness and profile memory blocks #when folding the profile view #then later layers win per leaf", () => {
    // given
    const config = {
      memory: { agent: "auto", reflection: { timeout_minutes: 15 } },
      "[senpi]": { memory: { reflection: { category: "deep" } } },
      profiles: {
        focused: {
          memory: { reflection: { timeout_minutes: 30 } },
          "[senpi]": { memory: { search: { enabled: false } } },
        },
      },
    }

    // when
    const result = resolveOmoConfigView({ config, harness: "senpi", profile: "focused" })

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.config["memory"]).toEqual({
      agent: "auto",
      reflection: { timeout_minutes: 30, category: "deep" },
      search: { enabled: false },
    })
  })
})
