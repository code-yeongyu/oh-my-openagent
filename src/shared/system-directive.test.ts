import { describe, expect, test } from "bun:test"
import {
  hasSystemReminder,
  removeSystemReminders,
  isSystemDirective,
  createSystemDirective,
} from "./system-directive"

describe("system-directive utilities", () => {
  describe("hasSystemReminder", () => {
    test("should return true for messages containing <system-reminder> tags", () => {
      const text = `<system-reminder>
Some system content
</system-reminder>`
      expect(hasSystemReminder(text)).toBe(true)
    })

    test("should return false for messages without system-reminder tags", () => {
      const text = "Just a normal user message"
      expect(hasSystemReminder(text)).toBe(false)
    })

    test("should be case-insensitive for tag names", () => {
      const text = `<SYSTEM-REMINDER>content</SYSTEM-REMINDER>`
      expect(hasSystemReminder(text)).toBe(true)
    })

    test("should detect system-reminder in mixed content", () => {
      const text = `User text here
<system-reminder>
System content
</system-reminder>
More user text`
      expect(hasSystemReminder(text)).toBe(true)
    })

    test("should handle empty system-reminder tags", () => {
      const text = `<system-reminder></system-reminder>`
      expect(hasSystemReminder(text)).toBe(true)
    })

    test("should handle multiline system-reminder content", () => {
      const text = `<system-reminder>
Line 1
Line 2
Line 3
</system-reminder>`
      expect(hasSystemReminder(text)).toBe(true)
    })
  })

  describe("removeSystemReminders", () => {
    test("should remove system-reminder tags and content", () => {
      const text = `<system-reminder>
System content that should be removed
</system-reminder>`
      expect(removeSystemReminders(text)).toBe("")
    })

    test("should preserve user text outside system-reminder tags", () => {
      const text = `User message here
<system-reminder>
System content to remove
</system-reminder>
More user text`
      const result = removeSystemReminders(text)
      expect(result).toContain("User message here")
      expect(result).toContain("More user text")
      expect(result).not.toContain("System content to remove")
    })

    test("should remove multiple system-reminder blocks", () => {
      const text = `<system-reminder>First block</system-reminder>
User text
<system-reminder>Second block</system-reminder>`
      const result = removeSystemReminders(text)
      expect(result).toContain("User text")
      expect(result).not.toContain("First block")
      expect(result).not.toContain("Second block")
    })

    test("should be case-insensitive for tag names", () => {
      const text = `<SYSTEM-REMINDER>Content</SYSTEM-REMINDER>`
      expect(removeSystemReminders(text)).toBe("")
    })

    test("should handle nested tags correctly", () => {
      const text = `<system-reminder>
Outer content
<inner>Some inner tag</inner>
</system-reminder>`
      expect(removeSystemReminders(text)).toBe("")
    })

    test("should trim whitespace from result", () => {
      const text = `
<system-reminder>Remove this</system-reminder>

User text

`
      const result = removeSystemReminders(text)
      expect(result).toBe("User text")
    })

    test("should handle empty string input", () => {
      expect(removeSystemReminders("")).toBe("")
    })

    test("should handle text with no system-reminder tags", () => {
      const text = "Just normal user text without any system reminders"
      expect(removeSystemReminders(text)).toBe(text)
    })

    test("should preserve code blocks in user text", () => {
      const text = `Here's some code:
\`\`\`javascript
const x = 1;
\`\`\`
<system-reminder>System info</system-reminder>`
      const result = removeSystemReminders(text)
      expect(result).toContain("Here's some code:")
      expect(result).toContain("```javascript")
      expect(result).not.toContain("System info")
    })
  })

  describe("isSystemDirective", () => {
    test("should return true for OH-MY-OPENCODE system directives", () => {
      const directive = createSystemDirective("TEST")
      expect(isSystemDirective(directive)).toBe(true)
    })

    test("should return false for system-reminder tags", () => {
      const text = `<system-reminder>content</system-reminder>`
      expect(isSystemDirective(text)).toBe(false)
    })

    test("should return false for normal user messages", () => {
      expect(isSystemDirective("Just a normal message")).toBe(false)
    })

    test("should handle leading whitespace", () => {
      const directive = `  ${createSystemDirective("TEST")}`
      expect(isSystemDirective(directive)).toBe(true)
    })
  })

  describe("integration with keyword detection", () => {
    test("should prevent search keywords in system-reminders from triggering mode", () => {
      const text = `<system-reminder>
The system will search for the file and find all occurrences.
Please locate and scan the directory.
</system-reminder>`

      // After removing system reminders, no search keywords should remain
      const cleanText = removeSystemReminders(text)
      expect(cleanText).not.toMatch(/\b(search|find|locate|scan)\b/i)
    })

    test("should preserve search keywords in user text while removing system-reminder keywords", () => {
      const text = `<system-reminder>
System will find and locate files.
</system-reminder>

Please search for the bug in the code.`

      const cleanText = removeSystemReminders(text)
      expect(cleanText).toContain("search")
      expect(cleanText).not.toContain("find and locate")
    })

    test("should handle complex mixed content with multiple modes", () => {
      const text = `<system-reminder>
System will search and investigate.
</system-reminder>

User wants to explore the codebase and analyze the implementation.

<system-reminder>
Another system reminder with research keyword.
</system-reminder>`

      const cleanText = removeSystemReminders(text)
      expect(cleanText).toContain("explore")
      expect(cleanText).toContain("analyze")
      expect(cleanText).not.toContain("search and investigate")
      expect(cleanText).not.toContain("research")
    })
  })
})
