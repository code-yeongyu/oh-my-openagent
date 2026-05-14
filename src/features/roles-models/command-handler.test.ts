/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"

import {
  handleRolesModelsCommand,
  isRolesModelsCommand,
  resolveAutoPick,
} from "./command-handler"
import { _resetAllForTests, getOverride, getAutoPickOverride } from "./state"
import type { OhMyOpenCodeConfig } from "../../config"

const config = {
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

function freshOutput(): { parts: Array<{ type: string; text?: string }> } {
  return { parts: [] }
}

describe("isRolesModelsCommand", () => {
  test("matches the three command names case-insensitively", () => {
    expect(isRolesModelsCommand("show-models")).toBe(true)
    expect(isRolesModelsCommand("SHOW-MODELS")).toBe(true)
    expect(isRolesModelsCommand("pick")).toBe(true)
    expect(isRolesModelsCommand("auto-pick")).toBe(true)
    expect(isRolesModelsCommand("refactor")).toBe(false)
  })
})

describe("handleRolesModelsCommand", () => {
  beforeEach(() => {
    _resetAllForTests()
  })

  describe("/show-models", () => {
    test("renders the panel into output.parts", () => {
      const output = freshOutput()
      const handled = handleRolesModelsCommand(
        { command: "show-models", sessionID: "s1", arguments: "" },
        output,
        config,
      )

      expect(handled).toBe(true)
      expect(output.parts).toHaveLength(1)
      expect(output.parts[0].type).toBe("text")
      expect(output.parts[0].text).toContain("Roles · Models")
      expect(output.parts[0].text).toContain("sisyphus")
      expect(output.parts[0].text).toContain("anthropic/claude-opus-4-7 max")
    })
  })

  describe("/pick", () => {
    test("with valid args sets the override and acknowledges", () => {
      const output = freshOutput()
      handleRolesModelsCommand(
        { command: "pick", sessionID: "s1", arguments: "sisyphus opencode-go/kimi-k2.6" },
        output,
        config,
      )

      expect(getOverride("s1", "sisyphus")).toEqual({ model: "opencode-go/kimi-k2.6" })
      expect(output.parts[0].text).toContain("/pick applied")
      expect(output.parts[0].text).toContain("opencode-go/kimi-k2.6")
    })

    test("with --variant carries the variant onto the override", () => {
      const output = freshOutput()
      handleRolesModelsCommand(
        {
          command: "pick",
          sessionID: "s1",
          arguments: "sisyphus anthropic/claude-opus-4-7 --variant=max",
        },
        output,
        config,
      )

      expect(getOverride("s1", "sisyphus")).toEqual({
        model: "anthropic/claude-opus-4-7",
        variant: "max",
      })
    })

    test("with --persist warns that persist is deferred", () => {
      const output = freshOutput()
      handleRolesModelsCommand(
        { command: "pick", sessionID: "s1", arguments: "sisyphus x/y --persist" },
        output,
        config,
      )

      expect(output.parts[0].text).toContain("session-only for now")
    })

    test("with missing args returns a usage message and does not set override", () => {
      const output = freshOutput()
      handleRolesModelsCommand(
        { command: "pick", sessionID: "s1", arguments: "sisyphus" },
        output,
        config,
      )

      expect(getOverride("s1", "sisyphus")).toBeUndefined()
      expect(output.parts[0].text).toContain("Usage:")
    })

    test("with unknown role returns an error and does not set override", () => {
      const output = freshOutput()
      handleRolesModelsCommand(
        { command: "pick", sessionID: "s1", arguments: "nonexistent x/y" },
        output,
        config,
      )

      expect(getOverride("s1", "nonexistent")).toBeUndefined()
      expect(output.parts[0].text).toContain("Unknown role")
    })
  })

  describe("/auto-pick", () => {
    test("on sets the session override to true", () => {
      const output = freshOutput()
      handleRolesModelsCommand(
        { command: "auto-pick", sessionID: "s1", arguments: "on" },
        output,
        config,
      )

      expect(getAutoPickOverride("s1")).toBe(true)
      expect(output.parts[0].text).toContain("auto-pick ON")
    })

    test("off sets the session override to false", () => {
      const output = freshOutput()
      handleRolesModelsCommand(
        { command: "auto-pick", sessionID: "s1", arguments: "off" },
        output,
        config,
      )

      expect(getAutoPickOverride("s1")).toBe(false)
    })

    test("with garbage arg returns a usage message", () => {
      const output = freshOutput()
      handleRolesModelsCommand(
        { command: "auto-pick", sessionID: "s1", arguments: "maybe" },
        output,
        config,
      )

      expect(getAutoPickOverride("s1")).toBeUndefined()
      expect(output.parts[0].text).toContain("Usage:")
    })
  })

  describe("unknown command", () => {
    test("returns false and leaves output untouched", () => {
      const output = freshOutput()
      const handled = handleRolesModelsCommand(
        { command: "refactor", sessionID: "s1", arguments: "" },
        output,
        config,
      )

      expect(handled).toBe(false)
      expect(output.parts).toHaveLength(0)
    })
  })
})

describe("resolveAutoPick", () => {
  beforeEach(() => {
    _resetAllForTests()
  })

  test("falls back to config when no session override is set", () => {
    expect(resolveAutoPick("s1", { display: { auto_pick: true } } as OhMyOpenCodeConfig)).toBe(true)
    expect(resolveAutoPick("s1", { display: { auto_pick: false } } as OhMyOpenCodeConfig)).toBe(false)
    expect(resolveAutoPick("s1", {} as OhMyOpenCodeConfig)).toBe(false)
  })

  test("session override wins over config default", () => {
    handleRolesModelsCommand(
      { command: "auto-pick", sessionID: "s1", arguments: "on" },
      freshOutput(),
      { display: { auto_pick: false } } as OhMyOpenCodeConfig,
    )

    expect(resolveAutoPick("s1", { display: { auto_pick: false } } as OhMyOpenCodeConfig)).toBe(true)
  })
})
