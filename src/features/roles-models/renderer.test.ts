/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"

import { discoverRoles } from "./discover"
import { buildViews } from "./view"
import { setOverride, _resetAllForTests } from "./state"
import { renderPanel } from "./renderer"
import type { OhMyOpenCodeConfig } from "../../config"

const sampleConfig = {
  agents: {
    sisyphus: {
      model: "anthropic/claude-opus-4-7",
      variant: "max",
      fallback_models: [{ model: "opencode-go/kimi-k2.6" }],
    },
    hephaestus: {
      model: "openai/gpt-5.5",
      variant: "medium",
    },
  },
} as unknown as OhMyOpenCodeConfig

describe("renderPanel", () => {
  beforeEach(() => {
    _resetAllForTests()
  })

  test("#given populated roles #when rendered #then output contains role names and models", () => {
    const roles = discoverRoles(sampleConfig)
    const views = buildViews(roles)

    const output = renderPanel(views, { hideEmptyRoles: true, autoPick: false })

    expect(output).toContain("Roles · Models")
    expect(output).toContain("sisyphus")
    expect(output).toContain("anthropic/claude-opus-4-7 max")
    expect(output).toContain("hephaestus")
    expect(output).toContain("openai/gpt-5.5 medium")
    expect(output).toContain("auto-pick: OFF")
  })

  test("#given a /pick override #when rendered #then the active glyph reflects pick", () => {
    setOverride("s1", "sisyphus", { model: "opencode-go/kimi-k2.6" })
    const roles = discoverRoles(sampleConfig)
    const views = buildViews(roles, { sessionID: "s1" })

    const output = renderPanel(views, { hideEmptyRoles: true })

    expect(output).toContain("◆ sisyphus")
    expect(output).toContain("opencode-go/kimi-k2.6")
  })

  test("#given team leader option #when rendered #then footer includes leader", () => {
    const roles = discoverRoles(sampleConfig)
    const views = buildViews(roles)

    const output = renderPanel(views, { hideEmptyRoles: true, teamLeader: "sisyphus" })

    expect(output).toContain("team · leader: sisyphus")
  })

  test("#given empty roles with no chain #when hideEmptyRoles is true #then they are omitted", () => {
    const roles = discoverRoles(sampleConfig)
    const views = buildViews(roles)

    const output = renderPanel(views, { hideEmptyRoles: true })

    expect(output).not.toContain(" atlas ")
    expect(output).not.toContain(" librarian ")
  })
})
