import { describe, expect, test } from "bun:test"
import { createSisyphusJuniorAgentWithOverrides, SISYPHUS_JUNIOR_DEFAULTS } from "./sisyphus-junior"

describe("createSisyphusJuniorAgentWithOverrides", () => {
  describe("honored fields", () => {
    test("applies model override", () => {
      // #given
      const override = { model: "openai/gpt-5.2" }

      // #when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // #then
      expect(result.model).toBe("openai/gpt-5.2")
    })

    test("applies temperature override", () => {
      // #given
      const override = { temperature: 0.5 }

      // #when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // #then
      expect(result.temperature).toBe(0.5)
    })

    test("applies top_p override", () => {
      // #given
      const override = { top_p: 0.9 }

      // #when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // #then
      expect(result.top_p).toBe(0.9)
    })

    test("applies description override", () => {
      // #given
      const override = { description: "Custom description" }

      // #when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // #then
      expect(result.description).toBe("Custom description")
    })

    test("applies color override", () => {
      // #given
      const override = { color: "#FF0000" }

      // #when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // #then
      expect(result.color).toBe("#FF0000")
    })

    test("appends prompt_append to base prompt", () => {
      // #given
      const override = { prompt_append: "Extra instructions here" }

      // #when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // #then
      expect(result.prompt).toContain("You work ALONE")
      expect(result.prompt).toContain("Extra instructions here")
    })
  })

  describe("defaults", () => {
    test("uses default model when no override", () => {
      // #given
      const override = {}

      // #when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // #then
      expect(result.model).toBe(SISYPHUS_JUNIOR_DEFAULTS.model)
    })

    test("uses default temperature when no override", () => {
      // #given
      const override = {}

      // #when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // #then
      expect(result.temperature).toBe(SISYPHUS_JUNIOR_DEFAULTS.temperature)
    })
  })

  describe("disable semantics", () => {
    test("disable: true causes override block to be ignored", () => {
      // #given
      const override = {
        disable: true,
        model: "openai/gpt-5.2",
        temperature: 0.9,
      }

      // #when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // #then - defaults should be used, not the overrides
      expect(result.model).toBe(SISYPHUS_JUNIOR_DEFAULTS.model)
      expect(result.temperature).toBe(SISYPHUS_JUNIOR_DEFAULTS.temperature)
    })
  })

  describe("constrained fields", () => {
    test("mode is forced to subagent", () => {
      // #given
      const override = { mode: "primary" as const }

      // #when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // #then
      expect(result.mode).toBe("subagent")
    })

    test("prompt override is ignored (discipline text preserved)", () => {
      // #given
      const override = { prompt: "Completely new prompt that replaces everything" }

      // #when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // #then
      expect(result.prompt).toContain("You work ALONE")
      expect(result.prompt).not.toBe("Completely new prompt that replaces everything")
    })
  })

  describe("tool safety (task/delegate_task blocked, call_omo_agent allowed)", () => {
    test("task and delegate_task remain blocked, call_omo_agent is allowed via tools format", () => {
      // #given
      const override = {
        tools: {
          task: true,
          delegate_task: true,
          call_omo_agent: true,
          read: true,
        },
      }

      // #when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // #then
      const tools = result.tools as Record<string, boolean> | undefined
      const permission = result.permission as Record<string, string> | undefined
      if (tools) {
        expect(tools.task).toBe(false)
        expect(tools.delegate_task).toBe(false)
        // call_omo_agent is NOW ALLOWED for subagents to spawn explore/librarian
        expect(tools.call_omo_agent).toBe(true)
        expect(tools.read).toBe(true)
      }
      if (permission) {
        expect(permission.task).toBe("deny")
        expect(permission.delegate_task).toBe("deny")
        // call_omo_agent is NOW ALLOWED for subagents to spawn explore/librarian
        expect(permission.call_omo_agent).toBe("allow")
      }
    })

    test("task and delegate_task remain blocked when using permission format override", () => {
      // #given
      const override = {
        permission: {
          task: "allow",
          delegate_task: "allow",
          call_omo_agent: "allow",
          read: "allow",
        },
      } as { permission: Record<string, string> }

      // #when
      const result = createSisyphusJuniorAgentWithOverrides(override as Parameters<typeof createSisyphusJuniorAgentWithOverrides>[0])

      // #then - task/delegate_task blocked, but call_omo_agent allowed for explore/librarian spawning
      const tools = result.tools as Record<string, boolean> | undefined
      const permission = result.permission as Record<string, string> | undefined
      if (tools) {
        expect(tools.task).toBe(false)
        expect(tools.delegate_task).toBe(false)
        expect(tools.call_omo_agent).toBe(true)
      }
      if (permission) {
        expect(permission.task).toBe("deny")
        expect(permission.delegate_task).toBe("deny")
        expect(permission.call_omo_agent).toBe("allow")
      }
    })
  })

  describe("prompt composition", () => {
    test("base prompt contains discipline constraints", () => {
      // #given
      const override = {}

      // #when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // #then
      expect(result.prompt).toContain("Sisyphus-Junior")
      expect(result.prompt).toContain("You work ALONE")
      expect(result.prompt).toContain("BLOCKED ACTIONS")
    })

    test("prompt_append is added after base prompt", () => {
      // #given
      const override = { prompt_append: "CUSTOM_MARKER_FOR_TEST" }

      // #when
      const result = createSisyphusJuniorAgentWithOverrides(override)

      // #then
      const baseEndIndex = result.prompt!.indexOf("Dense > verbose.")
      const appendIndex = result.prompt!.indexOf("CUSTOM_MARKER_FOR_TEST")
      expect(baseEndIndex).not.toBe(-1) // Guard: anchor text must exist in base prompt
      expect(appendIndex).toBeGreaterThan(baseEndIndex)
    })
  })
})
