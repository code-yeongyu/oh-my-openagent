import { describe, expect, it } from "bun:test"
import {
  parseSlashCommand,
  detectSlashCommand,
  isExcludedCommand,
  removeCodeBlocks,
  extractPromptText,
} from "./detector"

describe("auto-slash-command detector", () => {
  describe("removeCodeBlocks", () => {
    it("should remove markdown code blocks", () => {
      // #given text with code blocks
      const text = "Hello ```code here``` world"

      // #when removing code blocks
      const result = removeCodeBlocks(text)

      // #then code blocks should be removed
      expect(result).toBe("Hello  world")
    })

    it("should remove multiline code blocks", () => {
      // #given text with multiline code blocks
      const text = `Before
\`\`\`javascript
/command-inside-code
\`\`\`
After`

      // #when removing code blocks
      const result = removeCodeBlocks(text)

      // #then code blocks should be removed
      expect(result).toContain("Before")
      expect(result).toContain("After")
      expect(result).not.toContain("/command-inside-code")
    })

    it("should handle text without code blocks", () => {
      // #given text without code blocks
      const text = "Just regular text"

      // #when removing code blocks
      const result = removeCodeBlocks(text)

      // #then text should remain unchanged
      expect(result).toBe("Just regular text")
    })
  })

  describe("parseSlashCommand", () => {
    it("should parse simple command without args", () => {
      // #given a simple slash command
      const text = "/commit"

      // #when parsing
      const result = parseSlashCommand(text)

      // #then should extract command correctly
      expect(result).not.toBeNull()
      expect(result?.command).toBe("commit")
      expect(result?.args).toBe("")
    })

    it("should parse command with arguments", () => {
      // #given a slash command with arguments
      const text = "/plan create a new feature for auth"

      // #when parsing
      const result = parseSlashCommand(text)

      // #then should extract command and args
      expect(result).not.toBeNull()
      expect(result?.command).toBe("plan")
      expect(result?.args).toBe("create a new feature for auth")
    })

    it("should parse command with quoted arguments", () => {
      // #given a slash command with quoted arguments
      const text = '/execute "build the API"'

      // #when parsing
      const result = parseSlashCommand(text)

      // #then should extract command and args
      expect(result).not.toBeNull()
      expect(result?.command).toBe("execute")
      expect(result?.args).toBe('"build the API"')
    })

    it("should parse command with hyphen in name", () => {
      // #given a slash command with hyphen
      const text = "/frontend-template-creator project"

      // #when parsing
      const result = parseSlashCommand(text)

      // #then should extract full command name
      expect(result).not.toBeNull()
      expect(result?.command).toBe("frontend-template-creator")
      expect(result?.args).toBe("project")
    })

    it("should return null for non-slash text", () => {
      // #given text without slash
      const text = "regular text"

      // #when parsing
      const result = parseSlashCommand(text)

      // #then should return null
      expect(result).toBeNull()
    })

    it("should return null for slash not at start", () => {
      // #given text with slash in middle
      const text = "some text /command"

      // #when parsing
      const result = parseSlashCommand(text)

      // #then should return null (slash not at start)
      expect(result).toBeNull()
    })

    it("should return null for just a slash", () => {
      // #given just a slash
      const text = "/"

      // #when parsing
      const result = parseSlashCommand(text)

      // #then should return null
      expect(result).toBeNull()
    })

    it("should return null for slash followed by number", () => {
      // #given slash followed by number
      const text = "/123"

      // #when parsing
      const result = parseSlashCommand(text)

      // #then should return null (command must start with letter)
      expect(result).toBeNull()
    })

    it("should handle whitespace before slash", () => {
      // #given command with leading whitespace
      const text = "  /commit"

      // #when parsing
      const result = parseSlashCommand(text)

      // #then should parse after trimming
      expect(result).not.toBeNull()
      expect(result?.command).toBe("commit")
    })
  })

  describe("isExcludedCommand", () => {
    it("should exclude ralph-loop", () => {
      // #given ralph-loop command
      // #when checking exclusion
      // #then should be excluded
      expect(isExcludedCommand("ralph-loop")).toBe(true)
    })

    it("should exclude cancel-ralph", () => {
      // #given cancel-ralph command
      // #when checking exclusion
      // #then should be excluded
      expect(isExcludedCommand("cancel-ralph")).toBe(true)
    })

    it("should be case-insensitive for exclusion", () => {
      // #given uppercase variants
      // #when checking exclusion
      // #then should still be excluded
      expect(isExcludedCommand("RALPH-LOOP")).toBe(true)
      expect(isExcludedCommand("Cancel-Ralph")).toBe(true)
    })

    it("should not exclude regular commands", () => {
      // #given regular commands
      // #when checking exclusion
      // #then should not be excluded
      expect(isExcludedCommand("commit")).toBe(false)
      expect(isExcludedCommand("plan")).toBe(false)
      expect(isExcludedCommand("execute")).toBe(false)
    })
  })

  describe("detectSlashCommand", () => {
    it("should detect slash command in plain text", () => {
      // #given plain text with slash command
      const text = "/commit fix typo"

      // #when detecting
      const result = detectSlashCommand(text)

      // #then should detect
      expect(result).not.toBeNull()
      expect(result?.command).toBe("commit")
      expect(result?.args).toBe("fix typo")
    })

    it("should NOT detect slash command inside code block", () => {
      // #given slash command inside code block
      const text = "```bash\n/command\n```"

      // #when detecting
      const result = detectSlashCommand(text)

      // #then should not detect (only code block content)
      expect(result).toBeNull()
    })

    it("should detect command when text has code blocks elsewhere", () => {
      // #given slash command before code block
      const text = "/commit fix\n```code```"

      // #when detecting
      const result = detectSlashCommand(text)

      // #then should detect the command
      expect(result).not.toBeNull()
      expect(result?.command).toBe("commit")
    })

    it("should NOT detect excluded commands", () => {
      // #given excluded command
      const text = "/ralph-loop do something"

      // #when detecting
      const result = detectSlashCommand(text)

      // #then should not detect
      expect(result).toBeNull()
    })

    it("should return null for non-command text", () => {
      // #given regular text
      const text = "Just some regular text"

      // #when detecting
      const result = detectSlashCommand(text)

      // #then should return null
      expect(result).toBeNull()
    })
  })

  describe("extractPromptText", () => {
    it("should extract text from parts", () => {
      // #given message parts
      const parts = [
        { type: "text", text: "Hello " },
        { type: "tool_use", id: "123" },
        { type: "text", text: "world" },
      ]

      // #when extracting
      const result = extractPromptText(parts)

      // #then should join text parts
      expect(result).toBe("Hello  world")
    })

    it("should handle empty parts", () => {
      // #given empty parts
      const parts: Array<{ type: string; text?: string }> = []

      // #when extracting
      const result = extractPromptText(parts)

      // #then should return empty string
      expect(result).toBe("")
    })

    it("should handle parts without text", () => {
      // #given parts without text content
      const parts = [
        { type: "tool_use", id: "123" },
        { type: "tool_result", output: "result" },
      ]

      // #when extracting
      const result = extractPromptText(parts)

      // #then should return empty string
      expect(result).toBe("")
    })
  })
})
