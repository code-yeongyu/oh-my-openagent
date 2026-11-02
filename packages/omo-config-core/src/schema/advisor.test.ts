/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { OmoConfigSchema } from "./config"
import { resolveOmoAdvisorSettings } from "./advisor"

describe("advisor settings", () => {
  it("#given no advisor block #when resolved #then the advisor is off and no model is pinned", () => {
    const settings = resolveOmoAdvisorSettings({})
    expect(settings.enabled).toBe(false)
    expect(settings.model).toBeUndefined()
  })

  it("#given a partial layer #when resolved #then defaults fill the rest", () => {
    const settings = resolveOmoAdvisorSettings({ advisor: { enabled: true, model: "openai/gpt-x" } })
    expect(settings).toMatchObject({ enabled: true, model: "openai/gpt-x", thinking: "high", threshold: 0.7, min_calls: 3, check_every: 1, cooldown: 5, max_per_session: 10 })
  })

  it("#given a key value instead of an env name #when the config is parsed #then it is rejected", () => {
    expect(OmoConfigSchema.safeParse({ advisor: { api_key_env: "sk-not/a-name" } }).success).toBe(false)
  })

  it("#given an unknown advisor key #when the config is parsed #then the strict schema rejects it", () => {
    expect(OmoConfigSchema.safeParse({ advisor: { api_key: "x" } }).success).toBe(false)
  })
})
