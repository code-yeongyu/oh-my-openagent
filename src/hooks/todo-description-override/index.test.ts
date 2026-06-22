import { describe, expect, test } from "bun:test"
import { TODOWRITE_DESCRIPTION } from "./description"
import { createTodoDescriptionOverrideHook } from "./hook"

describe("todo-description-override", () => {
  describe("tool.definition handler", () => {
    test("overrides description when toolID is todowrite", async () => {
      //#given
      const hook = createTodoDescriptionOverrideHook()
      const input = { toolID: "todowrite" }
      const output = { description: "original description", parameters: {} }

      //#when
      await hook["tool.definition"](input, output)

      //#then
      expect(output.description).toBe(TODOWRITE_DESCRIPTION)
    })

    test("does not modify description for other tools", async () => {
      //#given
      const hook = createTodoDescriptionOverrideHook()
      const input = { toolID: "bash" }
      const output = { description: "original description", parameters: {} }

      //#when
      await hook["tool.definition"](input, output)

      //#then
      expect(output.description).toBe("original description")
    })

    test("does not modify parameters for todowrite", async () => {
      //#given
      const hook = createTodoDescriptionOverrideHook()
      const input = { toolID: "todowrite" }
      const originalParams = { type: "object", properties: {} }
      const output = { description: "original", parameters: originalParams }

      //#when
      await hook["tool.definition"](input, output)

      //#then
      expect(output.parameters).toBe(originalParams)
    })

    test("does not modify description for case-variant tool names", async () => {
      //#given
      const hook = createTodoDescriptionOverrideHook()
      const cases = ["TodoWrite", "TODOWRITE", "todo_write", "todo-write"]

      for (const toolID of cases) {
        const output = { description: "original", parameters: {} }
        //#when
        await hook["tool.definition"]({ toolID }, output)
        //#then
        expect(output.description).toBe("original")
      }
    })
  })
})
