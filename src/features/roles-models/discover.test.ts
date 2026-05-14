/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { discoverRoles } from "./discover"
import type { OhMyOpenCodeConfig } from "../../config"

describe("discoverRoles", () => {
  describe("#given an empty config", () => {
    test("#when discovering #then all known roles have empty chains", () => {
      const roles = discoverRoles({} as OhMyOpenCodeConfig)

      expect(roles.some((r) => r.name === "sisyphus")).toBe(true)
      expect(roles.some((r) => r.name === "hephaestus")).toBe(true)
      expect(roles.every((r) => r.chain.length === 0)).toBe(true)
      expect(roles.every((r) => r.primary === undefined)).toBe(true)
    })
  })

  describe("#given an agent override with model + chain", () => {
    test("#when discovering #then primary and chain are populated", () => {
      const config = {
        agents: {
          sisyphus: {
            model: "anthropic/claude-opus-4-7",
            variant: "max",
            fallback_models: [
              { model: "opencode-go/kimi-k2.6" },
              { model: "github-copilot/gpt-5.5", variant: "medium" },
            ],
          },
        },
      } as unknown as OhMyOpenCodeConfig

      const roles = discoverRoles(config)
      const sisyphus = roles.find((r) => r.name === "sisyphus")

      expect(sisyphus?.primary).toEqual({ model: "anthropic/claude-opus-4-7", variant: "max" })
      expect(sisyphus?.chain).toEqual([
        { model: "opencode-go/kimi-k2.6" },
        { model: "github-copilot/gpt-5.5", variant: "medium" },
      ])
    })
  })

  describe("#given an undefined config", () => {
    test("#when discovering #then it still returns the known role names", () => {
      const roles = discoverRoles(undefined)

      expect(roles.length).toBeGreaterThan(0)
      expect(roles.some((r) => r.name === "atlas")).toBe(true)
    })
  })
})
