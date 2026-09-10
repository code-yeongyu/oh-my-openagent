import { describe, it, expect } from "bun:test"
import { createToolDefinitionHandler } from "./tool-definition"
import { createTodoDescriptionOverrideHook } from "../hooks/todo-description-override/hook"
import { TODOWRITE_DESCRIPTION } from "../hooks/todo-description-override/description"
import type { CreatedHooks } from "../create-hooks"

function buildHooks(overrides: Partial<CreatedHooks> = {}): CreatedHooks {
  return overrides as CreatedHooks
}

describe("createToolDefinitionHandler (regression for #3705)", () => {
  describe("#given todoDescriptionOverride hook is registered", () => {
    describe("#when the tool.definition handler runs for the todowrite tool", () => {
      it("#then forwards to the hook and rewrites the description", async () => {
        //#given
        const handler = createToolDefinitionHandler({
          hooks: buildHooks({ todoDescriptionOverride: createTodoDescriptionOverrideHook() }),
        })
        const output = { description: "opencode core default", parameters: {} }

        //#when
        await handler({ toolID: "todowrite" }, output)

        //#then
        expect(output.description).toBe(TODOWRITE_DESCRIPTION)
      })
    })

    describe("#when the tool.definition handler runs for any other tool", () => {
      it("#then leaves the description untouched", async () => {
        //#given
        const handler = createToolDefinitionHandler({
          hooks: buildHooks({ todoDescriptionOverride: createTodoDescriptionOverrideHook() }),
        })
        const output = { description: "bash native description", parameters: {} }

        //#when
        await handler({ toolID: "bash" }, output)

        //#then
        expect(output.description).toBe("bash native description")
      })
    })
  })

  describe("#given todoDescriptionOverride hook is disabled (null)", () => {
    describe("#when the tool.definition handler runs for todowrite", () => {
      it("#then is a no-op", async () => {
        //#given
        const handler = createToolDefinitionHandler({
          hooks: buildHooks({ todoDescriptionOverride: null }),
        })
        const output = { description: "opencode default kept", parameters: {} }

        //#when
        await handler({ toolID: "todowrite" }, output)

        //#then
        expect(output.description).toBe("opencode default kept")
      })
    })
  })

  describe("#given byte-stable prefix port (apply override once per session)", () => {
    describe("#when the tool.definition handler fetches todowrite twice", () => {
      it("#then both fetches return byte-identical output and the hook runs once", async () => {
        //#given
        let hookCalls = 0
        const countingHook = {
          "tool.definition": async (
            _input: { toolID: string },
            output: { description: string; parameters: unknown },
          ) => {
            hookCalls += 1
            output.description = TODOWRITE_DESCRIPTION
          },
        }
        const handler = createToolDefinitionHandler({
          hooks: buildHooks({ todoDescriptionOverride: countingHook }),
        })
        const first = { description: "opencode core default", parameters: {} }
        const second = { description: "opencode core default", parameters: {} }

        //#when
        await handler({ toolID: "todowrite" }, first)
        await handler({ toolID: "todowrite" }, second)

        //#then
        expect(first.description).toBe(TODOWRITE_DESCRIPTION)
        expect(second.description).toBe(first.description)
        expect(hookCalls).toBe(1)
      })
    })
  })
})
