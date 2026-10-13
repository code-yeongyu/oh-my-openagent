import { describe, expect, it } from "bun:test"
import { migrateAgentConfig } from "./migrate-agent"

describe("migrateAgentConfig", () => {
  describe("#given plain 1.x agent fields", () => {
    it("#when migrated #then prompt becomes system and the simple fields carry over", () => {
      // given
      const v1 = { prompt: "You orchestrate.", description: "Main agent", mode: "primary", hidden: true, color: "#112233", steps: 40 }

      // when
      const patch = migrateAgentConfig(v1)

      // then
      expect(patch).toMatchObject({
        system: "You orchestrate.",
        description: "Main agent",
        mode: "primary",
        hidden: true,
        color: "#112233",
        steps: 40,
        remove: false,
      })
    })

    it("#when maxSteps is used instead of steps #then it is read as steps", () => {
      // given / when
      const patch = migrateAgentConfig({ maxSteps: 12 })

      // then
      expect(patch.steps).toBe(12)
    })

    it("#when the color is a theme name #then it falls back to a neutral hex color", () => {
      // given / when
      const patch = migrateAgentConfig({ color: "primary" })

      // then
      expect(patch.color).toBe("#aaaaaa")
    })

    it("#when the agent is disabled #then the patch asks for removal", () => {
      // given / when
      const patch = migrateAgentConfig({ disable: true })

      // then
      expect(patch.remove).toBe(true)
    })
  })

  describe("#given a model selection", () => {
    it("#when migrated #then provider/model becomes a ref and variant is attached", () => {
      // given / when
      const patch = migrateAgentConfig({ model: "anthropic/claude-opus-4-5", variant: "high" })

      // then
      expect(patch.model).toEqual({ providerID: "anthropic", id: "claude-opus-4-5", variant: "high" })
    })

    it("#when the model has no provider prefix #then no ref is produced", () => {
      // given / when
      const patch = migrateAgentConfig({ model: "claude-opus-4-5" })

      // then
      expect(patch.model).toBeUndefined()
    })
  })

  describe("#given sampling, options and unknown keys", () => {
    it("#when migrated #then they are merged into the request body", () => {
      // given
      const v1 = { temperature: 0.2, top_p: 0.9, options: { thinking: { type: "enabled" } }, reasoningEffort: "high" }

      // when
      const patch = migrateAgentConfig(v1)

      // then
      expect(patch.requestBody).toEqual({
        thinking: { type: "enabled" },
        reasoningEffort: "high",
        temperature: 0.2,
        top_p: 0.9,
      })
    })

    it("#when there is nothing to send #then the request body is empty", () => {
      // given / when
      const patch = migrateAgentConfig({ prompt: "x" })

      // then
      expect(patch.requestBody).toEqual({})
    })
  })

  describe("#given tools and permission", () => {
    it("#when migrated #then rules use the 2.x action names and an override keeps its first position", () => {
      // given: tools.write maps to edit first, so the later permission.edit replaces it in place
      const v1 = {
        tools: { write: false, read: true },
        permission: { bash: "ask", task: "allow", edit: { "src/**": "allow", "*": "deny" } },
      }

      // when
      const patch = migrateAgentConfig(v1)

      // then
      expect(patch.permissions).toEqual([
        { action: "edit", resource: "src/**", effect: "allow" },
        { action: "edit", resource: "*", effect: "deny" },
        { action: "read", resource: "*", effect: "allow" },
        { action: "shell", resource: "*", effect: "ask" },
        { action: "subagent", resource: "*", effect: "allow" },
      ])
    })

    it("#when permission is a single string #then it applies to every action", () => {
      // given / when
      const patch = migrateAgentConfig({ permission: "ask" })

      // then
      expect(patch.permissions).toEqual([{ action: "*", resource: "*", effect: "ask" }])
    })

    it("#when a tool is also set in permission #then the permission entry wins", () => {
      // given
      const v1 = { tools: { bash: false }, permission: { bash: "allow" } }

      // when
      const patch = migrateAgentConfig(v1)

      // then
      expect(patch.permissions).toEqual([{ action: "shell", resource: "*", effect: "allow" }])
    })
  })
})
