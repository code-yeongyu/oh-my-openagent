import { describe, expect, it } from "bun:test"
import { loadBuiltinCommands } from "./commands"

describe("loadBuiltinCommands", () => {
  it("returns string templates by default for config compatibility", () => {
    const commands = loadBuiltinCommands()

    expect(Object.keys(commands).length).toBeGreaterThan(0)

    for (const command of Object.values(commands)) {
      expect(typeof command.template).toBe("string")
    }
  })

  it("returns runtime template resolvers when requested", () => {
    const commands = loadBuiltinCommands(undefined, { runtimeTemplates: true })
    const ralphLoop = commands["ralph-loop"]

    expect(ralphLoop).toBeDefined()
    expect(typeof ralphLoop.template).toBe("function")

    const rendered = (ralphLoop.template as (args: { user_message?: string }) => string)({
      user_message: "ship this --mode=quick",
    })

    expect(rendered).toContain("<preset-context>")
    expect(rendered).toContain("Mode: quick")
  })
})
