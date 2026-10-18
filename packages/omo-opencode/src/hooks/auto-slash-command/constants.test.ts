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

  describe("#given command is followed by a newline", () => {
    it("#then does not swallow the next line into args", () => {
      // given
      const text = "please use /my-skill\nthen summarize the result"

      // when
      const parsed = parseSlashCommand(text)

      // then
      expect(parsed).not.toBeNull()
      expect(parsed?.command).toBe("my-skill")
      expect(parsed?.args).toBe("")
      expect(parsed?.raw).toBe("/my-skill")
      expect(parsed?.end).toBe(text.indexOf("\n"))
    })

    it("#then preserves args on the same line without swallowing the next line", () => {
      // given
      const text = "please use /my-skill arg1 arg2\nthen summarize the result"

      // when
      const parsed = parseSlashCommand(text)

      // then
      expect(parsed).not.toBeNull()
      expect(parsed?.command).toBe("my-skill")
      expect(parsed?.args).toBe("arg1 arg2")
      expect(parsed?.raw).toBe("/my-skill arg1 arg2")
      expect(parsed?.end).toBe(text.indexOf("\n"))
    })
  })
})
