import { describe, it, expect } from "bun:test"
import { transformToolName } from "./tool-name"

describe("transformToolName", () => {
  describe("whitespace trimming", () => {
    it("trims leading whitespace from tool name", () => {
      // given
      const toolName = " delegate_task"

      // when
      const result = transformToolName(toolName)

      // then
      expect(result).toBe("DelegateTask")
    })

    it("trims trailing whitespace from tool name", () => {
      // given
      const toolName = "delegate_task "

      // when
      const result = transformToolName(toolName)

      // then
      expect(result).toBe("DelegateTask")
    })

    it("trims both leading and trailing whitespace", () => {
      // given
      const toolName = " delegate_task "

      // when
      const result = transformToolName(toolName)

      // then
      expect(result).toBe("DelegateTask")
    })

    it("applies special mapping after trimming whitespace", () => {
      // given
      const toolName = " webfetch"

      // when
      const result = transformToolName(toolName)

      // then
      expect(result).toBe("WebFetch")
    })

    it("handles simple case with leading and trailing spaces", () => {
      // given
      const toolName = " read "

      // when
      const result = transformToolName(toolName)

      // then
      expect(result).toBe("Read")
    })
  })

  describe("special tool mappings", () => {
    it("maps webfetch to WebFetch", () => {
      // given
      const toolName = "webfetch"

      // when
      const result = transformToolName(toolName)

      // then
      expect(result).toBe("WebFetch")
    })

    it("maps websearch to WebSearch", () => {
      // given
      const toolName = "websearch"

      // when
      const result = transformToolName(toolName)

      // then
      expect(result).toBe("WebSearch")
    })

    it("maps todoread to TodoRead", () => {
      // given
      const toolName = "todoread"

      // when
      const result = transformToolName(toolName)

      // then
      expect(result).toBe("TodoRead")
    })

    it("maps todowrite to TodoWrite", () => {
      // given
      const toolName = "todowrite"

      // when
      const result = transformToolName(toolName)

      // then
      expect(result).toBe("TodoWrite")
    })
  })

  describe("kebab-case and snake_case conversion", () => {
    it("converts snake_case to PascalCase", () => {
      // given
      const toolName = "delegate_task"

      // when
      const result = transformToolName(toolName)

      // then
      expect(result).toBe("DelegateTask")
    })

    it("converts kebab-case to PascalCase", () => {
      // given
      const toolName = "call-omo-agent"

      // when
      const result = transformToolName(toolName)

      // then
      expect(result).toBe("CallOmoAgent")
    })
  })

  describe("simple capitalization", () => {
    it("capitalizes simple single-word tool names", () => {
      // given
      const toolName = "read"

      // when
      const result = transformToolName(toolName)

      // then
      expect(result).toBe("Read")
    })

    it("preserves capitalization of already capitalized names", () => {
      // given
      const toolName = "Write"

      // when
      const result = transformToolName(toolName)

      // then
      expect(result).toBe("Write")
    })
  })
})
