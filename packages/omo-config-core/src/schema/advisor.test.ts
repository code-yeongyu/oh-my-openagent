/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { OmoConfigSchema } from "./config"
import { resolveOmoAdvisorSettings } from "./advisor"

describe("advisor settings", () => {
  it("#given no advisor block #when resolved #then the advisor is off", () => {
    expect(resolveOmoAdvisorSettings({}).enabled).toBe(false)
  })

  it("#given a partial layer #when resolved #then defaults fill the rest", () => {
    const settings = resolveOmoAdvisorSettings({ advisor: { enabled: true, model: "anthropic/claude-opus-5-5" } })
    expect(settings).toMatchObject({ enabled: true, model: "anthropic/claude-opus-5-5", check_every: 5, max_per_session: 3 })
  })

  it("#given a key value instead of an env name #when the config is parsed #then it is rejected", () => {
    expect(OmoConfigSchema.safeParse({ advisor: { api_key_env: "sk-not/a-name" } }).success).toBe(false)
  })

  it("#given an unknown advisor key #when the config is parsed #then the strict schema rejects it", () => {
    expect(OmoConfigSchema.safeParse({ advisor: { api_key: "x" } }).success).toBe(false)
  })
})
