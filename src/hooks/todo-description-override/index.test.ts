import { describe, it, expect } from "bun:test"
import { createTodoDescriptionOverrideHook } from "./hook"
import { TODOWRITE_DESCRIPTION } from "./description"

describe("createTodoDescriptionOverrideHook", () => {
  describe("#given hook is created", () => {
    describe("#when tool.definition is called with todowrite", () => {
      it("#then should override the description", async () => {
        const hook = createTodoDescriptionOverrideHook()
        const output = { description: "original description", parameters: {} }

        await hook["tool.definition"]({ toolID: "todowrite" }, output)

        expect(output.description).toBe(TODOWRITE_DESCRIPTION)
      })
    })

    describe("#when tool.definition is called with non-todowrite tool", () => {
      it("#then should not modify the description", async () => {
        const hook = createTodoDescriptionOverrideHook()
        const output = { description: "original description", parameters: {} }

        await hook["tool.definition"]({ toolID: "bash" }, output)

        expect(output.description).toBe("original description")
      })
    })

    describe("#when tool.definition is called with TodoWrite (case-insensitive)", () => {
      it("#then should not override for different casing since OpenCode sends lowercase", async () => {
        const hook = createTodoDescriptionOverrideHook()
        const output = { description: "original description", parameters: {} }

        await hook["tool.definition"]({ toolID: "TodoWrite" }, output)

        expect(output.description).toBe("original description")
      })
    })
  })
})
