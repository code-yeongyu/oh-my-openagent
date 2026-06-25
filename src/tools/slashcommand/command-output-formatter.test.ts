import { describe, expect, it } from "bun:test"
import { formatLoadedCommand } from "./command-output-formatter"
import type { CommandInfo } from "./types"

function makeCommand(content: string): CommandInfo {
  return {
    name: "test-cmd",
    content,
    metadata: { name: "test-cmd", description: "Test command" },
    scope: "builtin",
  }
}

describe("formatLoadedCommand", () => {
  it("substitutes $ARGUMENTS with userMessage", async () => {
    //#given
    const command = makeCommand("Run with args: $ARGUMENTS")

    //#when
    const result = await formatLoadedCommand(command, "--create-new")

    //#then
    expect(result).toContain("Run with args: --create-new")
    expect(result).not.toContain("$ARGUMENTS")
  })

  it("replaces $ARGUMENTS with empty string when no userMessage provided", async () => {
    //#given
    const command = makeCommand("Run with args: $ARGUMENTS")

    //#when
    const result = await formatLoadedCommand(command, undefined)

    //#then
    expect(result).toContain("Run with args: ")
    expect(result).not.toContain("$ARGUMENTS")
  })

  // biome-ignore lint/suspicious/noTemplateCurlyInString: test description with literal ${user_message}
  it("substitutes ${user_message} with userMessage", async () => {
    //#given
    // biome-ignore lint/suspicious/noTemplateCurlyInString: test expects literal ${user_message}
    const command = makeCommand("Context: ${user_message}")

    //#when
    const result = await formatLoadedCommand(command, "my context")

    //#then
    expect(result).toContain("Context: my context")
    // biome-ignore lint/suspicious/noTemplateCurlyInString: test assertion checks for literal ${user_message}
    expect(result).not.toContain("${user_message}")
  })

  // biome-ignore lint/suspicious/noTemplateCurlyInString: test description with literal ${user_message}
  it("handles both $ARGUMENTS and ${user_message} in same template", async () => {
    //#given
    // biome-ignore lint/suspicious/noTemplateCurlyInString: test expects literal ${user_message} and $ARGUMENTS
    const command = makeCommand("Args: $ARGUMENTS and msg: ${user_message}")

    //#when
    const result = await formatLoadedCommand(command, "hello")

    //#then
    expect(result).toContain("Args: hello")
    expect(result).toContain("msg: hello")
  })
})
