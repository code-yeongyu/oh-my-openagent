import { describe, test, expect } from "bun:test"
import { loadBuiltinCommands } from "./commands"

describe("loadBuiltinCommands", () => {
  test("should include debug command", () => {
    // #given - default loading (no disabled commands)
    // #when
    const commands = loadBuiltinCommands()

    // #then - debug command should exist with correct structure
    expect(commands["debug"]).toBeDefined()
    expect(commands["debug"].name).toBe("debug")
    expect(commands["debug"].description).toContain("Debug runtime issues")
    expect(commands["debug"].template).toContain("DEBUG MODE")
  })

  test("should respect disabled commands", () => {
    // #given - debug command disabled
    // #when
    const commands = loadBuiltinCommands(["debug"])

    // #then - debug command should not exist
    expect(commands["debug"]).toBeUndefined()
  })

  test("should have 7 builtin commands total", () => {
    // #given / #when
    const commands = loadBuiltinCommands()

    // #then - all 7 commands present
    const commandNames = Object.keys(commands)
    expect(commandNames).toHaveLength(7)
    expect(commandNames).toContain("init-deep")
    expect(commandNames).toContain("ralph-loop")
    expect(commandNames).toContain("ulw-loop")
    expect(commandNames).toContain("cancel-ralph")
    expect(commandNames).toContain("refactor")
    expect(commandNames).toContain("start-work")
    expect(commandNames).toContain("debug")
  })
})
