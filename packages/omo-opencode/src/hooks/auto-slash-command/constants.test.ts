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

  describe("#given command appears mid-sentence", () => {
    it("#then parses the namespaced command from the middle of the text", () => {
      // given
      const text = "please run /my.plugin:run ship now"

      // when
      const parsed = parseSlashCommand(text)

      // then
      expect(parsed).not.toBeNull()
      expect(parsed?.command).toBe("my.plugin:run")
      expect(parsed?.args).toBe("ship now")
      expect(parsed?.start).toBe(text.indexOf("/"))
    })
  })
})
