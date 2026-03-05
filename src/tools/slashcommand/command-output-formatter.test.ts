import { describe, expect, it } from "bun:test"
import { formatLoadedCommand } from "./command-output-formatter"
import type { CommandInfo } from "./types"

describe("command output formatter", () => {
  describe("#given command template includes argument placeholders", () => {
    it("#then replaces both placeholder forms", async () => {
      // given
      const command: CommandInfo = {
        name: "daplug:templated",
        metadata: {
          name: "daplug:templated",
          description: "Templated plugin command",
        },
        content: "Echo $ARGUMENTS and ${user_message}.",
        scope: "plugin",
      }

      // when
      const output = await formatLoadedCommand(command, "ship it")

      // then
      expect(output).toContain("Echo ship it and ship it.")
      expect(output).not.toContain("$ARGUMENTS")
      expect(output).not.toContain("${user_message}")
    })
  })
})
