import { describe, expect, test } from "bun:test"
import {
  hasSystemReminder,
  removeSystemReminders,
  isSystemDirective,
  createSystemDirective,
} from "./system-directive"

describe("system-directive utilities", () => {
  describe("hasSystemReminder", () => {
    test("should return true for messages containing --- tags", () => {
      const text = `---
Some system content
---`
      expect(hasSystemReminder(text)).toBe(true)
    })

    test("should return false for messages without system-directive tags", () => {
      const text = "Just a normal user message"
      expect(hasSystemReminder(text)).toBe(false)
    })

    test("should be case-insensitive for tag names", () => {
      const text = `---content---`
      expect(hasSystemReminder(text)).toBe(true)
    })

    test("should detect system-directive in mixed content", () => {
      const text = `User text here
---
System content
---
More user text`
      expect(hasSystemReminder(text)).toBe(true)
    })

    test("should handle empty system-directive tags", () => {
      const text = `------`
      expect(hasSystemReminder(text)).toBe(true)
    })

    test("should handle multiline system-directive content", () => {
      const text = `---
Line 1
Line 2
Line 3
---`
      expect(hasSystemReminder(text)).toBe(true)
    })
  })

  describe("removeSystemReminders", () => {
    test("should remove system-directive tags and content", () => {
      const text = `---
System content that should be removed
---`
      expect(removeSystemReminders(text)).toBe("")
    })

    test("should preserve user text outside system-directive tags", () => {
      const text = `User message here
---
System content to remove
---
More user text`
      const result = removeSystemReminders(text)
      expect(result).toContain("User message here")
      expect(result).toContain("More user text")
      expect(result).not.toContain("System content to remove")
    })

    test("should remove multiple system-directive blocks", () => {
      const text = `---First block---
User text
---Second block---`
      const result = removeSystemReminders(text)
      expect(result).toContain("User text")
      expect(result).not.toContain("First block")
      expect(result).not.toContain("Second block")
    })

    test("should be case-insensitive for tag names", () => {
      const text = `---Content---`
      expect(removeSystemReminders(text)).toBe("")
    })

    test("should handle nested tags correctly", () => {
      const text = `---
Outer content
<inner>Some inner tag</inner>
---`
      expect(removeSystemReminders(text)).toBe("")
    })

    test("should trim whitespace from result", () => {
      const text = `
---Remove this---

User text

`
      const result = removeSystemReminders(text)
      expect(result).toBe("User text")
    })

    test("should handle empty string input", () => {
      expect(removeSystemReminders("")).toBe("")
    })

    test("should handle text with no system-directive tags", () => {
      const text = "Just normal user text without any system reminders"
      expect(removeSystemReminders(text)).toBe(text)
    })

    test("should preserve code blocks in user text", () => {
      const text = `Here's some code:
\`\`\`javascript
const x = 1;
\`\`\`
---System info---`
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

    test("should return false for system-directive tags", () => {
      const text = `---content---`
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
    test("should prevent search keywords in system-directives from triggering mode", () => {
      const text = `---
The system will search for the file and find all occurrences.
Please locate and scan the directory.
---`

      // After removing system reminders, no search keywords should remain
      const cleanText = removeSystemReminders(text)
      expect(cleanText).not.toMatch(/\b(search|find|locate|scan)\b/i)
    })

    test("should preserve search keywords in user text while removing system-directive keywords", () => {
      const text = `---
System will find and locate files.
---

Please search for the bug in the code.`

      const cleanText = removeSystemReminders(text)
      expect(cleanText).toContain("search")
      expect(cleanText).not.toContain("find and locate")
    })

    test("should handle complex mixed content with multiple modes", () => {
      const text = `---
System will search and investigate.
---

User wants to explore the codebase and analyze the implementation.

---
Another system reminder with research keyword.
---`

      const cleanText = removeSystemReminders(text)
      expect(cleanText).toContain("explore")
      expect(cleanText).toContain("analyze")
      expect(cleanText).not.toContain("search and investigate")
      expect(cleanText).not.toContain("research")
    })
  })
})
