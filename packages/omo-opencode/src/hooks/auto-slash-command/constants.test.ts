import { describe, expect, it } from "bun:test"
import { parseSlashCommand } from "./detector"

describe("slash command parsing pattern", () => {
  describe("#given plugin namespace includes dot", () => {
    it("#then parses command name with dot and colon", () => {
      // given
      const text = "/my.plugin:run ship"

      // when
      const parsed = parseSlashCommand(text)

      // then
      expect(parsed).not.toBeNull()
      expect(parsed?.command).toBe("my.plugin:run")
      expect(parsed?.args).toBe("ship")
    })
  })
})
